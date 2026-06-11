import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api";
import { effectiveDataDir } from "@/lib/config";
import { logger } from "@/lib/logger";
import { apiErrorsLogPath, logApiError } from "@/lib/api-error-log";
import { normalizePaperbackOptions, type PaperbackOptions } from "@/lib/publish/paperback-shared";

type Ctx = { params: Promise<{ slug: string }> };

function parseOptions(value: unknown): Partial<PaperbackOptions> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("options must be an object");
  }
  return value as Partial<PaperbackOptions>;
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const dataDir = effectiveDataDir();
  let slug = "<unparsed>";

  try {
    ({ slug } = await ctx.params);

    let bodyOutputDir: string | undefined;
    let options = normalizePaperbackOptions();
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
      const body = parsed as { outputDir?: unknown; options?: unknown };
      try {
        options = normalizePaperbackOptions(parseOptions(body.options));
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err), 400);
      }
      if (body.outputDir !== undefined && body.outputDir !== null) {
        if (typeof body.outputDir !== "string") {
          return fail("outputDir must be a string", 400);
        }
        bodyOutputDir = body.outputDir;
      }
    }

    logger.info("paperback-export: loading deps", { slug });
    const [
      { getStory },
      { listChapters },
      { loadConfig },
      { resolveAuthorNote },
      { buildPaperbackHtml },
      { writePaperbackExport },
      { probeWritableDir, probeFailDetail },
    ] = await Promise.all([
      import("@/lib/storage/stories"),
      import("@/lib/storage/chapters"),
      import("@/lib/config"),
      import("@/lib/publish/author-note"),
      import("@/lib/publish/paperback"),
      import("@/lib/publish/paperback-storage"),
      import("@/lib/storage/dir-probe"),
    ]);

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

    const profile = cfg.penNameProfiles?.[story.authorPenName];
    const authorNote = resolveAuthorNote(story, profile) ?? undefined;
    const built = await buildPaperbackHtml({
      story,
      chapters,
      options,
      authorNote,
    });
    const written = await writePaperbackExport(
      dataDir,
      slug,
      {
        html: built.html,
        spec: {
          options: built.options,
          cover: built.coverSpec,
          notes: [
            "Open the interior HTML and print/save to PDF with browser headers and footers disabled.",
            "Use the final PDF page count from KDP Previewer to regenerate the cover spec if it differs from this estimate.",
          ],
        },
      },
      { outputDir: effectiveOutputDir },
    );

    logger.info("paperback-export: success", {
      slug,
      bytes: written.bytes,
      interiorPath: written.interiorPath,
      coverSpecPath: written.coverSpecPath,
    });

    return ok({
      path: written.interiorPath,
      coverSpecPath: written.coverSpecPath,
      bytes: written.bytes,
      coverSpec: built.coverSpec,
      warnings: built.warnings,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("paperback-export: unexpected failure", err);
    await logApiError(dataDir, "POST /api/stories/[slug]/export/paperback", err, {
      slug,
    });
    return fail(
      `Paperback export failed: ${msg}. Full stack written to ${apiErrorsLogPath(dataDir)}`,
      500,
    );
  }
}
