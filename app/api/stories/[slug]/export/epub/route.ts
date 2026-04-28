import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api";
import { effectiveDataDir } from "@/lib/config";
import type { EpubVersion } from "@/lib/storage/paths";
import { logger } from "@/lib/logger";
import { logApiError, apiErrorsLogPath } from "@/lib/api-error-log";
import { isSharpLoadError } from "@/lib/publish/epub-storage";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * EPUB export route.
 *
 * The entire handler body runs inside a single outer try/catch so any throw —
 * from a top-level dependency module-load failure (jsdom, qrcode, sharp on
 * Windows), an fs read on a permission-funky data dir, an epub-gen-memory
 * pipeline error, anything — surfaces as a JSON 500 with the underlying
 * message instead of Next.js's stock "Internal Server Error" HTML page.
 *
 * The export UI's `res.text()` fallback truncates response bodies to 200
 * chars, so the message also gets a leading prefix ("EPUB export failed: ")
 * to ensure the actionable text wins the truncation race.
 *
 * Heavy modules (epub-gen-memory, isomorphic-dompurify/jsdom via
 * author-note, sharp via epub-storage's lazy require) are dynamic-imported
 * INSIDE the try/catch so a require-time throw is catchable. Without this,
 * a top-level import failure would prevent the route module from loading at
 * all and Next would respond with a bare 500 the catch can never see.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const dataDir = effectiveDataDir();
  let slug = "<unparsed>";
  let version: EpubVersion = 3;

  try {
    ({ slug } = await ctx.params);

    // Body parsing — empty body must not 400.
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

    // Dynamic imports for the heavy chain. A throw here (e.g. jsdom failing
    // to init on a packaged Windows build) is caught by the outer catch and
    // surfaced to the user instead of disappearing into Next's bare 500.
    logger.info("epub-export: loading deps", { slug, version });
    const [
      { getStory },
      { listChapters },
      { loadConfig },
      { buildEpubBytes, validateEpub },
      { resolveAuthorNote },
      { ensureCoverOrFallback, writeEpub },
      { probeWritableDir, probeFailDetail },
    ] = await Promise.all([
      import("@/lib/storage/stories"),
      import("@/lib/storage/chapters"),
      import("@/lib/config"),
      import("@/lib/publish/epub"),
      import("@/lib/publish/author-note"),
      import("@/lib/publish/epub-storage"),
      import("@/lib/storage/dir-probe"),
    ]);

    logger.info("epub-export: reading story", { slug });
    const story = await getStory(dataDir, slug);
    if (!story) return fail("story not found", 404);

    const chapters = await listChapters(dataDir, slug);
    if (chapters.length === 0) {
      return fail("story has no chapters to export", 400);
    }

    const cfg = await loadConfig(dataDir);

    const effectiveOutputDir = bodyOutputDir ?? cfg.defaultExportDir;
    if (effectiveOutputDir !== undefined) {
      const probe = await probeWritableDir(effectiveOutputDir);
      if (!probe.ok) {
        return fail(`outputDir ${probeFailDetail(probe.reason)}`, 400);
      }
    }

    logger.info("epub-export: resolving cover", { slug });
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

    logger.info("epub-export: building bytes", { slug, version, hasCover: Boolean(coverPath), hasAuthorNote: Boolean(authorNote) });
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
    logger.info("epub-export: success", { slug, version, bytes: bytes.byteLength, path });
    return ok({ path, bytes: bytes.byteLength, version, warnings: validationWarnings });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // QR overflow is a user-input problem (mailing-list URL too long) — kept
    // as a 400 with its existing copy.
    if (/too big to be stored in a QR/i.test(msg)) {
      return fail("mailing list URL is too long to encode as a QR code", 400);
    }

    // Sharp / libvips dlopen failures: surface install guidance instead of a
    // generic message. Keep the diagnostic so a future packaging regression
    // is immediately legible to the user.
    if (isSharpLoadError(err)) {
      logger.error("epub-export: sharp module failed to load", err);
      await logApiError(dataDir, "POST /api/stories/[slug]/export/epub", err, {
        slug,
        version,
        kind: "sharp-load",
      });
      return fail(
        "Image processing module (sharp) failed to load. This is a Windows packaging bug — please reinstall scriptr or report at https://github.com/Daelso/scriptr/issues with this message.",
        500,
      );
    }

    logger.error("epub-export: unexpected failure", err);
    await logApiError(dataDir, "POST /api/stories/[slug]/export/epub", err, {
      slug,
      version,
    });
    // The export UI truncates response bodies to 200 chars, so put the
    // actionable text first and reference the on-disk log file last.
    return fail(
      `EPUB export failed: ${msg}. Full stack written to ${apiErrorsLogPath(dataDir)}`,
      500,
    );
  }
}
