/**
 * Zustand store bridging the streaming `useStreamGenerate` hook to UI
 * surfaces that need to render the live (in-progress) section — primarily
 * `SectionList` and, later, `StreamOverlay`.
 *
 * The hook itself owns the SSE lifecycle; this store only tracks the scoped
 * rendering state so multiple components can read it without prop-drilling.
 *
 * Invariants:
 *   - Only one chapter can stream at a time. `startGeneration(chapterId)`
 *     replaces any prior active chapter (the hook is already responsible for
 *     aborting its prior run when `start()` is called again).
 *   - `liveText` holds ONLY the currently-streaming section. Prior sections
 *     are persisted server-side and fetched via SWR revalidation, so we never
 *     need to accumulate them here.
 *   - `flushLiveSection()` is called on `section-break` AND on `done`. The
 *     server has already persisted the prior section's text — clearing here
 *     prepares the buffer for the next section (or for teardown on `done`).
 */
import { create } from "zustand";

export type GenerationState = {
  /** Chapter currently streaming, or null if idle. */
  activeChapterId: string | null;
  /** Text of the in-progress section being streamed. Cleared on section-break. */
  liveText: string;
  /** True between `startGeneration` and `endGeneration`. */
  isStreaming: boolean;

  /** Mark a chapter as the active streaming target. Resets liveText. */
  startGeneration: (chapterId: string) => void;
  /** Replace the live section's text (mirrors the hook's last-section text). */
  setLiveText: (text: string) => void;
  /** Clear liveText without ending the stream — called on section-break. */
  flushLiveSection: () => void;
  /** Fully reset streaming state — called on done/error/stop. */
  endGeneration: () => void;
};

export const useGenerationStore = create<GenerationState>((set) => ({
  activeChapterId: null,
  liveText: "",
  isStreaming: false,

  startGeneration: (chapterId) =>
    set({ activeChapterId: chapterId, liveText: "", isStreaming: true }),

  setLiveText: (text) => set({ liveText: text }),

  flushLiveSection: () => set({ liveText: "" }),

  endGeneration: () =>
    set({ activeChapterId: null, liveText: "", isStreaming: false }),
}));
