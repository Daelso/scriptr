/**
 * Zustand store bridging the streaming `useStreamGenerate` hook to UI
 * surfaces that need to render the live (in-progress) section — primarily
 * `SectionList`, `StreamOverlay`, and per-`SectionCard` regen shimmers.
 *
 * The hook itself owns the SSE lifecycle; this store only tracks the scoped
 * rendering state so multiple components can read it without prop-drilling.
 *
 * Invariants:
 *   - Only one generation can run at a time. Chapter-mode and section-mode
 *     state are kept in separate fields so each consumer can read exactly what
 *     it needs, but they must never both be non-null simultaneously.
 *     `startGeneration(chapterId)` and `startSectionRegen(sectionId, chapterId)`
 *     both mark `isStreaming = true`; EditorPane gates new starts on
 *     `isStreaming`.
 *   - `liveText` holds ONLY the currently-streaming section of a chapter-mode
 *     run. Section-mode regen does NOT populate liveText — the task plan
 *     specifies a skeleton shimmer while waiting for the final content, not
 *     live-token display.
 *   - `flushLiveSection()` is called on `section-break` AND on `done`. The
 *     server has already persisted the prior section's text — clearing here
 *     prepares the buffer for the next section (or for teardown on `done`).
 *   - `lastRunMode` lets the terminal-state effect route cleanup to the right
 *     reset action (chapter vs. section). Cleared by both end actions.
 */
import { create } from "zustand";

export type GenerationRunMode = "chapter" | "section";

export type GenerationState = {
  /** Chapter currently streaming, or null if idle or section-mode. */
  activeChapterId: string | null;
  /** Text of the in-progress section being streamed (chapter mode only). */
  liveText: string;
  /** True between any start* and end* action. */
  isStreaming: boolean;
  /** Section currently being regenerated (section mode), or null. */
  regeneratingSectionId: string | null;
  /** Chapter that owns the section being regenerated (section mode), or null.
   *  Captured at `startSectionRegen` so the terminal-state effect can
   *  revalidate the regen's target chapter even after the user navigates
   *  away to another chapter mid-stream. */
  regeneratingChapterId: string | null;
  /** Which mode the current run started in — used by the terminal effect to
   *  route cleanup. Null when idle. */
  lastRunMode: GenerationRunMode | null;

  /** Mark a chapter as the active streaming target. Resets liveText. */
  startGeneration: (chapterId: string) => void;
  /** Replace the live section's text (mirrors the hook's last-section text). */
  setLiveText: (text: string) => void;
  /** Clear liveText without ending the stream — called on section-break. */
  flushLiveSection: () => void;
  /** Fully reset chapter-mode streaming state — called on done/error/stop. */
  endGeneration: () => void;
  /** Mark a section as the active regen target. `chapterId` is the chapter
   *  that owns the section — captured here so the terminal-state cleanup
   *  revalidates the correct chapter even if the user navigates away. */
  startSectionRegen: (sectionId: string, chapterId: string) => void;
  /** Fully reset section-mode regen state — called on done/error/stop. */
  endSectionRegen: () => void;
};

export const useGenerationStore = create<GenerationState>((set) => ({
  activeChapterId: null,
  liveText: "",
  isStreaming: false,
  regeneratingSectionId: null,
  regeneratingChapterId: null,
  lastRunMode: null,

  startGeneration: (chapterId) =>
    set({
      activeChapterId: chapterId,
      liveText: "",
      isStreaming: true,
      regeneratingSectionId: null,
      regeneratingChapterId: null,
      lastRunMode: "chapter",
    }),

  setLiveText: (text) => set({ liveText: text }),

  flushLiveSection: () => set({ liveText: "" }),

  endGeneration: () =>
    set({
      activeChapterId: null,
      liveText: "",
      isStreaming: false,
      lastRunMode: null,
    }),

  startSectionRegen: (sectionId, chapterId) =>
    set({
      activeChapterId: null,
      liveText: "",
      isStreaming: true,
      regeneratingSectionId: sectionId,
      regeneratingChapterId: chapterId,
      lastRunMode: "section",
    }),

  endSectionRegen: () =>
    set({
      regeneratingSectionId: null,
      regeneratingChapterId: null,
      isStreaming: false,
      lastRunMode: null,
    }),
}));
