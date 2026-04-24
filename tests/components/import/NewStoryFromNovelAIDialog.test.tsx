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

const EMPTY_BIBLE = {
  characters: [],
  setting: "",
  pov: "third-limited",
  tone: "",
  styleNotes: "",
  nsfwPreferences: "",
};

function fakeSingleStoryResponse() {
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
        prose: "Chapter 1\n\nbody one\n\nChapter 2\n\nbody two",
      },
      stories: [
        {
          split: {
            chapters: [
              { title: "One", body: "body one" },
              { title: "Two", body: "body two" },
            ],
            splitSource: "heading",
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
      ],
    },
  };
}

function fakeMultiStoryResponse() {
  return {
    ok: true,
    data: {
      parsed: {
        title: "Saga",
        description: "",
        tags: [],
        textPreview: "",
        contextBlocks: [],
        lorebookEntries: [],
        prose: "a\n\n////\n\nb\n\n////\n\nc",
      },
      stories: [
        {
          split: {
            chapters: [{ title: "Opening", body: "alpha" }],
            splitSource: "none",
          },
          proposed: {
            story: { title: "Saga - Part 1", description: "", keywords: [] },
            bible: EMPTY_BIBLE,
          },
        },
        {
          split: {
            chapters: [{ title: "Middle", body: "beta" }],
            splitSource: "none",
          },
          proposed: {
            story: { title: "Saga - Part 2", description: "", keywords: [] },
            bible: EMPTY_BIBLE,
          },
        },
      ],
    },
  };
}

function setFileOnInput(input: HTMLInputElement, file: File) {
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

  it("parses the file and renders the single-story preview on upload", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(fakeSingleStoryResponse()), { status: 200 })
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

    const titleInput = container.querySelector(
      'input[value="Garden at Dusk"]'
    ) as HTMLInputElement | null;
    expect(titleInput).toBeTruthy();
    expect(container.textContent ?? "").toMatch(/Mira/);
    expect(container.textContent ?? "").toMatch(/## Walled Garden/);
    // No multi-story card when there's only one story.
    expect(container.querySelector('[data-testid="story-card-0"]')).toBeNull();

    const chapterBodies = Array.from(container.querySelectorAll("textarea"))
      .map((t) => (t as HTMLTextAreaElement).value);
    expect(chapterBodies.some((v) => v.includes("body one"))).toBe(true);
    expect(chapterBodies.some((v) => v.includes("body two"))).toBe(true);

    unmount();
  });

  it("renders one story-card per story when multi-story", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(fakeMultiStoryResponse()), { status: 200 })
    ) as unknown as typeof fetch;

    const { container, unmount } = mount(
      <NewStoryFromNovelAIDialog open onOpenChange={() => {}} />
    );
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    setFileOnInput(fileInput, new File([new Uint8Array([1])], "x.txt"));
    await flush();
    await flush();

    // Two story cards.
    expect(container.querySelector('[data-testid="story-card-0"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="story-card-1"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="story-card-2"]')).toBeNull();

    // Commit button reflects the count.
    const buttons = Array.from(container.querySelectorAll("button"));
    const createBtn = buttons.find((b) => /create 2 stories/i.test(b.textContent ?? ""));
    expect(createBtn).toBeTruthy();

    // Both titles appear as input values.
    expect(container.querySelector('input[value="Saga - Part 1"]')).toBeTruthy();
    expect(container.querySelector('input[value="Saga - Part 2"]')).toBeTruthy();

    unmount();
  });

  it("removes a story-card when its 'Remove' button is clicked", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(fakeMultiStoryResponse()), { status: 200 })
    ) as unknown as typeof fetch;

    const { container, unmount } = mount(
      <NewStoryFromNovelAIDialog open onOpenChange={() => {}} />
    );
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    setFileOnInput(fileInput, new File([new Uint8Array([1])], "x.txt"));
    await flush();
    await flush();

    // Sanity: 2 story cards rendered, commit button reads "Create 2 stories".
    expect(container.querySelector('[data-testid="story-card-0"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="story-card-1"]')).toBeTruthy();
    let buttons = Array.from(container.querySelectorAll("button"));
    expect(
      buttons.find((b) => /create 2 stories/i.test(b.textContent ?? ""))
    ).toBeTruthy();

    // Click "Remove" on Story 1 (the first card). Both Remove buttons share
    // the aria-label `Remove story N`; click the one for story 1.
    const removeBtn = buttons.find(
      (b) => b.getAttribute("aria-label") === "Remove story 1"
    ) as HTMLButtonElement;
    expect(removeBtn).toBeTruthy();
    expect(removeBtn.disabled).toBe(false);
    act(() => {
      removeBtn.click();
    });
    await flush();

    // Now there's only 1 card. The remaining card is the one that was
    // originally Story 2 — its title input should still hold "Saga - Part 2".
    expect(container.querySelector('[data-testid="story-card-1"]')).toBeNull();
    expect(container.querySelector('input[value="Saga - Part 2"]')).toBeTruthy();
    expect(container.querySelector('input[value="Saga - Part 1"]')).toBeNull();

    // Commit button label updates to single-story copy.
    buttons = Array.from(container.querySelectorAll("button"));
    expect(
      buttons.find((b) => /^create story$/i.test(b.textContent ?? ""))
    ).toBeTruthy();

    // The remaining card's Remove button is now disabled (can't remove the last).
    const remainingRemove = buttons.find(
      (b) => b.getAttribute("aria-label") === "Remove story 1"
    ) as HTMLButtonElement | undefined;
    if (remainingRemove) {
      expect(remainingRemove.disabled).toBe(true);
    }

    unmount();
  });

  it("commit payload after removing one story only contains the remaining story", async () => {
    let commitBody: unknown = null;
    const fetchMock = vi.fn().mockImplementation(async (url: unknown, init?: { body?: string }) => {
      const u = String(url);
      if (u.endsWith("/parse")) {
        return new Response(JSON.stringify(fakeMultiStoryResponse()), { status: 200 });
      }
      if (u.endsWith("/commit")) {
        commitBody = JSON.parse(init?.body ?? "{}");
        return new Response(
          JSON.stringify({
            ok: true,
            data: { slugs: ["saga-part-2"], chapterIds: ["c1"] },
          }),
          { status: 200 }
        );
      }
      return new Response("", { status: 404 });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { container, unmount } = mount(
      <NewStoryFromNovelAIDialog open onOpenChange={() => {}} />
    );
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    setFileOnInput(fileInput, new File([new Uint8Array([1])], "x.txt"));
    await flush();
    await flush();

    // Drop story 1.
    const buttons = Array.from(container.querySelectorAll("button"));
    const removeBtn = buttons.find(
      (b) => b.getAttribute("aria-label") === "Remove story 1"
    ) as HTMLButtonElement;
    act(() => {
      removeBtn.click();
    });
    await flush();

    // Click commit. Label is now "Create story" (single).
    const buttonsAfter = Array.from(container.querySelectorAll("button"));
    const createBtn = buttonsAfter.find((b) =>
      /^create story$/i.test(b.textContent ?? "")
    ) as HTMLButtonElement;
    act(() => {
      createBtn.click();
    });
    await flush();
    await flush();

    expect(commitBody).toBeTruthy();
    const payload = commitBody as {
      target: string;
      stories: Array<{ story: { title: string } }>;
    };
    expect(payload.target).toBe("new-story");
    expect(payload.stories).toHaveLength(1);
    expect(payload.stories[0].story.title).toBe("Saga - Part 2");

    unmount();
  });

  it("Remove button is hidden/disabled when only one story is present (single-story mode)", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(fakeSingleStoryResponse()), { status: 200 })
    ) as unknown as typeof fetch;

    const { container, unmount } = mount(
      <NewStoryFromNovelAIDialog open onOpenChange={() => {}} />
    );
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    setFileOnInput(fileInput, new File([new Uint8Array([1])], "x.txt"));
    await flush();
    await flush();

    // Single-story mode renders without story-card containers, so no Remove
    // button should exist at all.
    const removeBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label")?.startsWith("Remove story")
    );
    expect(removeBtn).toBeUndefined();

    unmount();
  });

  it("commits and navigates to the first slug on 'Create story' (single)", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(fakeSingleStoryResponse()), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            data: { slugs: ["garden-at-dusk"], chapterIds: ["a", "b"] },
          }),
          { status: 200 }
        )
      ) as unknown as typeof fetch;

    const { container, unmount } = mount(
      <NewStoryFromNovelAIDialog open onOpenChange={() => {}} />
    );
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    setFileOnInput(fileInput, new File([new Uint8Array([1, 2, 3])], "x.story"));
    await flush();
    await flush();

    const buttons = Array.from(container.querySelectorAll("button"));
    const createBtn = buttons.find((b) =>
      /^\s*create story\s*$/i.test(b.textContent ?? "")
    ) as HTMLButtonElement;
    expect(createBtn).toBeTruthy();
    act(() => {
      createBtn.click();
    });
    await flush();
    await flush();

    expect(push).toHaveBeenCalledWith("/s/garden-at-dusk");
    unmount();
  });

  it("commits multi-story and navigates to the first slug", async () => {
    const commitBodies: unknown[] = [];
    global.fetch = vi
      .fn()
      .mockImplementation(async (url: unknown, init?: { body?: string }) => {
        const u = String(url);
        if (u.endsWith("/parse")) {
          return new Response(JSON.stringify(fakeMultiStoryResponse()), { status: 200 });
        }
        if (u.endsWith("/commit")) {
          commitBodies.push(JSON.parse(init?.body ?? "{}"));
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                slugs: ["saga-part-1", "saga-part-2"],
                chapterIds: ["c1", "c2"],
              },
            }),
            { status: 200 }
          );
        }
        return new Response("", { status: 404 });
      }) as unknown as typeof fetch;

    const { container, unmount } = mount(
      <NewStoryFromNovelAIDialog open onOpenChange={() => {}} />
    );
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    setFileOnInput(fileInput, new File([new Uint8Array([1])], "x.txt"));
    await flush();
    await flush();

    const buttons = Array.from(container.querySelectorAll("button"));
    const createBtn = buttons.find((b) =>
      /create 2 stories/i.test(b.textContent ?? "")
    ) as HTMLButtonElement;
    expect(createBtn).toBeTruthy();
    act(() => {
      createBtn.click();
    });
    await flush();
    await flush();

    // Commit payload is the new `stories: []` shape.
    expect(commitBodies).toHaveLength(1);
    const payload = commitBodies[0] as {
      target: string;
      stories: Array<{ story: { title: string } }>;
    };
    expect(payload.target).toBe("new-story");
    expect(payload.stories).toHaveLength(2);
    expect(payload.stories[0].story.title).toBe("Saga - Part 1");
    expect(payload.stories[1].story.title).toBe("Saga - Part 2");

    // Routes to the first slug.
    expect(push).toHaveBeenCalledWith("/s/saga-part-1");
    unmount();
  });

  it("shows the parse error and a 'Choose a different file' button on parse failure", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          error: "Unsupported NovelAI format version: got 99, expected 1.",
        }),
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
    expect(
      buttons.some((b) => /choose a different file/i.test(b.textContent ?? ""))
    ).toBe(true);
    unmount();
  });
});
