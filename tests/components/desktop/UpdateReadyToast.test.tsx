// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { UpdateState } from "@/lib/update-state";

const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (msg: string, opts?: unknown) => toastSuccess(msg, opts),
  },
}));

import { UpdateReadyToast } from "@/components/desktop/UpdateReadyToast";

type Mounted = { container: HTMLDivElement; root: Root; unmount: () => void };

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

function fire(detail: UpdateState) {
  act(() => {
    window.dispatchEvent(new CustomEvent("scriptr:update-state", { detail }));
  });
}

describe("UpdateReadyToast", () => {
  let mounted: Mounted | null = null;

  beforeEach(() => {
    toastSuccess.mockClear();
  });

  afterEach(() => {
    mounted?.unmount();
    mounted = null;
  });

  it("toasts on a downloaded state event", () => {
    mounted = mount(<UpdateReadyToast />);
    fire({ kind: "downloaded", version: "0.3.1" });
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(toastSuccess.mock.calls[0][0]).toContain("0.3.1");
  });

  it("does NOT toast on idle / checking / downloading / error events", () => {
    mounted = mount(<UpdateReadyToast />);
    fire({ kind: "checking" });
    fire({ kind: "downloading", version: "0.3.1" });
    fire({ kind: "idle", lastCheckedAt: null, currentVersion: "0.3.0" });
    fire({ kind: "error", message: "offline" });
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
