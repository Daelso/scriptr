import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { effectiveDataDir } from "@/lib/config";
import { getStory } from "@/lib/storage/stories";
import { listChapters } from "@/lib/storage/chapters";
import { ExportPage } from "@/components/publish/ExportPage";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const dataDir = effectiveDataDir();
  const story = await getStory(dataDir, slug);
  if (!story) return { title: "Not Found — scriptr" };
  return { title: `${story.title} — Export` };
}

export default async function Page({ params }: Props) {
  const { slug } = await params;
  const dataDir = effectiveDataDir();

  const [story, chapters] = await Promise.all([
    getStory(dataDir, slug),
    listChapters(dataDir, slug),
  ]);

  if (!story) notFound();

  const wordCount = chapters.reduce((a, c) => a + c.wordCount, 0);

  return (
    <ExportPage
      story={story}
      chapterCount={chapters.length}
      wordCount={wordCount}
    />
  );
}
