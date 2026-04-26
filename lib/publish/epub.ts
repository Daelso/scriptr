/**
 * Server-only EPUB helpers.
 *
 * This module pulls in `epub-gen-memory` (which transitively imports
 * `fs`/`path`/`ejs`) and `@likecoin/epubcheck-ts` (whose WASM transitive
 * dep uses top-level await). Both are Node-only — importing this file from
 * a client component would drag those deps into the browser bundle.
 *
 * Client components that need the live-preview helpers must import from
 * `lib/publish/epub-preview.ts` directly. This file re-exports the same
 * symbols for convenience of server callers and the existing unit tests.
 */
import { randomBytes } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Chapter, Story } from "@/lib/types";
import type { EpubVersion } from "@/lib/storage/paths";
import { buildAuthorNoteHtml, type ResolvedAuthorNote } from "@/lib/publish/author-note";

export {
  EPUB_STYLESHEET,
  renderSectionHtml,
  renderChapterPreviewHtml,
  type PreviewOpts,
} from "@/lib/publish/epub-preview";
import { renderChapterPreviewHtml, EPUB_STYLESHEET } from "@/lib/publish/epub-preview";

export type EpubInput = {
  story: Story;
  chapters: Chapter[];
  coverPath?: string;
  /** EPUB package version. Defaults to 3. EPUB3 = Kindle/KDP. EPUB2 = Smashwords (which rejects EPUB3). */
  version?: EpubVersion;
  /** When provided, append a final "A note from the author" content entry. */
  authorNote?: ResolvedAuthorNote;
};

type EpubGenFn = (
  options: {
    title: string;
    author: string;
    description?: string;
    lang?: string;
    cover?: string;
    ignoreFailedDownloads?: boolean;
    css?: string;
  },
  content: Array<{ title: string; content: string }>,
  version?: 2 | 3,
  verbose?: boolean,
) => Promise<Buffer>;

// Load `epub-gen-memory` lazily inside the function rather than at module
// top level so bundlers don't have to analyze it during client builds. Even
// though this file is server-only, guarding the require makes the dep
// graph explicit.
function getGenerator(): EpubGenFn {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("epub-gen-memory") as { default?: EpubGenFn } & EpubGenFn;
  return (mod.default ?? mod) as EpubGenFn;
}

/**
 * Rewrites any `<img src="data:image/png;base64,...">` occurrences in the
 * given HTML by decoding the payload, writing it to a temp PNG, and replacing
 * the src with the file's `file://` URL.
 *
 * Why: `epub-gen-memory` cannot embed `data:` URLs. It pipes the src through
 * `node-fetch` (which doesn't support data URLs) and then derives the manifest
 * extension from `mime.getType(url)` (which returns null for data URLs). With
 * `ignoreFailedDownloads: true` set for the cover-path workaround, the failed
 * fetch silently produces a 0-byte file with no extension and an empty
 * media-type — observed for the QR image embedded by `buildAuthorNoteHtml`.
 *
 * The fix mirrors the cover-image workaround above: hand the library a
 * `file://` URL so it goes through the on-disk-read path instead.
 *
 * Returns the rewritten HTML and a list of temp file paths the caller must
 * unlink after the EPUB has been built.
 */
async function externalizeDataPngImages(
  html: string,
): Promise<{ html: string; tempPaths: string[] }> {
  const tempPaths: string[] = [];
  const decodePayload = (input: string): Buffer | null => {
    let payload = input;
    try {
      payload = decodeURIComponent(payload);
    } catch {
      // keep raw payload
    }
    payload = payload.replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/=]+$/.test(payload)) return null;
    try {
      return Buffer.from(payload, "base64");
    } catch {
      return null;
    }
  };
  // Match <img ... src="data:image/png;base64,XXXX" ...> with single or double
  // quotes. Capture the surrounding attributes so we can preserve them. The
  // payload capture is intentionally broad (`[^"']+`) so percent-encoded
  // newlines/spaces are still rewritten instead of producing broken archive
  // image entries.
  const re = /<img\b([^>]*?)\bsrc=(["'])data:image\/png;base64,([^"']+)\2([^>]*)>/gi;
  const matches: Array<{ start: number; end: number; pre: string; payload: string; post: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    matches.push({
      start: m.index,
      end: m.index + m[0].length,
      pre: m[1] ?? "",
      payload: m[3] ?? "",
      post: m[4] ?? "",
    });
  }

  if (matches.length === 0) return { html, tempPaths };

  // Rebuild the HTML in order, replacing each match with the rewritten <img>.
  // Wrap the writes in try/catch so a failure on image N doesn't leak the
  // bytes already written for images 1..N-1 — the function is the only
  // place that knows about its temp paths until it returns, so the caller's
  // outer finally can't help here. Best-effort cleanup on throw; rethrow
  // the original error so the caller still surfaces it.
  try {
    const out: string[] = [];
    let cursor = 0;
    for (const match of matches) {
      out.push(html.slice(cursor, match.start));
      const bytes = decodePayload(match.payload);
      if (!bytes) {
        // Drop malformed data-URI images instead of passing broken source
        // through to epub-gen-memory (which otherwise emits invalid manifest
        // entries and 0-byte files).
        cursor = match.end;
        continue;
      }
      const filename = `scriptr-qr-${randomBytes(8).toString("hex")}.png`;
      const tmpPath = join(tmpdir(), filename);
      await writeFile(tmpPath, bytes);
      tempPaths.push(tmpPath);
      const fileUrl = pathToFileURL(tmpPath).href;
      out.push(`<img${match.pre} src="${fileUrl}"${match.post}>`);
      cursor = match.end;
    }
    out.push(html.slice(cursor));
    return { html: out.join(""), tempPaths };
  } catch (err) {
    await Promise.all(
      tempPaths.map((p) => unlink(p).catch(() => {})),
    );
    throw err;
  }
}

export async function buildEpubBytes(input: EpubInput): Promise<Uint8Array> {
  const { story, chapters, coverPath, version = 3 } = input;

  const content = chapters.map((chapter, idx) => {
    const inner = renderChapterPreviewHtml(chapter, { chapterNumber: idx + 1 });
    // Strip the outer .epub-preview wrapper — not meaningful in the package XHTML.
    const stripped = inner
      .replace(/^<div class="epub-preview">/, "")
      .replace(/<\/div>$/, "");
    return {
      title: chapter.title || `Chapter ${idx + 1}`,
      content: stripped,
    };
  });

  // Track temp PNG files written for the QR data-URL workaround so we can
  // clean them up regardless of whether the generator throws. The author-
  // note build runs INSIDE the try so the outer finally also covers any
  // throw from `externalizeDataPngImages` itself — `externalizeDataPngImages`
  // does its own best-effort cleanup on throw, so this is belt-and-braces.
  const tempImagePaths: string[] = [];

  try {
    if (input.authorNote) {
      const noteHtml = await buildAuthorNoteHtml(input.authorNote);
      const { html: rewritten, tempPaths } = await externalizeDataPngImages(noteHtml);
      tempImagePaths.push(...tempPaths);
      content.push({
        title: "A note from the author",
        content: rewritten,
      });
    }

    const generator = getGenerator();
    const buffer = await generator(
      {
        title: story.title,
        author: story.authorPenName,
        description: story.description,
        lang: story.language || "en",
        // epub-gen-memory treats a plain string `cover` as a URL: strings
        // starting with `file://` are read from disk via fs.readFile; anything
        // else is fetched over HTTP. A bare absolute path fails the HTTP fetch
        // and (with ignoreFailedDownloads: true) silently writes a 0-byte
        // cover.jpeg into the archive — which Smashwords and other strict
        // EPUBCheck validators reject as a corrupted image. Convert to a
        // proper file:// URL so the library reads the bytes off disk.
        cover: coverPath ? pathToFileURL(coverPath).href : undefined,
        ignoreFailedDownloads: true,
        css: EPUB_STYLESHEET,
      },
      content,
      version,
    );

    return new Uint8Array(buffer);
  } finally {
    // Best-effort cleanup of temp QR files. Swallow ENOENT etc. — leaving a
    // stray temp PNG is preferable to masking a real generator error.
    await Promise.all(
      tempImagePaths.map((p) => unlink(p).catch(() => {})),
    );
  }
}

// EPUB validation. The plan named `epubcheck-wasm` but that package does not
// exist on npm; Chunk 1 substituted `@likecoin/epubcheck-ts@0.6.0` per the
// spec's fallback clause. Its API exposes `EpubCheck.validate(data, options?)`
// returning `{ valid, messages: ValidationMessage[], warningCount, ... }` where
// each message has `{ id, severity, message }`. The validator accepts a
// `Uint8Array` directly, so no temp file is needed.
//
// We surface every non-info / non-usage message as a warning string.
// Validation is non-blocking — any throw is caught and reported as a single
// warning instead of propagating.
type EpubcheckMessage = {
  id?: string;
  severity?: string;
  message?: string;
};
type EpubcheckResult = {
  valid?: boolean;
  messages?: EpubcheckMessage[];
};
type EpubcheckModule = {
  EpubCheck?: {
    validate?: (data: Uint8Array) => Promise<EpubcheckResult>;
  };
  default?: {
    EpubCheck?: {
      validate?: (data: Uint8Array) => Promise<EpubcheckResult>;
    };
  };
};

export type ValidationResult = { warnings: string[] };

export async function validateEpub(bytes: Uint8Array): Promise<ValidationResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@likecoin/epubcheck-ts") as EpubcheckModule;
    const ns = mod.default ?? mod;
    const validate = ns.EpubCheck?.validate;
    if (typeof validate !== "function") {
      return { warnings: ["validator error: @likecoin/epubcheck-ts API not recognized"] };
    }
    const report = await validate(bytes);
    const messages = report.messages ?? [];
    const warnings = messages
      .filter((m) => m.severity !== "info" && m.severity !== "usage")
      .map((m) => {
        const sev = m.severity ? `[${m.severity}] ` : "";
        const id = m.id ? `${m.id}: ` : "";
        return `${sev}${id}${m.message ?? ""}`.trim();
      });
    return { warnings };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { warnings: [`validator error: ${msg}`] };
  }
}
