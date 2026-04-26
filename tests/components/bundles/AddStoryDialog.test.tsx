// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import React, { act, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AddStoryDialog } from "@/components/bundles/AddStoryDialog";
import type { Story } from "@/lib/types";

const SWR_STORIES: Story[] = [
  {
    slug: "story-a",
    title: "Story A",
    authorPenName: "Pen",
    description: "",
    copyrightYear: 2026,
    language: "en",
    bisacCategory: "FIC027000",
    keywords: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    chapterOrder: [],
  },
  {
    slug: "story-b",
    title: "Story B",
    authorPenName: "Pen",
    description: "",
    copyrightYear: 2026,
    language: "en",
    bisacCategory: "FIC027000",
    keywords: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    chapterOrder: [],
  },
];

vi.mock("swr", () => ({
  default: () => ({ data: SWR_STORIES }),
}));

type Mounted = { container: HTMLDivElement; unmount: () => void };
function mount(el: ReactElement): Mounted {
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
  });
}

function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button onClick={() => setOpen(true)} data-testid="reopen">
        Reopen
      </button>
      <AddStoryDialog
        open={open}
        onOpenChange={setOpen}
        excludeSlugs={[]}
        onAdd={async () => {}}
      />
    </div>
  );
}

describe("AddStoryDialog", () => {
  it("clears selected stories when dialog closes via cancel/close", async () => {
    const { container, unmount } = mount(<Harness />);

    const checkbox = document.querySelector(
      '[data-testid="add-story-check-story-a"]',
    ) as HTMLInputElement | null;
    expect(checkbox).toBeTruthy();
    act(() => {
      checkbox!.click();
    });
    expect(checkbox!.checked).toBe(true);

    const closeButton = Array.from(document.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Close"),
    ) as HTMLButtonElement | undefined;
    expect(closeButton).toBeTruthy();
    act(() => {
      closeButton!.click();
    });
    await flush();

    const reopen = container.querySelector('[data-testid="reopen"]') as HTMLButtonElement;
    act(() => {
      reopen.click();
    });
    await flush();

    const checkboxAfterReopen = document.querySelector(
      '[data-testid="add-story-check-story-a"]',
    ) as HTMLInputElement | null;
    expect(checkboxAfterReopen).toBeTruthy();
    expect(checkboxAfterReopen!.checked).toBe(false);

    unmount();
  });
});

