import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api";
import { getStory } from "@/lib/storage/stories";
import { createImportedChapter } from "@/lib/storage/chapters";
import { effectiveDataDir } from "@/lib/config";
import {
  cleanPaste,
  inferTitle,
  splitChapterChunks,
  type CleanupOptions,
} from "@/lib/publish/cleanup";

type Ctx = { params: Promise<{ slug: string }> };

const MAX_PASTE_BYTES = 1_000_000;

export async function POST(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;

  const story = await getStory(effectiveDataDir(), slug);
  if (!story) return fail("story not found", 404);

  // Explicit body-size guard — Next.js does not enforce.
  const bodyText = await req.text();
  if (bodyText.length > MAX_PASTE_BYTES) {
    return fail("paste exceeds 1 MB limit", 413);
  }

  let parsed: { raw?: unknown; cleanupOptions?: unknown; title?: unknown };
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return fail("invalid JSON body");
  }

  if (typeof parsed.raw !== "string" || parsed.raw.trim() === "") {
    return fail("raw required", 400);
  }
  const raw = parsed.raw;
  const cleanupOptions: CleanupOptions =
    parsed.cleanupOptions && typeof parsed.cleanupOptions === "object"
      ? (parsed.cleanupOptions as CleanupOptions)
      : {};
  const providedTitle =
    typeof parsed.title === "string" && parsed.title.trim() !== ""
      ? parsed.title.trim()
      : undefined;

  // Pre-split on chapter markers. Single-chapter paste yields a 1-element array.
  const rawChunks = splitChapterChunks(raw)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  if (rawChunks.length === 0) {
    return fail("no prose detected after cleanup", 400);
  }

  type Cleaned = { sections: string[]; warnings: string[]; sourceRaw: string };
  const cleanedChunks: Cleaned[] = [];
  for (const chunk of rawChunks) {
    const { sections, warnings } = cleanPaste(chunk, cleanupOptions);
    if (sections.length === 0) continue; // silent drop per spec
    cleanedChunks.push({ sections, warnings, sourceRaw: chunk });
  }

  if (cleanedChunks.length === 0) {
    return fail("no prose detected after cleanup", 400);
  }

  const dataDir = effectiveDataDir();
  const chapters: Awaited<ReturnType<typeof createImportedChapter>>[] = [];
  const allWarnings: string[][] = [];

  for (let i = 0; i < cleanedChunks.length; i++) {
    const { sections, warnings, sourceRaw } = cleanedChunks[i];
    const title =
      i === 0 && providedTitle ? providedTitle : inferTitle(sourceRaw);
    const chapter = await createImportedChapter(dataDir, slug, {
      title,
      sectionContents: sections,
    });
    chapters.push(chapter);
    allWarnings.push(warnings);
  }

  return ok({ chapters, warnings: allWarnings }, { status: 201 });
}
