import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { effectiveDataDir } from "@/lib/config";
import { getStory } from "@/lib/storage/stories";
import { getBible } from "@/lib/storage/bible";
import { listChapters } from "@/lib/storage/chapters";
import { StoryEditor } from "@/components/editor/StoryEditor";
import type { Bible } from "@/lib/types";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ chapter?: string | string[] }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const dataDir = effectiveDataDir();
  const story = await getStory(dataDir, slug);
  if (!story) return { title: "Not Found — scriptr" };
  return { title: `${story.title} — scriptr` };
}

export default async function StoryPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const chapterParam = Array.isArray(sp.chapter) ? sp.chapter[0] : sp.chapter;

  const dataDir = effectiveDataDir();

  const [story, bible, chapters] = await Promise.all([
    getStory(dataDir, slug),
    getBible(dataDir, slug),
    listChapters(dataDir, slug),
  ]);

  if (!story) notFound();

  // Resolve initial chapter id and redirect to canonical URL if needed.
  let initialChapterId: string | null = null;
  let needsRedirect = false;

  if (chapterParam && chapters.some((c) => c.id === chapterParam)) {
    initialChapterId = chapterParam;
  } else if (chapters.length > 0) {
    initialChapterId = chapters[0].id;
    needsRedirect = true;
  } else {
    // No chapters — no redirect needed, initialChapterId stays null.
    if (chapterParam) {
      // Invalid chapter param with no chapters — redirect to clean URL.
      needsRedirect = true;
    }
  }

  if (needsRedirect) {
    const target =
      initialChapterId !== null
        ? `/s/${slug}?chapter=${initialChapterId}`
        : `/s/${slug}`;
    redirect(target);
  }

  return (
    <StoryEditor
      story={story}
      bible={bible ?? ({ characters: [], setting: "", pov: "third-limited", tone: "", styleNotes: "", nsfwPreferences: "" } satisfies Bible)}
      initialChapterId={initialChapterId}
    />
  );
}
