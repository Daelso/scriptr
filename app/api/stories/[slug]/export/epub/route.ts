import type { NextRequest } from "next/server";
import { ok, fail, readJson } from "@/lib/api";
import { getStory } from "@/lib/storage/stories";
import { listChapters } from "@/lib/storage/chapters";
import { effectiveDataDir } from "@/lib/config";
import { buildEpubBytes, validateEpub } from "@/lib/publish/epub";
import { ensureCoverOrFallback, writeEpub } from "@/lib/publish/epub-storage";
import type { EpubVersion } from "@/lib/storage/paths";

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  const dataDir = effectiveDataDir();

  // Parse optional body { version?: 2 | 3 }. Empty body must not 400.
  let version: EpubVersion = 3;
  try {
    const body = await readJson<{ version?: unknown }>(req);
    if (body.version !== undefined) {
      if (body.version !== 2 && body.version !== 3) {
        return fail("version must be 2 or 3", 400);
      }
      version = body.version as EpubVersion;
    }
  } catch (err) {
    // Empty or non-JSON body — default to version 3. Only tolerate parse-shape
    // errors (SyntaxError from malformed JSON, TypeError from a torn body stream).
    // Unexpected errors must propagate — silent swallowing would hide real bugs.
    if (!(err instanceof SyntaxError) && !(err instanceof TypeError)) throw err;
  }

  const story = await getStory(dataDir, slug);
  if (!story) return fail("story not found", 404);

  const chapters = await listChapters(dataDir, slug);
  if (chapters.length === 0) {
    return fail("story has no chapters to export", 400);
  }

  const coverPath = await ensureCoverOrFallback(dataDir, slug, {
    title: story.title,
    author: story.authorPenName,
  });

  const bytes = await buildEpubBytes({ story, chapters, coverPath, version });
  const { warnings: validationWarnings } = await validateEpub(bytes);
  const path = await writeEpub(dataDir, slug, version, bytes);

  return ok({ path, bytes: bytes.byteLength, version, warnings: validationWarnings });
}
