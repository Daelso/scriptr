import type { NextRequest } from "next/server";
import { ok, fail, readJson } from "@/lib/api";
import { effectiveDataDir } from "@/lib/config";
import {
  createStory,
  updateStory,
  deleteStory,
  getStory,
} from "@/lib/storage/stories";
import { createImportedChapter } from "@/lib/storage/chapters";
import { saveBible, validateBible } from "@/lib/storage/bible";
import { cleanPaste, type CleanupOptions } from "@/lib/publish/cleanup";
import type { Bible } from "@/lib/types";
import type { ProposedChapter } from "@/lib/novelai/types";

// Same defaults the paste importer (ImportChapterDialog) uses. `stripChatCruft`
// is safe for NovelAI text because its heuristic only fires on obvious
// "Sure, here's..." chat preambles that don't appear in narrative prose.
const CLEANUP_OPTIONS: CleanupOptions = {
  normalizeLineEndings: true,
  stripChatCruft: true,
  trimTrailingWhitespace: true,
  collapseInternalSpaces: true,
  normalizeQuotes: true,
  normalizeSceneBreaks: true,
  normalizeDashes: true,
  preserveMarkdownEmphasis: true,
  collapseBlankLines: true,
  splitIntoSections: true,
};

function chapterBodyToSections(body: string): string[] {
  const { sections } = cleanPaste(body, CLEANUP_OPTIONS);
  return sections.length > 0 ? sections : [body.trim()];
}

type NewStoryEntry = {
  story: { title: string; description: string; keywords: string[] };
  bible: Bible;
  chapters: ProposedChapter[];
};

type CommitRequest =
  | {
      target: "new-story";
      stories: NewStoryEntry[];
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
  if (!Array.isArray(body.stories) || body.stories.length === 0) {
    return fail("at least one story required", 400);
  }

  // Up-front validation so we can return 400 without having created anything.
  for (let i = 0; i < body.stories.length; i++) {
    const s = body.stories[i];
    if (!s?.story?.title || typeof s.story.title !== "string") {
      return fail(
        body.stories.length === 1
          ? "title required"
          : `title required (story ${i + 1})`,
        400
      );
    }
    if (!Array.isArray(s.chapters) || s.chapters.length === 0) {
      return fail(
        body.stories.length === 1
          ? "at least one chapter required"
          : `at least one chapter required (story ${i + 1})`,
        400
      );
    }
    if (!validateBible(s.bible)) {
      return fail(
        body.stories.length === 1
          ? "invalid bible shape"
          : `invalid bible shape (story ${i + 1})`,
        400
      );
    }
  }

  const dataDir = effectiveDataDir();
  const createdSlugs: string[] = [];
  const allChapterIds: string[] = [];

  try {
    for (const entry of body.stories) {
      const story = await createStory(dataDir, { title: entry.story.title });
      createdSlugs.push(story.slug);

      await updateStory(dataDir, story.slug, {
        description: entry.story.description ?? "",
        keywords: Array.isArray(entry.story.keywords)
          ? entry.story.keywords
          : [],
      });

      await saveBible(dataDir, story.slug, entry.bible);

      for (const ch of entry.chapters) {
        const title = (ch.title || "Untitled").trim() || "Untitled";
        const created = await createImportedChapter(dataDir, story.slug, {
          title,
          sectionContents: chapterBodyToSections(ch.body),
        });
        allChapterIds.push(created.id);
      }
    }

    return ok({ slugs: createdSlugs, chapterIds: allChapterIds });
  } catch (err) {
    // Rollback: delete every story we created so far in this request.
    await Promise.allSettled(
      createdSlugs.map((slug) => deleteStory(dataDir, slug))
    );
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
        sectionContents: chapterBodyToSections(ch.body),
      });
      chapterIds.push(created.id);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(`Failed to write chapter files: ${msg}`, 500);
  }

  return ok({ slug: body.slug, chapterIds });
}
