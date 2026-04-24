// @vitest-environment jsdom
/**
 * Tests for NewStoryFromNovelAIDialog — manual React 19 harness (no @testing-library).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NewStoryFromNovelAIDialog } from "@/components/import/NewStoryFromNovelAIDialog";

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

function fakeParsedResponse() {
  return {
    ok: true,
    data: {
      parsed: {
        title: "Garden at Dusk",
        description: "a desc",
        tags: ["a", "b"],
        textPreview: "",
        contextBlocks: [],
        lorebookEntries: [],
        prose: "body one\n\n////\n\nbody two",
      },
      split: {
        chapters: [
          { title: "One", body: "body one" },
          { title: "Two", body: "body two" },
        ],
        splitSource: "marker",
      },
      proposed: {
        story: {
          title: "Garden at Dusk",
          description: "a desc",
          keywords: ["a", "b"],
        },
        bible: {
          characters: [{ name: "Mira", description: "a gardener" }],
          setting: "## Walled Garden\nold stones",
          pov: "third-limited",
          tone: "",
          styleNotes: "",
          nsfwPreferences: "",
        },
      },
    },
  };
}

function setFileOnInput(input: HTMLInputElement, file: File) {
  // JSDOM doesn't let us assign .files directly. Use defineProperty.
  Object.defineProperty(input, "files", {
    value: [file],
    writable: false,
    configurable: true,
  });
  act(() => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("NewStoryFromNovelAIDialog", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = global.fetch;
    push.mockReset();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("shows the file picker on open", () => {
    const { container, unmount } = mount(
      <NewStoryFromNovelAIDialog open onOpenChange={() => {}} />
    );
    expect(container.textContent ?? "").toMatch(/import from novelai/i);
    expect(container.querySelector('input[type="file"]')).toBeTruthy();
    unmount();
  });

  it("parses the file and renders the preview on upload", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(fakeParsedResponse()), { status: 200 })
    ) as unknown as typeof fetch;

    const { container, unmount } = mount(
      <NewStoryFromNovelAIDialog open onOpenChange={() => {}} />
    );
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    setFileOnInput(
      fileInput,
      new File([new Uint8Array([1, 2, 3])], "x.story", {
        type: "application/octet-stream",
      })
    );

    await flush();
    await flush();

    const titleInput = container.querySelector('input[value="Garden at Dusk"]') as HTMLInputElement | null;
    expect(titleInput).toBeTruthy();
    expect(container.textContent ?? "").toMatch(/Mira/);
    expect(container.textContent ?? "").toMatch(/## Walled Garden/);

    const chapterBodies = Array.from(container.querySelectorAll("textarea"))
      .map((t) => (t as HTMLTextAreaElement).value);
    expect(chapterBodies.some((v) => v.includes("body one"))).toBe(true);
    expect(chapterBodies.some((v) => v.includes("body two"))).toBe(true);

    unmount();
  });

  it("commits and navigates on 'Create story'", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(fakeParsedResponse()), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, data: { slug: "garden-at-dusk", chapterIds: ["a", "b"] } }),
          { status: 200 }
        )
      ) as unknown as typeof fetch;

    const { container, unmount } = mount(
      <NewStoryFromNovelAIDialog open onOpenChange={() => {}} />
    );
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    setFileOnInput(
      fileInput,
      new File([new Uint8Array([1, 2, 3])], "x.story")
    );
    await flush();
    await flush();

    const buttons = Array.from(container.querySelectorAll("button"));
    const createBtn = buttons.find((b) => /create story/i.test(b.textContent ?? "")) as HTMLButtonElement;
    expect(createBtn).toBeTruthy();
    act(() => {
      createBtn.click();
    });
    await flush();
    await flush();

    expect(push).toHaveBeenCalledWith("/s/garden-at-dusk");
    unmount();
  });

  it("shows the parse error and a 'Choose a different file' button on parse failure", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ ok: false, error: "Unsupported NovelAI format version: got 99, expected 1." }),
        { status: 400 }
      )
    ) as unknown as typeof fetch;

    const { container, unmount } = mount(
      <NewStoryFromNovelAIDialog open onOpenChange={() => {}} />
    );
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    setFileOnInput(fileInput, new File([new Uint8Array([1])], "bad.story"));
    await flush();
    await flush();

    expect(container.textContent ?? "").toMatch(/Unsupported NovelAI format version/);
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.some((b) => /choose a different file/i.test(b.textContent ?? ""))).toBe(true);
    unmount();
  });
});
