// @vitest-environment jsdom
/**
 * Manual React 19 harness — mirrors NewStoryFromNovelAIDialog.test.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SWRConfig } from "swr";
import { NewStoryFromEpubDialog } from "@/components/import/NewStoryFromEpubDialog";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

type Mounted = { container: HTMLDivElement; unmount: () => void };
function mount(el: React.ReactElement): Mounted {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root!: Root;
  const wrapped = React.createElement(
    SWRConfig,
    { value: { provider: () => new Map() } },
    el,
  );
  act(() => {
    root = createRoot(container);
    root.render(wrapped);
  });
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function fakeParseResponse(over: Partial<{ hasCover: boolean; coverPreview: string | null; sessionId: string }> = {}) {
  return {
    ok: true,
    data: {
      parsed: {
        metadata: { title: "T", creator: "Jane", description: "", subjects: [], language: "en" },
        chapters: [
          { navTitle: "Copyright", body: "© 2026", wordCount: 2, source: "nav" as const, skippedByDefault: true, skipReason: "Matched 'copyright' rule" },
          { navTitle: "Chapter 1", body: "Real prose here.", wordCount: 3, source: "nav" as const, skippedByDefault: false },
          { navTitle: "Chapter 2", body: "More prose here.", wordCount: 3, source: "nav" as const, skippedByDefault: false },
        ],
        epubVersion: 3 as const,
        hasCover: over.hasCover ?? true,
      },
      proposed: {
        story: { title: "T", description: "", keywords: [], authorPenName: "" },
        bible: { characters: [], setting: "", pov: "third-limited", tone: "", styleNotes: "", nsfwPreferences: "" },
        chapters: [
          { navTitle: "Copyright", body: "© 2026", wordCount: 2, source: "nav" as const, skippedByDefault: true, skipReason: "Matched 'copyright' rule" },
          { navTitle: "Chapter 1", body: "Real prose here.", wordCount: 3, source: "nav" as const, skippedByDefault: false },
          { navTitle: "Chapter 2", body: "More prose here.", wordCount: 3, source: "nav" as const, skippedByDefault: false },
        ],
        penNameMatch: "none" as const,
        hasCover: over.hasCover ?? true,
      },
      coverPreview: over.coverPreview ?? "data:image/jpeg;base64,xxx",
      sessionId: over.sessionId ?? "sess-1",
    },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  push.mockReset();
});
afterEach(() => {
  document.body.replaceChildren();
});

describe("NewStoryFromEpubDialog", () => {
  it("uploads a file, transitions to preview, and shows chapter rows", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      if (typeof url === "string" && url.includes("/api/import/epub/parse")) {
        return new Response(JSON.stringify(fakeParseResponse()), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, data: { penNameProfiles: {} } }), { status: 200 });
    });

    const m = mount(
      React.createElement(NewStoryFromEpubDialog, {
        open: true,
        onOpenChange: () => undefined,
      }),
    );
    await flush();

    const input = m.container.ownerDocument.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();

    const file = new File([new Uint8Array([0x50, 0x4b])], "x.epub", { type: "application/epub+zip" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await flush();

    // Chapter navTitles are rendered as plain <span> text when collapsed.
    const docText = m.container.ownerDocument.body.textContent ?? "";
    expect(docText).toContain("Copyright");
    expect(docText).toContain("Chapter 1");
    expect(docText).toContain("Chapter 2");

    fetchMock.mockRestore();
    m.unmount();
  });

  it("commits with only checked chapters and routes to /s/<slug> on success", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (url, init) => {
      if (typeof url === "string" && url.includes("/api/import/epub/parse")) {
        return new Response(JSON.stringify(fakeParseResponse()), { status: 200 });
      }
      if (typeof url === "string" && url.includes("/api/import/epub/commit")) {
        const body = JSON.parse((init?.body as string) ?? "{}") as {
          chapters: Array<{ title: string }>;
        };
        expect(body.chapters.map((c) => c.title)).toEqual(["Chapter 1", "Chapter 2"]);
        return new Response(
          JSON.stringify({ ok: true, data: { slug: "t", chapterIds: ["a", "b"] } }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 });
    });

    const m = mount(
      React.createElement(NewStoryFromEpubDialog, {
        open: true,
        onOpenChange: () => undefined,
      }),
    );
    await flush();
    const input = m.container.ownerDocument.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([0x50, 0x4b])], "x.epub", { type: "application/epub+zip" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await flush();

    const buttons = Array.from(
      m.container.ownerDocument.querySelectorAll("button"),
    ) as HTMLButtonElement[];
    const createBtn = buttons.find((b) => /create story/i.test(b.textContent ?? ""))!;
    expect(createBtn).toBeTruthy();
    await act(async () => createBtn.click());
    await flush();

    expect(push).toHaveBeenCalledWith("/s/t");

    fetchMock.mockRestore();
    m.unmount();
  });

  it("shows error panel + reset button on parse failure", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      if (typeof url === "string" && url.includes("/api/import/epub/parse")) {
        return new Response(JSON.stringify({ ok: false, error: "DRM-protected" }), {
          status: 400,
        });
      }
      return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 });
    });

    const m = mount(
      React.createElement(NewStoryFromEpubDialog, {
        open: true,
        onOpenChange: () => undefined,
      }),
    );
    await flush();
    const input = m.container.ownerDocument.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([0x50, 0x4b])], "x.epub");
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await flush();

    const docText = m.container.ownerDocument.body.textContent ?? "";
    expect(docText).toContain("DRM-protected");

    const buttons = Array.from(
      m.container.ownerDocument.querySelectorAll("button"),
    ) as HTMLButtonElement[];
    const resetBtn = buttons.find((b) => /choose a different file/i.test(b.textContent ?? ""))!;
    await act(async () => resetBtn.click());
    await flush();

    expect(m.container.ownerDocument.querySelector('input[type="file"]')).toBeTruthy();

    fetchMock.mockRestore();
    m.unmount();
  });
});
