import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { effectiveDataDir } from "@/lib/config";
import { getStory } from "@/lib/storage/stories";
import { listChapters } from "@/lib/storage/chapters";
import { ReaderView } from "@/components/reader/ReaderView";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const dataDir = effectiveDataDir();
  const story = await getStory(dataDir, slug);
  if (!story) return { title: "Not Found — scriptr" };
  return { title: `${story.title} — Read` };
}

export default async function ReaderPage({ params }: Props) {
  const { slug } = await params;
  const dataDir = effectiveDataDir();

  const [story, chapters] = await Promise.all([
    getStory(dataDir, slug),
    listChapters(dataDir, slug),
  ]);

  if (!story) notFound();

  return <ReaderView story={story} chapters={chapters} />;
}
