"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Story, Bible, Chapter } from "@/lib/types";
import { NavPane } from "@/components/editor/NavPane";

interface StoryEditorProps {
  story: Story;
  bible: Bible;
  chapters: Chapter[];
  initialChapterId: string | null;
}

export function StoryEditor({
  story,
  bible,
  chapters,
  initialChapterId,
}: StoryEditorProps) {
  const router = useRouter();
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(
    initialChapterId,
  );

  // Sync chapter selection → URL without adding to history stack.
  useEffect(() => {
    if (selectedChapterId !== null) {
      router.replace(`/s/${story.slug}?chapter=${selectedChapterId}`, {
        scroll: false,
      });
    } else {
      router.replace(`/s/${story.slug}`, { scroll: false });
    }
  }, [selectedChapterId, story.slug, router]);

  return (
    <div className="grid h-[calc(100vh-44px)] grid-cols-[260px_1fr_320px] overflow-hidden">
      {/* Left pane — Nav */}
      <aside className="border-r border-border overflow-y-auto">
        <NavPane
          story={story}
          bible={bible}
          selectedChapterId={selectedChapterId}
          onSelectChapter={setSelectedChapterId}
        />
      </aside>

      {/* Center pane — Editor */}
      <section className="overflow-y-auto">
        {chapters.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">
              Add a chapter to start writing.
            </p>
          </div>
        ) : null}
      </section>

      {/* Right pane — Metadata (placeholder, populated in 6.4) */}
      <aside className="border-l border-border overflow-y-auto" />
    </div>
  );
}
