import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api";
import { getStory } from "@/lib/storage/stories";
import { listChapters } from "@/lib/storage/chapters";
import { effectiveDataDir } from "@/lib/config";
import { buildEpubBytes, validateEpub } from "@/lib/publish/epub";
import { ensureCoverOrFallback, writeEpub } from "@/lib/publish/epub-storage";

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  const dataDir = effectiveDataDir();

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

  const bytes = await buildEpubBytes({ story, chapters, coverPath });
  const { warnings: validationWarnings } = await validateEpub(bytes);
  const path = await writeEpub(dataDir, slug, bytes);

  return ok({ path, bytes: bytes.byteLength, warnings: validationWarnings });
}
