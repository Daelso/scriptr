/**
 * Tests for the generation-store (Zustand) that bridges `useStreamGenerate`
 * to UI surfaces rendering the live streaming section.
 *
 * Zustand stores are plain JS; we drive them via getState() / actions and
 * assert on the resulting state. No React renderer required.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useGenerationStore } from "@/components/editor/generation-store";

const initial = useGenerationStore.getState();

function resetStore() {
  useGenerationStore.setState(
    {
      activeChapterId: initial.activeChapterId,
      liveText: initial.liveText,
      isStreaming: initial.isStreaming,
      regeneratingSectionId: initial.regeneratingSectionId,
      regeneratingChapterId: initial.regeneratingChapterId,
      lastRunMode: initial.lastRunMode,
    },
    // Replace flag: don't wipe action references — setState(_, true) would
    // drop the functions. Keep partial replace semantics.
    false,
  );
}

describe("generation-store", () => {
  beforeEach(() => {
    resetStore();
  });

  it("starts in an idle state", () => {
    const s = useGenerationStore.getState();
    expect(s.activeChapterId).toBeNull();
    expect(s.liveText).toBe("");
    expect(s.isStreaming).toBe(false);
    expect(s.regeneratingSectionId).toBeNull();
    expect(s.regeneratingChapterId).toBeNull();
    expect(s.lastRunMode).toBeNull();
  });

  it("startGeneration marks a chapter active and clears prior live text", () => {
    useGenerationStore.setState({ liveText: "stale" });
    useGenerationStore.getState().startGeneration("chap-1");

    const s = useGenerationStore.getState();
    expect(s.activeChapterId).toBe("chap-1");
    expect(s.isStreaming).toBe(true);
    expect(s.liveText).toBe("");
    expect(s.lastRunMode).toBe("chapter");
    expect(s.regeneratingSectionId).toBeNull();
    expect(s.regeneratingChapterId).toBeNull();
  });

  it("setLiveText replaces the buffered text", () => {
    useGenerationStore.getState().startGeneration("chap-1");
    useGenerationStore.getState().setLiveText("hello");
    expect(useGenerationStore.getState().liveText).toBe("hello");

    useGenerationStore.getState().setLiveText("hello world");
    expect(useGenerationStore.getState().liveText).toBe("hello world");
  });

  it("flushLiveSection clears liveText but preserves activeChapterId + isStreaming", () => {
    useGenerationStore.getState().startGeneration("chap-1");
    useGenerationStore.getState().setLiveText("section 1 done");
    useGenerationStore.getState().flushLiveSection();

    const s = useGenerationStore.getState();
    expect(s.liveText).toBe("");
    expect(s.activeChapterId).toBe("chap-1");
    expect(s.isStreaming).toBe(true);
  });

  it("endGeneration resets every field", () => {
    useGenerationStore.getState().startGeneration("chap-1");
    useGenerationStore.getState().setLiveText("partial");
    useGenerationStore.getState().endGeneration();

    const s = useGenerationStore.getState();
    expect(s.activeChapterId).toBeNull();
    expect(s.isStreaming).toBe(false);
    expect(s.liveText).toBe("");
    expect(s.lastRunMode).toBeNull();
  });

  it("startSectionRegen marks a section active and flips isStreaming", () => {
    useGenerationStore.getState().startSectionRegen("sec-1", "chap-1");

    const s = useGenerationStore.getState();
    expect(s.regeneratingSectionId).toBe("sec-1");
    expect(s.regeneratingChapterId).toBe("chap-1");
    expect(s.isStreaming).toBe(true);
    expect(s.activeChapterId).toBeNull();
    expect(s.liveText).toBe("");
    expect(s.lastRunMode).toBe("section");
  });

  it("endSectionRegen clears section-regen state while leaving chapter-mode fields untouched", () => {
    useGenerationStore.getState().startSectionRegen("sec-1", "chap-1");
    useGenerationStore.getState().endSectionRegen();

    const s = useGenerationStore.getState();
    expect(s.regeneratingSectionId).toBeNull();
    expect(s.regeneratingChapterId).toBeNull();
    expect(s.isStreaming).toBe(false);
    expect(s.lastRunMode).toBeNull();
  });

  it("startSectionRegen overrides a prior section target", () => {
    useGenerationStore.getState().startSectionRegen("sec-1", "chap-1");
    useGenerationStore.getState().startSectionRegen("sec-2", "chap-2");

    const s = useGenerationStore.getState();
    expect(s.regeneratingSectionId).toBe("sec-2");
    expect(s.regeneratingChapterId).toBe("chap-2");
    expect(s.isStreaming).toBe(true);
    expect(s.lastRunMode).toBe("section");
  });

  it("startGeneration after startSectionRegen switches to chapter mode and clears section-regen state", () => {
    useGenerationStore.getState().startSectionRegen("sec-1", "chap-1");
    useGenerationStore.getState().startGeneration("chap-1");

    const s = useGenerationStore.getState();
    expect(s.activeChapterId).toBe("chap-1");
    expect(s.regeneratingSectionId).toBeNull();
    expect(s.regeneratingChapterId).toBeNull();
    expect(s.lastRunMode).toBe("chapter");
    expect(s.isStreaming).toBe(true);
  });

  it("startGeneration replaces a prior active chapter", () => {
    useGenerationStore.getState().startGeneration("chap-1");
    useGenerationStore.getState().setLiveText("partial");
    useGenerationStore.getState().startGeneration("chap-2");

    const s = useGenerationStore.getState();
    expect(s.activeChapterId).toBe("chap-2");
    expect(s.isStreaming).toBe(true);
    expect(s.liveText).toBe("");
  });

  it("subscribers receive updates across actions", () => {
    const seen: Array<{ active: string | null; live: string; streaming: boolean }> = [];
    const unsub = useGenerationStore.subscribe((s) => {
      seen.push({ active: s.activeChapterId, live: s.liveText, streaming: s.isStreaming });
    });

    useGenerationStore.getState().startGeneration("chap-1");
    useGenerationStore.getState().setLiveText("abc");
    useGenerationStore.getState().flushLiveSection();
    useGenerationStore.getState().endGeneration();

    unsub();

    expect(seen).toEqual([
      { active: "chap-1", live: "", streaming: true },
      { active: "chap-1", live: "abc", streaming: true },
      { active: "chap-1", live: "", streaming: true },
      { active: null, live: "", streaming: false },
    ]);
  });

  it("subscribers receive section-regen updates", () => {
    const seen: Array<{
      regenId: string | null;
      regenChapId: string | null;
      streaming: boolean;
      mode: string | null;
    }> = [];
    const unsub = useGenerationStore.subscribe((s) => {
      seen.push({
        regenId: s.regeneratingSectionId,
        regenChapId: s.regeneratingChapterId,
        streaming: s.isStreaming,
        mode: s.lastRunMode,
      });
    });

    useGenerationStore.getState().startSectionRegen("sec-1", "chap-1");
    useGenerationStore.getState().endSectionRegen();

    unsub();

    expect(seen).toEqual([
      { regenId: "sec-1", regenChapId: "chap-1", streaming: true, mode: "section" },
      { regenId: null, regenChapId: null, streaming: false, mode: null },
    ]);
  });
});
