// @vitest-environment jsdom
/**
 * Tests for the useAutoSave hook.
 *
 * Uses vitest's per-file jsdom environment override (above) so React
 * hooks can render. renderHook is built manually using React DOM since
 * @testing-library/react is not installed.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockedFunction } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { useAutoSave } from "@/hooks/useAutoSave";

// ─── Minimal renderHook harness ──────────────────────────────────────────────

type HookResult<P, R> = {
  result: { current: R };
  rerender: (props?: P) => void;
  unmount: () => void;
};

function renderHook<P, R>(
  callback: (props: P) => R,
  options: { initialProps: P },
): HookResult<P, R> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;

  const result: { current: R } = { current: null as unknown as R };
  let currentProps = options.initialProps;

  function TestComponent({ props }: { props: P }) {
    result.current = callback(props);
    return null;
  }

  act(() => {
    root = createRoot(container);
    root.render(React.createElement(TestComponent, { props: currentProps }));
  });

  function rerender(newProps?: P) {
    if (newProps !== undefined) currentProps = newProps;
    act(() => {
      root.render(React.createElement(TestComponent, { props: currentProps }));
    });
  }

  function unmount() {
    act(() => { root.unmount(); });
    container.remove();
  }

  return { result, rerender, unmount };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("useAutoSave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function makeSave(impl?: () => Promise<void>): MockedFunction<(v: string) => Promise<void>> {
    return vi.fn(impl ?? (() => Promise.resolve()));
  }

  it("does not call save on the first render", () => {
    const save = makeSave();
    renderHook((v: string) => useAutoSave(v, save), { initialProps: "initial" });
    vi.runAllTimers();
    expect(save).not.toHaveBeenCalled();
  });

  it("calls save after the debounce elapses when value changes", async () => {
    const save = makeSave();
    const { rerender } = renderHook((v: string) => useAutoSave(v, save), {
      initialProps: "initial",
    });

    rerender("changed");
    expect(save).not.toHaveBeenCalled();

    await act(async () => { vi.advanceTimersByTime(500); });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("changed");
  });

  it("coalesces rapid changes into one save", async () => {
    const save = makeSave();
    const { rerender } = renderHook((v: string) => useAutoSave(v, save), {
      initialProps: "a",
    });

    rerender("b");
    rerender("c");
    rerender("d");

    await act(async () => { vi.advanceTimersByTime(500); });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("d");
  });

  it("resets the debounce timer when value changes before it fires", async () => {
    const save = makeSave();
    const { rerender } = renderHook((v: string) => useAutoSave(v, save), {
      initialProps: "initial",
    });

    rerender("first");
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(save).not.toHaveBeenCalled();

    rerender("second");
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(save).not.toHaveBeenCalled();

    await act(async () => { vi.advanceTimersByTime(200); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("second");
  });

  it("transitions status: idle → saving → saved on success", async () => {
    let resolveSave!: () => void;
    const save = vi.fn(() => new Promise<void>((res) => { resolveSave = res; }));

    const { rerender, result } = renderHook((v: string) => useAutoSave(v, save), {
      initialProps: "initial",
    });

    expect(result.current.status).toBe("idle");

    rerender("changed");
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(result.current.status).toBe("saving");

    await act(async () => { resolveSave(); });
    expect(result.current.status).toBe("saved");
  });

  it("transitions status to 'error' on failure", async () => {
    const save = vi.fn(() => Promise.reject(new Error("save failed")));
    const { rerender, result } = renderHook((v: string) => useAutoSave(v, save), {
      initialProps: "initial",
    });

    rerender("bad");
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(result.current.status).toBe("error");
  });

  it("does not save after unmount", async () => {
    const save = makeSave();
    const { rerender, unmount } = renderHook((v: string) => useAutoSave(v, save), {
      initialProps: "initial",
    });

    rerender("changed");
    unmount();

    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(save).not.toHaveBeenCalled();
  });

  it("flush() saves immediately without waiting for debounce", async () => {
    const save = makeSave();
    const { rerender, result } = renderHook((v: string) => useAutoSave(v, save), {
      initialProps: "initial",
    });

    rerender("flushed");

    await act(async () => { await result.current.flush(); });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("flushed");
  });

  it("enabled: false skips saves", async () => {
    const save = makeSave();
    const { rerender } = renderHook(
      (v: string) => useAutoSave(v, save, { enabled: false }),
      { initialProps: "initial" },
    );

    rerender("changed");
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(save).not.toHaveBeenCalled();
  });

  it("respects custom debounceMs option", async () => {
    const save = makeSave();
    const { rerender } = renderHook(
      (v: string) => useAutoSave(v, save, { debounceMs: 200 }),
      { initialProps: "initial" },
    );

    rerender("fast");

    await act(async () => { vi.advanceTimersByTime(100); });
    expect(save).not.toHaveBeenCalled();

    await act(async () => { vi.advanceTimersByTime(100); });
    expect(save).toHaveBeenCalledTimes(1);
  });
});
