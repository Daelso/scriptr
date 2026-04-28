// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Mock } from "vitest";
import type { UpdateState } from "@/lib/update-state";

// Mock next/navigation (SettingsForm uses useRouter + useSearchParams)
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Reset SWR's module-level cache between tests so a stale `/api/settings`
// response from one test doesn't seed the next one.
import { mutate } from "swr";

import { SettingsForm } from "@/components/settings/SettingsForm";

// ── fetch stub ────────────────────────────────────────────────────────────
let originalFetch: typeof globalThis.fetch | undefined;

function stubSettings(overrides: Record<string, unknown> = {}) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === "/api/settings") {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          hasKey: true,
          keyPreview: "xai-***",
          defaultModel: "grok-4-latest",
          bindHost: "127.0.0.1",
          theme: "system",
          autoRecap: true,
          includeLastChapterFullText: false,
          isElectron: true,
          updates: { checkOnLaunch: true },
          ...overrides,
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
}

// ── Manual mount harness ──────────────────────────────────────────────────
type Mounted = { container: HTMLDivElement; unmount: () => void };

function mount(): Mounted {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root!: Root;
  act(() => {
    root = createRoot(container);
    root.render(React.createElement(SettingsForm));
  });
  return {
    container,
    unmount: () => {
      act(() => { root.unmount(); });
      container.remove();
    },
  };
}

// Wait until the form has finished its initial SWR fetch (the loading
// skeleton "Loading…" is gone).
async function waitForLoaded(container: HTMLDivElement): Promise<void> {
  for (let i = 0; i < 50; i++) {
    await act(async () => { await Promise.resolve(); });
    if (!container.textContent?.includes("Loading…")) return;
  }
  throw new Error("SettingsForm did not finish loading within 50 microtasks");
}

function findButton(container: HTMLDivElement, label: RegExp): HTMLButtonElement | null {
  for (const btn of Array.from(container.querySelectorAll("button"))) {
    if (label.test(btn.textContent ?? "")) return btn as HTMLButtonElement;
  }
  return null;
}

function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function setBridge(
  state: UpdateState,
  opts: { checkNow?: Mock; installNow?: Mock } = {},
) {
  window.scriptrUpdates = {
    getState: vi.fn().mockResolvedValue(state),
    checkNow: opts.checkNow ?? vi.fn().mockResolvedValue(state),
    installNow: opts.installNow ?? vi.fn().mockResolvedValue(undefined),
  } as typeof window.scriptrUpdates;
}

// ── Tests ─────────────────────────────────────────────────────────────────
describe("SettingsForm — Updates section", () => {
  let mounted: Mounted | null = null;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    stubSettings();
    // Drop any cached SWR data so each test sees a fresh /api/settings.
    // `revalidate: true` clears cached data AND forces useSWR to refetch on
    // its next mount; `revalidate: false` left the deduping window in place
    // and the second test never hit fetch.
    await mutate(() => true, undefined, { revalidate: true });
  });

  afterEach(() => {
    mounted?.unmount();
    mounted = null;
    if (originalFetch) globalThis.fetch = originalFetch;
    window.scriptrUpdates = undefined;
  });

  it('renders "Check for updates" button when bridge is available and isElectron', async () => {
    setBridge({ kind: "idle", lastCheckedAt: null, currentVersion: "0.3.0" });
    mounted = mount();
    await waitForLoaded(mounted.container);
    expect(findButton(mounted.container, /check for updates/i)).not.toBeNull();
  });

  it('renders "Never checked." when there is no lastCheckedAt', async () => {
    setBridge({ kind: "idle", lastCheckedAt: null, currentVersion: "0.3.0" });
    mounted = mount();
    await waitForLoaded(mounted.container);
    expect(mounted.container.textContent).toContain("Never checked");
  });

  it('renders "Last checked:" when there is a timestamp', async () => {
    setBridge({ kind: "idle", lastCheckedAt: "2026-04-25T12:00:00Z", currentVersion: "0.3.0" });
    mounted = mount();
    await waitForLoaded(mounted.container);
    expect(mounted.container.textContent).toMatch(/Last checked:/i);
  });

  it('clicking "Check for updates" invokes the bridge', async () => {
    const checkNow = vi.fn().mockResolvedValue({ kind: "checking" });
    setBridge({ kind: "idle", lastCheckedAt: null, currentVersion: "0.3.0" }, { checkNow });
    mounted = mount();
    await waitForLoaded(mounted.container);
    const btn = findButton(mounted.container, /check for updates/i);
    expect(btn).not.toBeNull();
    click(btn!);
    expect(checkNow).toHaveBeenCalledTimes(1);
  });

  it('disables "Check for updates" while checking', async () => {
    setBridge({ kind: "checking" });
    mounted = mount();
    await waitForLoaded(mounted.container);
    const btn = findButton(mounted.container, /check for updates/i);
    expect(btn?.disabled).toBe(true);
    expect(mounted.container.textContent).toContain("Checking");
  });

  it('disables "Check for updates" while downloading and shows the version', async () => {
    setBridge({ kind: "downloading", version: "0.3.1" });
    mounted = mount();
    await waitForLoaded(mounted.container);
    const btn = findButton(mounted.container, /check for updates/i);
    expect(btn?.disabled).toBe(true);
    expect(mounted.container.textContent).toMatch(/downloading version 0\.3\.1/i);
  });

  it('shows "Restart and install" button only when state is downloaded', async () => {
    setBridge({ kind: "downloaded", version: "0.3.1" });
    mounted = mount();
    await waitForLoaded(mounted.container);
    expect(findButton(mounted.container, /restart and install/i)).not.toBeNull();
    expect(mounted.container.textContent).toMatch(/version 0\.3\.1 downloaded/i);
  });

  it('"Restart and install" invokes the bridge', async () => {
    const installNow = vi.fn().mockResolvedValue(undefined);
    setBridge({ kind: "downloaded", version: "0.3.1" }, { installNow });
    mounted = mount();
    await waitForLoaded(mounted.container);
    const btn = findButton(mounted.container, /restart and install/i);
    expect(btn).not.toBeNull();
    click(btn!);
    expect(installNow).toHaveBeenCalledTimes(1);
  });

  it('shows "Couldn\'t reach update server" on error state', async () => {
    setBridge({ kind: "error", message: "ENOTFOUND" });
    mounted = mount();
    await waitForLoaded(mounted.container);
    expect(mounted.container.textContent).toMatch(/couldn't reach update server/i);
  });

  it('shows "You\'re on the latest version (X)" after a checking → idle transition', async () => {
    const checkNow = vi.fn().mockResolvedValue({ kind: "checking" });
    setBridge({ kind: "idle", lastCheckedAt: null, currentVersion: "0.3.0" }, { checkNow });
    mounted = mount();
    await waitForLoaded(mounted.container);

    act(() => {
      window.dispatchEvent(new CustomEvent("scriptr:update-state", { detail: { kind: "checking" } }));
    });
    act(() => {
      window.dispatchEvent(new CustomEvent("scriptr:update-state", {
        detail: { kind: "idle", lastCheckedAt: "2026-04-27T10:00:00Z", currentVersion: "0.3.0" },
      }));
    });
    expect(mounted.container.textContent).toMatch(/you're on the latest version \(0\.3\.0\)/i);
  });

  it("does NOT render the section buttons when isElectron=false (web build)", async () => {
    stubSettings({ isElectron: false });
    setBridge({ kind: "idle", lastCheckedAt: null, currentVersion: "0.3.0" });
    mounted = mount();
    await waitForLoaded(mounted.container);
    expect(findButton(mounted.container, /check for updates/i)).toBeNull();
  });
});
