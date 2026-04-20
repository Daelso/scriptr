"use client";

import { BibleSection } from "@/components/editor/BibleSection";
import type { Bible, Story } from "@/lib/types";

interface NavPaneProps {
  story: Story;
  bible: Bible;
}

/**
 * Left navigation pane for the story editor.
 * Currently renders only the Bible section (Task 6.2).
 * ChapterList will be added in Task 6.3.
 */
export function NavPane({ story, bible }: NavPaneProps) {
  return (
    <div className="flex flex-col h-full">
      <BibleSection slug={story.slug} bible={bible} />
    </div>
  );
}
