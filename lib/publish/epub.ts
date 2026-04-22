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
import { pathToFileURL } from "node:url";
import type { Chapter, Story } from "@/lib/types";
import type { EpubVersion } from "@/lib/storage/paths";

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
    version
  );

  return new Uint8Array(buffer);
}

// EPUB validation. The plan named `epubcheck-wasm` but that package does not
// exist on npm; Chunk 1 substituted `@likecoin/epubcheck-ts@0.6.0` per the
// spec's fallback clause. Its API exposes `EpubCheck.validate(data, options?)`
// returning `{ valid, messages: ValidationMessage[], warningCount, ... }` where
// each message has `{ id, severity, message }`. The validator accepts a
// `Uint8Array` directly, so no temp file is needed.
//
// We use dynamic `import()` rather than `require()` because the package is
// pure ESM (`"type": "module"`) and one of its transitive deps
// (`libxml2-wasm`) uses top-level await — which CJS `require()` cannot load.
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
    const mod = (await import("@likecoin/epubcheck-ts")) as EpubcheckModule;
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
