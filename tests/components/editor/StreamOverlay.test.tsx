// @vitest-environment jsdom
/**
 * Tests for StreamOverlay — the floating "Stop & Steer" panel mounted while
 * a generation stream is active.
 *
 * Manual React-19 render harness (no @testing-library/react by project rule).
 */
import { describe, it, expect, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { StreamOverlay } from "@/components/editor/StreamOverlay";

type Mounted = {
  container: HTMLDivElement;
  root: Root;
  unmount: () => void;
};

function mount(element: React.ReactElement): Mounted {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root!: Root;
  act(() => {
    root = createRoot(container);
    root.render(element);
  });
  const unmount = () => {
    act(() => { root.unmount(); });
    container.remove();
  };
  return { container, root, unmount };
}

describe("StreamOverlay", () => {
  it("renders Stop and Steer buttons plus a steer note input", () => {
    const onStop = vi.fn();
    const onSteer = vi.fn();
    const { container, unmount } = mount(
      <StreamOverlay onStop={onStop} onSteer={onSteer} />,
    );

    const stopBtn = container.querySelector('[aria-label="Stop generation"]');
    const steerBtn = container.querySelector('[aria-label="Steer"]');
    const input = container.querySelector('input[aria-label="Steer with a note"]');

    expect(stopBtn).not.toBeNull();
    expect(steerBtn).not.toBeNull();
    expect(input).not.toBeNull();

    const region = container.querySelector('[role="region"]');
    expect(region?.getAttribute("aria-label")).toBe("Stream controls");

    unmount();
  });

  it("clicking Stop invokes onStop", () => {
    const onStop = vi.fn();
    const onSteer = vi.fn();
    const { container, unmount } = mount(
      <StreamOverlay onStop={onStop} onSteer={onSteer} />,
    );

    const stopBtn = container.querySelector(
      '[aria-label="Stop generation"]',
    ) as HTMLButtonElement | null;
    expect(stopBtn).not.toBeNull();
    act(() => { stopBtn!.click(); });

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onSteer).not.toHaveBeenCalled();
    unmount();
  });

  it("clicking Steer invokes onSteer with the current note text", () => {
    const onStop = vi.fn();
    const onSteer = vi.fn();
    const { container, unmount } = mount(
      <StreamOverlay onStop={onStop} onSteer={onSteer} />,
    );

    const input = container.querySelector(
      'input[aria-label="Steer with a note"]',
    ) as HTMLInputElement;
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    act(() => {
      nativeSetter.call(input, "more tension");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const steerBtn = container.querySelector(
      '[aria-label="Steer"]',
    ) as HTMLButtonElement | null;
    act(() => { steerBtn!.click(); });

    expect(onSteer).toHaveBeenCalledWith("more tension");
    expect(onStop).not.toHaveBeenCalled();
    unmount();
  });

  it("Esc on the overlay triggers onStop", () => {
    const onStop = vi.fn();
    const onSteer = vi.fn();
    const { container, unmount } = mount(
      <StreamOverlay onStop={onStop} onSteer={onSteer} />,
    );

    const region = container.querySelector('[role="region"]') as HTMLElement;
    act(() => {
      region.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onSteer).not.toHaveBeenCalled();
    unmount();
  });

  it("Ctrl+Enter in the input triggers onSteer with the note", () => {
    const onStop = vi.fn();
    const onSteer = vi.fn();
    const { container, unmount } = mount(
      <StreamOverlay onStop={onStop} onSteer={onSteer} />,
    );

    const input = container.querySelector(
      'input[aria-label="Steer with a note"]',
    ) as HTMLInputElement;

    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    act(() => {
      nativeSetter.call(input, "slow down");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          ctrlKey: true,
          bubbles: true,
        }),
      );
    });

    expect(onSteer).toHaveBeenCalledWith("slow down");
    expect(onStop).not.toHaveBeenCalled();
    unmount();
  });

  it("disabled prop suppresses stop, steer, and keyboard handlers", () => {
    const onStop = vi.fn();
    const onSteer = vi.fn();
    const { container, unmount } = mount(
      <StreamOverlay onStop={onStop} onSteer={onSteer} disabled />,
    );

    const stopBtn = container.querySelector(
      '[aria-label="Stop generation"]',
    ) as HTMLButtonElement;
    const steerBtn = container.querySelector(
      '[aria-label="Steer"]',
    ) as HTMLButtonElement;

    // Button clicks are no-ops when disabled — base-ui/react's Button respects
    // disabled via pointer-events:none, so .click() won't bubble to onClick.
    // The internal handler also short-circuits on `disabled` as a safety net.
    act(() => { stopBtn.click(); });
    act(() => { steerBtn.click(); });

    expect(onStop).not.toHaveBeenCalled();
    expect(onSteer).not.toHaveBeenCalled();

    // Esc keydown on the container — the handler short-circuits on disabled.
    const region = container.querySelector('[role="region"]') as HTMLElement;
    act(() => {
      region.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onStop).not.toHaveBeenCalled();
    unmount();
  });
});
