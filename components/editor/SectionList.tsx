"use client";

import { SectionCard } from "@/components/editor/SectionCard";
import { useGenerationStore } from "@/components/editor/generation-store";
import type { Section } from "@/lib/types";

interface SectionListProps {
  /**
   * Kept for forward-compat with per-section actions that will hit the
   * `/api/stories/:slug/chapters/:chapterId` endpoints in later tasks.
   */
  slug: string;
  chapterId: string;
  sections: Section[];
  /**
   * Rendered in the empty state when there are no persisted sections AND no
   * active stream for this chapter. EditorPane supplies the wired
   * `GenerateChapterButton`. Kept as a slot so SectionList stays unaware of
   * the hook and store wiring.
   */
  generateSlot?: React.ReactNode;
}

/**
 * Renders persisted sections followed by the in-progress "live" section when
 * a stream is active for this chapter. The live section has a pulsing left
 * border + trailing cursor glyph to signal that text is still arriving.
 */
export function SectionList({ chapterId, sections, generateSlot }: SectionListProps) {
  const activeChapterId = useGenerationStore((s) => s.activeChapterId);
  const liveText = useGenerationStore((s) => s.liveText);
  const isStreaming = useGenerationStore((s) => s.isStreaming);

  const isLiveHere = isStreaming && activeChapterId === chapterId;

  // Empty state: no sections on disk AND nothing being streamed for this chapter.
  if (sections.length === 0 && !isLiveHere) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        {generateSlot}
      </div>
    );
  }

  return (
    <div>
      {sections.map((section) => (
        <SectionCard key={section.id} section={section} />
      ))}
      {isLiveHere && (
        <article
          aria-live="polite"
          aria-label="Streaming section"
          className="relative py-4 pl-3 border-b border-border last:border-b-0"
        >
          {/* Pulsing left border — on its own element so the prose underneath
              stays at full opacity and remains readable while streaming. */}
          <span
            aria-hidden
            className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary animate-pulse"
          />
          <p className="text-base leading-relaxed text-foreground whitespace-pre-wrap">
            {liveText}
            <span aria-hidden className="ml-0.5 inline-block animate-pulse">▍</span>
          </p>
        </article>
      )}
    </div>
  );
}
