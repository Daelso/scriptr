"use client";

import { Button } from "@/components/ui/button";

interface GenerateChapterButtonProps {
  /**
   * Invoked on click. The parent (EditorPane) owns the `useStreamGenerate`
   * instance and the generation-store, so it composes `start(...)` +
   * `startGeneration(chapterId)` into this callback.
   */
  onGenerate: () => void;
  /** True while any generation is active — suppresses repeat clicks. */
  disabled?: boolean;
}

/**
 * "Generate chapter" CTA rendered when a chapter has no sections yet.
 * Kept presentational — the wiring to `useStreamGenerate` + the Zustand
 * store lives in `EditorPane` so the hook instance is shared with the
 * (upcoming) StreamOverlay.
 */
export function GenerateChapterButton({ onGenerate, disabled }: GenerateChapterButtonProps) {
  return (
    <Button onClick={onGenerate} disabled={disabled}>
      Generate chapter
    </Button>
  );
}
