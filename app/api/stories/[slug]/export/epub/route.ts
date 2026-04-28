import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api";
import { getStory } from "@/lib/storage/stories";
import { listChapters } from "@/lib/storage/chapters";
import { effectiveDataDir, loadConfig } from "@/lib/config";
import { buildEpubBytes, validateEpub } from "@/lib/publish/epub";
import { resolveAuthorNote } from "@/lib/publish/author-note";
import {
  ensureCoverOrFallback,
  isSharpLoadError,
  writeEpub,
} from "@/lib/publish/epub-storage";
import type { EpubVersion } from "@/lib/storage/paths";
import { probeWritableDir, probeFailDetail } from "@/lib/storage/dir-probe";
import { logger } from "@/lib/logger";

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  const dataDir = effectiveDataDir();

  // Parse optional body { version?: 2 | 3; outputDir?: string }. Empty body must not 400.
  let version: EpubVersion = 3;
  let bodyOutputDir: string | undefined;
  const rawBody = await req.text();
  if (rawBody.trim() !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return fail("invalid JSON body", 400);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return fail("request body must be an object", 400);
    }
    const body = parsed as { version?: unknown; outputDir?: unknown };
    if (body.version !== undefined) {
      if (body.version !== 2 && body.version !== 3) {
        return fail("version must be 2 or 3", 400);
      }
      version = body.version as EpubVersion;
    }
    if (body.outputDir !== undefined && body.outputDir !== null) {
      if (typeof body.outputDir !== "string") {
        return fail("outputDir must be a string", 400);
      }
      bodyOutputDir = body.outputDir;
    }
  }

  const story = await getStory(dataDir, slug);
  if (!story) return fail("story not found", 404);

  const chapters = await listChapters(dataDir, slug);
  if (chapters.length === 0) {
    return fail("story has no chapters to export", 400);
  }

  const cfg = await loadConfig(dataDir);

  // Effective output dir: explicit body → config default → data-dir fallback (undefined here).
  const effectiveOutputDir = bodyOutputDir ?? cfg.defaultExportDir;
  if (effectiveOutputDir !== undefined) {
    const probe = await probeWritableDir(effectiveOutputDir);
    if (!probe.ok) {
      return fail(`outputDir ${probeFailDetail(probe.reason)}`, 400);
    }
  }

  // Cover resolution: returns null if no cover on disk AND sharp can't render
  // a fallback (e.g. the Windows standalone build is missing libvips DLLs).
  // Null cleanly degrades to a coverless EPUB instead of a bare 500.
  const coverPath = await ensureCoverOrFallback(dataDir, slug, {
    title: story.title,
    author: story.authorPenName,
  });
  if (!coverPath) {
    logger.warn(
      "epub-export: building without a cover (no on-disk cover and sharp/libvips unavailable)",
      { slug, version },
    );
  }

  const profile = cfg.penNameProfiles?.[story.authorPenName];
  const authorNote = resolveAuthorNote(story, profile) ?? undefined;

  // Single try/catch around the build/validate/write block so any exception
  // becomes a JSON 500 with a useful message — not a bare HTML 500. The
  // export UI's `res.text()` fallback only renders the first 200 chars of
  // the body, so without this the user sees a slice of Next.js's stock
  // error page and we get no signal back from the field.
  try {
    const bytes = await buildEpubBytes({
      story,
      chapters,
      coverPath: coverPath ?? undefined,
      version,
      authorNote,
    });
    const { warnings: validationWarnings } = await validateEpub(bytes);
    const path = await writeEpub(dataDir, slug, version, bytes, {
      outputDir: effectiveOutputDir,
    });
    return ok({ path, bytes: bytes.byteLength, version, warnings: validationWarnings });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // QR overflow is a user-input problem (mailing-list URL too long) — kept
    // as a 400 with its existing copy.
    if (/too big to be stored in a QR/i.test(msg)) {
      return fail("mailing list URL is too long to encode as a QR code", 400);
    }
    // Sharp / libvips dlopen failures: surface install guidance instead of a
    // generic message. Historically this was the bare-500 mode the Windows
    // DLL fix targeted; keep the diagnostic so a future packaging
    // regression is immediately legible to the user.
    if (isSharpLoadError(err)) {
      logger.error("epub-export: sharp module failed to load", err);
      return fail(
        "Image processing module (sharp) failed to load. This is a Windows packaging bug — please reinstall scriptr or report at https://github.com/Daelso/scriptr/issues with this message.",
        500,
      );
    }
    logger.error("epub-export: unexpected build failure", err);
    return fail(`EPUB build failed: ${msg}`, 500);
  }
}
