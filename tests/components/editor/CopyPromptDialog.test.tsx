// @vitest-environment jsdom
/**
 * Tests for CopyPromptDialog. Manual React 19 render harness — the project
 * does not use @testing-library/react. Mirrors the pattern in
 * tests/components/editor/StreamOverlay.test.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CopyPromptDialog } from "@/components/editor/CopyPromptDialog";

type Mounted = { container: HTMLDivElement; root: Root; unmount: () => void };

function mount(element: React.ReactElement): Mounted {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root!: Root;
  act(() => {
    root = createRoot(container);
    root.render(element);
  });
  return {
    container,
    root,
    unmount: () => {
      act(() => { root.unmount(); });
      container.remove();
    },
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const SAMPLE_PROMPT = {
  ok: true,
  data: {
    system: "You are a novelist writing Chapter 2 of Test Story.",
    user: "# Story bible\nCharacters:\n- Alice\n\n# Current chapter: Ch2\nBeats:\n- She finds a key",
    meta: {
      chapterIndex: 2,
      priorRecapCount: 1,
      includesLastChapterFullText: false,
      model: "grok-4-fast-reasoning",
    },
  },
};

describe("CopyPromptDialog", () => {
  let originalFetch: typeof globalThis.fetch;
  let originalClipboard: Clipboard | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalClipboard = (globalThis.navigator as Navigator & { clipboard?: Clipboard }).clipboard;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalClipboard === undefined) {
      delete (globalThis.navigator as Navigator & { clipboard?: Clipboard }).clipboard;
    } else {
      Object.defineProperty(globalThis.navigator, "clipboard", {
        configurable: true,
        value: originalClipboard,
      });
    }
    vi.restoreAllMocks();
    // Clean portaled content from prior tests.
    document.body.innerHTML = "";
  });

  it("renders loading state immediately after open", async () => {
    globalThis.fetch = vi.fn(
      () => new Promise<Response>(() => {}),
    ) as typeof globalThis.fetch;
    const { container, unmount } = mount(
      <CopyPromptDialog open slug="s" chapterId="c" onOpenChange={() => {}} />,
    );
    expect(document.body.textContent).toContain("Building prompt");
    expect(container).toBeTruthy();
    unmount();
  });

  it("renders preview and meta strip on success", async () => {
    globalThis.fetch = vi.fn(
      () => Promise.resolve(new Response(JSON.stringify(SAMPLE_PROMPT), { status: 200 })),
    ) as typeof globalThis.fetch;
    const { unmount } = mount(
      <CopyPromptDialog open slug="s" chapterId="c" onOpenChange={() => {}} />,
    );
    await flush();
    expect(document.body.textContent).toContain("Chapter 2");
    expect(document.body.textContent).toContain("1 prior recap");
    expect(document.body.textContent).toContain("grok-4-fast-reasoning");
    expect(document.body.textContent).toContain("# Story bible");
    unmount();
  });

  it("Copy button writes system+user to clipboard and fires success toast", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const { toast } = await import("sonner");
    const successSpy = vi.spyOn(toast, "success").mockImplementation(() => "id");

    globalThis.fetch = vi.fn(
      () => Promise.resolve(new Response(JSON.stringify(SAMPLE_PROMPT), { status: 200 })),
    ) as typeof globalThis.fetch;

    const { unmount } = mount(
      <CopyPromptDialog open slug="s" chapterId="c" onOpenChange={() => {}} />,
    );
    await flush();

    const buttons = Array.from(
      document.body.querySelectorAll("button"),
    ) as HTMLButtonElement[];
    const copyBtn = buttons.find((b) => b.textContent?.trim() === "Copy");
    expect(copyBtn).toBeDefined();
    await act(async () => {
      copyBtn!.click();
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith(
      `${SAMPLE_PROMPT.data.system}\n\n${SAMPLE_PROMPT.data.user}`,
    );
    expect(successSpy).toHaveBeenCalledWith("Prompt copied");
    unmount();
  });

  it("Copy: falls back to manual-copy toast when clipboard.writeText rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const { toast } = await import("sonner");
    const messageSpy = vi.spyOn(toast, "message").mockImplementation(() => "id");

    globalThis.fetch = vi.fn(
      () => Promise.resolve(new Response(JSON.stringify(SAMPLE_PROMPT), { status: 200 })),
    ) as typeof globalThis.fetch;

    const { unmount } = mount(
      <CopyPromptDialog open slug="s" chapterId="c" onOpenChange={() => {}} />,
    );
    await flush();

    const copyBtn = Array.from(
      document.body.querySelectorAll("button"),
    ).find((b) => b.textContent?.trim() === "Copy") as HTMLButtonElement;
    await act(async () => {
      copyBtn.click();
      await flush();
    });

    expect(writeText).toHaveBeenCalled();
    expect(messageSpy).toHaveBeenCalledWith("Select and copy manually (Cmd/Ctrl+C)");
    unmount();
  });

  it("renders error state and Retry re-fetches", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ ok: false, error: "bible not found" }),
            { status: 404 },
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(SAMPLE_PROMPT), { status: 200 }),
      );
    }) as typeof globalThis.fetch;

    const { unmount } = mount(
      <CopyPromptDialog open slug="s" chapterId="c" onOpenChange={() => {}} />,
    );
    await flush();
    expect(document.body.textContent).toContain("Error: bible not found");

    const retryBtn = Array.from(
      document.body.querySelectorAll("button"),
    ).find((b) => b.textContent?.trim() === "Retry") as HTMLButtonElement;
    expect(retryBtn).toBeDefined();

    await act(async () => {
      retryBtn.click();
      await flush();
    });

    expect(callCount).toBe(2);
    expect(document.body.textContent).toContain("# Story bible");
    unmount();
  });
});
