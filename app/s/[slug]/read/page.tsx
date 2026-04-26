import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { effectiveDataDir, loadConfig } from "@/lib/config";
import { getStory } from "@/lib/storage/stories";
import { listChapters } from "@/lib/storage/chapters";
import { ReaderView } from "@/components/reader/ReaderView";
import {
  resolveAuthorNote,
  buildAuthorNoteHtml,
} from "@/lib/publish/author-note";

export const dynamic = "force-dynamic";

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

  const [story, chapters, cfg] = await Promise.all([
    getStory(dataDir, slug),
    listChapters(dataDir, slug),
    loadConfig(dataDir),
  ]);

  if (!story) notFound();

  const profile = cfg.penNameProfiles?.[story.authorPenName];
  const resolved = resolveAuthorNote(story, profile);
  const authorNoteHtml = resolved
    ? await buildAuthorNoteHtml(resolved)
    : undefined;

  return (
    <ReaderView
      story={story}
      chapters={chapters}
      authorNoteHtml={authorNoteHtml}
    />
  );
}
