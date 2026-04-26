import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api";
import { getBundle } from "@/lib/storage/bundles";
import { getStory } from "@/lib/storage/stories";
import { listChapters } from "@/lib/storage/chapters";
import {
  renderStoryTitlePageHtml,
  renderChapterPreviewHtml,
  stripPreviewWrapper,
} from "@/lib/publish/epub-preview";
import { effectiveDataDir } from "@/lib/config";

type Ctx = { params: Promise<{ slug: string }> };

type PreviewStory =
  | { storySlug: string; missing: true }
  | {
      storySlug: string;
      displayTitle: string;
      titlePageHtml: string;
      chapters: Array<{ id: string; title: string; html: string }>;
    };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  const dataDir = effectiveDataDir();
  const bundle = await getBundle(dataDir, slug);
  if (!bundle) return fail("bundle not found", 404);

  const stories: PreviewStory[] = [];
  for (const ref of bundle.stories) {
    const story = await getStory(dataDir, ref.storySlug);
    if (!story) {
      stories.push({ storySlug: ref.storySlug, missing: true });
      continue;
    }
    const chapters = await listChapters(dataDir, ref.storySlug);
    const displayTitle = ref.titleOverride ?? story.title;
    const displayDescription = ref.descriptionOverride ?? story.description;
    stories.push({
      storySlug: ref.storySlug,
      displayTitle,
      titlePageHtml: renderStoryTitlePageHtml(displayTitle, displayDescription),
      chapters: chapters.map((chapter, idx) => ({
        id: chapter.id,
        title: chapter.title || `Chapter ${idx + 1}`,
        html: stripPreviewWrapper(
          renderChapterPreviewHtml(chapter, { chapterNumber: idx + 1 }),
        ),
      })),
    });
  }

  return ok({
    bundle: {
      title: bundle.title,
      authorPenName: bundle.authorPenName,
      description: bundle.description,
    },
    stories,
  });
}
