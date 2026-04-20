"use client";

import { BibleSection } from "@/components/editor/BibleSection";
import { ChapterList } from "@/components/editor/ChapterList";
import type { Bible, Story } from "@/lib/types";

interface NavPaneProps {
  story: Story;
  bible: Bible;
  selectedChapterId: string | null;
  onSelectChapter: (id: string) => void;
}

/**
 * Left navigation pane for the story editor.
 * Renders the chapter list (primary nav) above the Bible section (secondary reference).
 */
export function NavPane({ story, bible, selectedChapterId, onSelectChapter }: NavPaneProps) {
  return (
    <div className="flex flex-col h-full">
      {/* ── Chapters (primary navigation) ──────────────────────────────── */}
      <ChapterList
        slug={story.slug}
        selectedChapterId={selectedChapterId}
        onSelect={onSelectChapter}
      />

      {/* ── Separator ──────────────────────────────────────────────────── */}
      <div className="border-t border-border my-2" />

      {/* ── Bible (secondary reference) ────────────────────────────────── */}
      <BibleSection slug={story.slug} bible={bible} />
    </div>
  );
}
