import { pathToFileURL } from "node:url";
import { rm } from "node:fs/promises";
import {
  renderChapterPreviewHtml,
  renderStoryTitlePageHtml,
  stripPreviewWrapper,
  EPUB_STYLESHEET,
} from "@/lib/publish/epub-preview";
import { appendAuthorNoteContent, getGenerator } from "@/lib/publish/epub";
import type { ResolvedAuthorNote } from "@/lib/publish/author-note";
import type { Bundle, Chapter, Story } from "@/lib/types";
import type { EpubVersion } from "@/lib/storage/paths";

export type ResolvedStory = { story: Story; chapters: Chapter[] };

export type BundleEpubInput = {
  bundle: Bundle;
  stories: Map<string, ResolvedStory>;
  coverPath?: string;
  version?: EpubVersion;
  authorNote?: ResolvedAuthorNote;
};

export async function buildBundleEpubBytes(input: BundleEpubInput): Promise<Uint8Array> {
  const { bundle, stories, coverPath, version = 3, authorNote } = input;

  const content: Array<{ title: string; content: string }> = [];
  for (const ref of bundle.stories) {
    const resolved = stories.get(ref.storySlug);
    if (!resolved) continue;
    if (resolved.chapters.length === 0) continue;

    const displayTitle = ref.titleOverride ?? resolved.story.title;
    const displayDescription = ref.descriptionOverride ?? resolved.story.description;

    content.push({
      title: displayTitle,
      content: renderStoryTitlePageHtml(displayTitle, displayDescription),
    });

    resolved.chapters.forEach((chapter, idx) => {
      content.push({
        title: chapter.title || `Chapter ${idx + 1}`,
        content: stripPreviewWrapper(
          renderChapterPreviewHtml(chapter, { chapterNumber: idx + 1 }),
        ),
      });
    });
  }

  // Track temp PNG files written for the QR data-URL workaround so we can
  // clean them up regardless of whether the generator throws (mirrors the
  // pattern in `buildEpubBytes`).
  const tempImagePaths: string[] = [];

  try {
    if (authorNote) {
      await appendAuthorNoteContent(content, authorNote, tempImagePaths);
    }

    const generator = getGenerator();
    const buffer = await generator(
      {
        title: bundle.title,
        author: bundle.authorPenName,
        description: bundle.description,
        lang: bundle.language || "en",
        // file:// URL avoids the 0-byte-cover gotcha in epub-gen-memory.
        cover: coverPath ? pathToFileURL(coverPath).href : undefined,
        ignoreFailedDownloads: true,
        css: EPUB_STYLESHEET,
      },
      content,
      version,
    );

    return new Uint8Array(buffer);
  } finally {
    // Best-effort cleanup of QR temp PNGs.
    for (const path of tempImagePaths) {
      await rm(path, { force: true }).catch(() => {});
    }
  }
}
