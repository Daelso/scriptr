// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useUpdates, type UseUpdatesResult } from "@/hooks/useUpdates";
import type { UpdateState } from "@/lib/update-state";

// ── Manual renderHook harness ────────────────────────────────────────────
type HookHandle<R> = {
  result: { current: R };
  unmount: () => void;
};

function renderHook<R>(callback: () => R): HookHandle<R> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root!: Root;
  const result: { current: R } = { current: null as unknown as R };

  function TestComponent() {
    result.current = callback();
    return null;
  }

  act(() => {
    root = createRoot(container);
    root.render(React.createElement(TestComponent));
  });

  return {
    result,
    unmount: () => {
      act(() => { root.unmount(); });
      container.remove();
    },
  };
}

// Schedule microtasks until a predicate becomes true (replaces RTL waitFor).
async function waitFor(check: () => void, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      check();
      return;
    } catch (err) {
      if (Date.now() - start > timeoutMs) throw err;
      await act(async () => { await Promise.resolve(); });
    }
  }
}

function setBridge(impl: Partial<NonNullable<typeof window.scriptrUpdates>> | undefined) {
  window.scriptrUpdates = impl as typeof window.scriptrUpdates;
}

function fire(detail: UpdateState) {
  act(() => {
    window.dispatchEvent(new CustomEvent("scriptr:update-state", { detail }));
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────
describe("useUpdates", () => {
  let handle: HookHandle<UseUpdatesResult> | null = null;

  beforeEach(() => {
    setBridge(undefined);
  });
  afterEach(() => {
    handle?.unmount();
    handle = null;
    setBridge(undefined);
  });

  it("returns nulls when the bridge is unavailable (web build)", () => {
    handle = renderHook(() => useUpdates());
    expect(handle.result.current.state).toBeNull();
    expect(handle.result.current.checkNow).toBeNull();
    expect(handle.result.current.installNow).toBeNull();
    expect(handle.result.current.justFinishedNoUpdate).toBe(false);
  });

  it("seeds state from getState() on mount", async () => {
    const seeded: UpdateState = { kind: "idle", lastCheckedAt: "2026-04-27T10:00:00Z", currentVersion: "0.3.0" };
    setBridge({
      getState: vi.fn().mockResolvedValue(seeded),
      checkNow: vi.fn().mockResolvedValue(seeded),
      installNow: vi.fn().mockResolvedValue(undefined),
    });
    handle = renderHook(() => useUpdates());
    await waitFor(() => expect(handle!.result.current.state).toEqual(seeded));
  });

  it("updates state on scriptr:update-state events", async () => {
    setBridge({
      getState: vi.fn().mockResolvedValue({ kind: "idle", lastCheckedAt: null, currentVersion: "0.3.0" }),
      checkNow: vi.fn(),
      installNow: vi.fn(),
    });
    handle = renderHook(() => useUpdates());
    await waitFor(() => expect(handle!.result.current.state?.kind).toBe("idle"));

    fire({ kind: "checking" });
    expect(handle.result.current.state).toEqual({ kind: "checking" });

    fire({ kind: "downloading", version: "0.3.1" });
    expect(handle.result.current.state).toEqual({ kind: "downloading", version: "0.3.1" });
  });

  it("flips justFinishedNoUpdate on checking → idle, clears on next non-idle transition", async () => {
    setBridge({
      getState: vi.fn().mockResolvedValue({ kind: "idle", lastCheckedAt: null, currentVersion: "0.3.0" }),
      checkNow: vi.fn(),
      installNow: vi.fn(),
    });
    handle = renderHook(() => useUpdates());
    await waitFor(() => expect(handle!.result.current.state?.kind).toBe("idle"));
    expect(handle.result.current.justFinishedNoUpdate).toBe(false);

    fire({ kind: "checking" });
    expect(handle.result.current.justFinishedNoUpdate).toBe(false);

    fire({ kind: "idle", lastCheckedAt: "2026-04-27T10:00:00Z", currentVersion: "0.3.0" });
    expect(handle.result.current.justFinishedNoUpdate).toBe(true);

    // Subsequent idle re-renders/state syncs do NOT re-set the flag
    fire({ kind: "idle", lastCheckedAt: "2026-04-27T10:00:00Z", currentVersion: "0.3.0" });
    expect(handle.result.current.justFinishedNoUpdate).toBe(true);

    // Next non-idle transition clears the flag
    fire({ kind: "checking" });
    expect(handle.result.current.justFinishedNoUpdate).toBe(false);
  });

  it("does not flip justFinishedNoUpdate when transitioning from downloading → downloaded → idle", async () => {
    // Hypothetical sequence: a download finishes, then a later check finds
    // no update. The user shouldn't see "you're on the latest" because the
    // path went through downloading — the flag is for "just-now-no-update",
    // not "was-eventually-idle".
    setBridge({
      getState: vi.fn().mockResolvedValue({ kind: "idle", lastCheckedAt: null, currentVersion: "0.3.0" }),
      checkNow: vi.fn(),
      installNow: vi.fn(),
    });
    handle = renderHook(() => useUpdates());
    await waitFor(() => expect(handle!.result.current.state?.kind).toBe("idle"));

    fire({ kind: "checking" });
    fire({ kind: "downloading", version: "0.3.1" });
    fire({ kind: "downloaded", version: "0.3.1" });
    expect(handle.result.current.justFinishedNoUpdate).toBe(false);
  });
});
