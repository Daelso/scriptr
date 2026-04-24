// @vitest-environment jsdom
/**
 * Tests for AddChaptersFromNovelAIDialog — manual React 19 harness.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AddChaptersFromNovelAIDialog } from "@/components/import/AddChaptersFromNovelAIDialog";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// SafeHtml + EPUB_STYLESHEET are pure render helpers — no mocking needed.

function mount(el: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root!: Root;
  act(() => {
    root = createRoot(container);
    root.render(el);
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

function setFileOnInput(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, "files", { value: [file], writable: false, configurable: true });
  act(() => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function fakeParseResp() {
  return {
    ok: true,
    data: {
      parsed: {
        title: "Ignored Title",
        description: "",
        tags: ["ignored"],
        textPreview: "",
        contextBlocks: [],
        lorebookEntries: [],
        prose: "a\n\n////\n\nb",
      },
      split: {
        chapters: [
          { title: "A", body: "a" },
          { title: "B", body: "b" },
        ],
        splitSource: "marker",
      },
      proposed: {
        story: { title: "Ignored Title", description: "", keywords: ["ignored"] },
        bible: {
          characters: [],
          setting: "",
          pov: "third-limited",
          tone: "",
          styleNotes: "",
          nsfwPreferences: "",
        },
      },
    },
  };
}

describe("AddChaptersFromNovelAIDialog", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = global.fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("shows the discarded-data banner and recap checkbox in the preview", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(fakeParseResp()), { status: 200 })
    ) as unknown as typeof fetch;

    const onImported = vi.fn();
    const { container, unmount } = mount(
      <AddChaptersFromNovelAIDialog
        slug="host-story"
        open
        onOpenChange={() => {}}
        onImported={onImported}
      />
    );
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    setFileOnInput(fileInput, new File([new Uint8Array([1])], "x.story"));

    await flush();
    await flush();

    expect(container.textContent ?? "").toMatch(/ignored in this mode/i);

    // Find the recap checkbox. It has accessible text "Generate recap via Grok".
    const allLabels = Array.from(container.querySelectorAll("label"));
    const recapLabel = allLabels.find((l) => /generate recap via grok/i.test(l.textContent ?? ""));
    expect(recapLabel).toBeTruthy();
    const recap = recapLabel!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(recap.checked).toBe(false);

    unmount();
  });

  it("fires recap requests sequentially when the checkbox is on", async () => {
    const recapCalls: unknown[] = [];
    const fetchMock = vi.fn().mockImplementation(async (url: unknown, init?: { body?: string }) => {
      const u = String(url);
      if (u.endsWith("/parse")) {
        return new Response(JSON.stringify(fakeParseResp()), { status: 200 });
      }
      if (u.endsWith("/commit")) {
        return new Response(
          JSON.stringify({
            ok: true,
            data: { slug: "host-story", chapterIds: ["id-a", "id-b"] },
          }),
          { status: 200 }
        );
      }
      if (u.endsWith("/api/generate/recap")) {
        recapCalls.push(JSON.parse(init?.body ?? "{}"));
        return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 });
      }
      return new Response("", { status: 404 });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { container, unmount } = mount(
      <AddChaptersFromNovelAIDialog
        slug="host-story"
        open
        onOpenChange={() => {}}
        onImported={() => {}}
      />
    );
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    setFileOnInput(fileInput, new File([new Uint8Array([1])], "x.story"));
    await flush();
    await flush();

    // Click the recap checkbox.
    const allLabels = Array.from(container.querySelectorAll("label"));
    const recapLabel = allLabels.find((l) => /generate recap via grok/i.test(l.textContent ?? ""));
    const recap = recapLabel!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    act(() => {
      recap.click();
    });
    await flush();

    // Click the commit button.
    const buttons = Array.from(container.querySelectorAll("button"));
    const addBtn = buttons.find((b) => /add 2 chapter/i.test(b.textContent ?? "")) as HTMLButtonElement;
    expect(addBtn).toBeTruthy();
    act(() => {
      addBtn.click();
    });
    await flush();
    await flush();
    await flush();
    await flush();

    expect(recapCalls).toHaveLength(2);
    expect(recapCalls[0]).toMatchObject({ storySlug: "host-story", chapterId: "id-a" });
    expect(recapCalls[1]).toMatchObject({ storySlug: "host-story", chapterId: "id-b" });
    unmount();
  });
});
