"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Story, Bible } from "@/lib/types";
import { NavPane } from "@/components/editor/NavPane";
import { MetadataPane } from "@/components/editor/MetadataPane";
import { EditorPane } from "@/components/editor/EditorPane";

interface StoryEditorProps {
  story: Story;
  bible: Bible;
  initialChapterId: string | null;
}

export function StoryEditor({
  story,
  bible,
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
        <EditorPane slug={story.slug} chapterId={selectedChapterId} />
      </section>

      {/* Right pane — Metadata */}
      <aside className="border-l border-border overflow-y-auto">
        <MetadataPane slug={story.slug} chapterId={selectedChapterId} />
      </aside>
    </div>
  );
}
