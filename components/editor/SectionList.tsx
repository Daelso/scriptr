"use client";

import { useState } from "react";

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
  /**
   * Per-section action callbacks plumbed down from EditorPane. EditorPane owns
   * the single `useStreamGenerate()` hook instance; these handlers translate
   * user intent into `start({ mode: "section", … })` or PATCH requests.
   */
  onSectionRegenerate?: (sectionId: string) => void;
  onSectionRegenerateWithNote?: (sectionId: string, note: string) => void;
  onSectionDelete?: (sectionId: string) => void;
  /**
   * PATCH the chapter with the new body for `sectionId`. EditorPane owns the
   * SWR revalidation so SectionList stays presentational.
   */
  onSectionSaveBody?: (sectionId: string, newContent: string) => Promise<void>;
}

/**
 * Renders persisted sections followed by the in-progress "live" section when
 * a chapter-mode stream is active for this chapter. The live section has a
 * pulsing left border + trailing cursor glyph to signal that text is still
 * arriving. Section-mode regen is rendered inline by SectionCard (skeleton
 * shimmer), not here.
 */
export function SectionList({
  chapterId,
  sections,
  generateSlot,
  onSectionRegenerate,
  onSectionRegenerateWithNote,
  onSectionDelete,
  onSectionSaveBody,
}: SectionListProps) {
  const activeChapterId = useGenerationStore((s) => s.activeChapterId);
  const liveText = useGenerationStore((s) => s.liveText);
  const isStreaming = useGenerationStore((s) => s.isStreaming);
  const regeneratingSectionId = useGenerationStore((s) => s.regeneratingSectionId);

  // Live chapter-mode section tail. Defensive: never render it if a section
  // regen is active — chapter + section streams are mutually exclusive.
  const isLiveHere =
    isStreaming &&
    activeChapterId === chapterId &&
    regeneratingSectionId === null;

  // Disable action menus whenever any generation is in flight so the user
  // can't stack two runs.
  const disableActions = isStreaming;

  // Sticky-focus ownership: a single editing section id plus the last-captured
  // click coords. Only one section is in edit mode at a time — swapping
  // unmounts the previous SectionEditor, whose autosave flush fires from the
  // hook's unmount cleanup.
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [pendingCaret, setPendingCaret] = useState<{ x: number; y: number } | null>(null);

  // Any generation in flight (chapter stream or single-section regen) must
  // kick the currently-editing card out of edit mode so the SectionEditor
  // unmounts and its autosave cleanup flushes BEFORE the stream's persistence
  // writes land. We derive `effectiveEditingSectionId` instead of using an
  // effect: storing a dedicated state slot would require a setState-in-effect
  // (flagged by react-hooks/set-state-in-effect) and the prior-state
  // comparison pattern would require setState-in-render (flagged by
  // react-hooks/set-state-in-render). Derivation during render sidesteps both
  // and still produces the correct unmount: SectionCard receives
  // isEditing=false while streaming, so the editor unmounts and flushes.
  //
  // We intentionally KEEP `editingSectionId` state untouched while streaming
  // so the user's intent survives a transient regen — but with caveats. Since
  // `pendingCaret` was captured at click time, by the time streaming ends the
  // coords would point to stale screen space. So when `disableActions` is
  // true we also mask pendingCaret to null; if the user's prior card comes
  // back into edit mode post-stream, SectionEditor falls back to focus('end').
  const effectiveEditingSectionId = disableActions ? null : editingSectionId;
  const effectivePendingCaret = disableActions ? null : pendingCaret;

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
        <SectionCard
          key={section.id}
          section={section}
          isRegenerating={regeneratingSectionId === section.id}
          disableActions={disableActions}
          isEditing={effectiveEditingSectionId === section.id}
          caret={effectiveEditingSectionId === section.id ? effectivePendingCaret : null}
          onRequestEdit={(id, caret) => {
            setPendingCaret(caret);
            setEditingSectionId(id);
          }}
          onExit={() => {
            setEditingSectionId(null);
            setPendingCaret(null);
          }}
          onRegenerate={onSectionRegenerate}
          onRegenerateWithNote={onSectionRegenerateWithNote}
          onDelete={onSectionDelete}
          onSaveBody={onSectionSaveBody}
        />
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
