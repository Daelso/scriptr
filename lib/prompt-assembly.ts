import { loadConfig } from "@/lib/config";
import { getStory } from "@/lib/storage/stories";
import { getBible } from "@/lib/storage/bible";
import { getChapter, listChapters } from "@/lib/storage/chapters";
import { buildChapterPrompt, type PromptPair } from "@/lib/prompts";
import { resolveStyleRules } from "@/lib/style";

export class StoryNotFoundError extends Error {
  constructor(slug: string) {
    super(`story not found: ${slug}`);
    this.name = "StoryNotFoundError";
  }
}

export class BibleNotFoundError extends Error {
  constructor(slug: string) {
    super(`bible not found: ${slug}`);
    this.name = "BibleNotFoundError";
  }
}

export class ChapterNotFoundError extends Error {
  constructor(chapterId: string) {
    super(`chapter not found: ${chapterId}`);
    this.name = "ChapterNotFoundError";
  }
}

export type AssembledPromptMeta = {
  chapterIndex: number;
  priorRecapCount: number;
  includesLastChapterFullText: boolean;
  model: string;
};

export type AssembledPrompt = PromptPair & { meta: AssembledPromptMeta };

export async function assembleChapterPrompt(
  dataDir: string,
  storySlug: string,
  chapterId: string,
): Promise<AssembledPrompt> {
  const story = await getStory(dataDir, storySlug);
  if (!story) throw new StoryNotFoundError(storySlug);

  const bible = await getBible(dataDir, storySlug);
  if (!bible) throw new BibleNotFoundError(storySlug);

  const chapter = await getChapter(dataDir, storySlug, chapterId);
  if (!chapter) throw new ChapterNotFoundError(chapterId);

  const config = await loadConfig(dataDir);

  const allChapters = await listChapters(dataDir, storySlug);
  const chapterIndex = allChapters.findIndex((c) => c.id === chapter.id);
  if (chapterIndex < 0) throw new ChapterNotFoundError(chapterId);

  const priorRecaps =
    chapterIndex > 0
      ? allChapters
          .slice(0, chapterIndex)
          .map((c, i) => ({ chapterIndex: i + 1, recap: c.recap }))
      : [];

  const lastChapterFullText =
    config.includeLastChapterFullText && chapterIndex > 0
      ? allChapters[chapterIndex - 1].sections.map((s) => s.content).join("\n---\n")
      : undefined;

  const { system, user } = buildChapterPrompt({
    story,
    bible,
    priorRecaps,
    chapter,
    includeLastChapterFullText: config.includeLastChapterFullText,
    lastChapterFullText,
    style: resolveStyleRules(config, bible),
  });

  return {
    system,
    user,
    meta: {
      chapterIndex: chapterIndex + 1,
      priorRecapCount: priorRecaps.length,
      includesLastChapterFullText: lastChapterFullText !== undefined,
      model: story.modelOverride ?? config.defaultModel,
    },
  };
}
