import type { NextRequest } from "next/server";
import { writeFile } from "node:fs/promises";
import { ok, fail, readJson } from "@/lib/api";
import { effectiveDataDir } from "@/lib/config";
import { createStory, updateStory, deleteStory, getStory } from "@/lib/storage/stories";
import { createImportedChapter } from "@/lib/storage/chapters";
import { bibleJson } from "@/lib/storage/paths";
import type { Bible } from "@/lib/types";
import type { ProposedChapter } from "@/lib/novelai/types";

type CommitRequest =
  | {
      target: "new-story";
      story: { title: string; description: string; keywords: string[] };
      bible: Bible;
      chapters: ProposedChapter[];
    }
  | {
      target: "existing-story";
      slug: string;
      chapters: ProposedChapter[];
    };

export async function POST(req: NextRequest) {
  const body = await readJson<CommitRequest>(req);

  if (body.target === "new-story") {
    return handleNewStory(body);
  }
  if (body.target === "existing-story") {
    return handleExistingStory(body);
  }
  return fail("invalid target", 400);
}

async function handleNewStory(
  body: Extract<CommitRequest, { target: "new-story" }>
) {
  if (!body.story?.title || typeof body.story.title !== "string") {
    return fail("title required", 400);
  }
  if (!Array.isArray(body.chapters) || body.chapters.length === 0) {
    return fail("at least one chapter required", 400);
  }

  const dataDir = effectiveDataDir();
  const story = await createStory(dataDir, { title: body.story.title });

  try {
    await updateStory(dataDir, story.slug, {
      description: body.story.description ?? "",
      keywords: Array.isArray(body.story.keywords) ? body.story.keywords : [],
    });

    await writeFile(
      bibleJson(dataDir, story.slug),
      JSON.stringify(body.bible, null, 2),
      "utf-8"
    );

    const chapterIds: string[] = [];
    for (const ch of body.chapters) {
      const title = (ch.title || "Untitled").trim() || "Untitled";
      const created = await createImportedChapter(dataDir, story.slug, {
        title,
        sectionContents: [ch.body],
      });
      chapterIds.push(created.id);
    }

    return ok({ slug: story.slug, chapterIds });
  } catch (err) {
    // Rollback: new-story mode owns the whole story dir; unlink it.
    await deleteStory(dataDir, story.slug).catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    return fail(`Failed to write story files: ${msg}`, 500);
  }
}

async function handleExistingStory(
  body: Extract<CommitRequest, { target: "existing-story" }>
) {
  if (!body.slug || typeof body.slug !== "string") {
    return fail("slug required", 400);
  }
  if (!Array.isArray(body.chapters) || body.chapters.length === 0) {
    return fail("at least one chapter required", 400);
  }

  const dataDir = effectiveDataDir();
  const existing = await getStory(dataDir, body.slug);
  if (!existing) {
    return fail("Story not found.", 404);
  }

  const chapterIds: string[] = [];
  try {
    for (const ch of body.chapters) {
      const title = (ch.title || "Untitled").trim() || "Untitled";
      const created = await createImportedChapter(dataDir, body.slug, {
        title,
        sectionContents: [ch.body],
      });
      chapterIds.push(created.id);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(`Failed to write chapter files: ${msg}`, 500);
  }

  return ok({ slug: body.slug, chapterIds });
}
