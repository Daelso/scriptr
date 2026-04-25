// @vitest-environment jsdom
/**
 * Tests for ReaderView's optional author-note rendering.
 *
 * Manual React-19 render harness (no @testing-library/react by project rule),
 * mirrored from tests/components/editor/SectionCard.test.tsx.
 */
import { describe, it, expect } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { ReaderView } from "@/components/reader/ReaderView";
import type { Story, Chapter } from "@/lib/types";

const baseStory = (over: Partial<Story> = {}): Story =>
  ({
    slug: "s",
    title: "T",
    authorPenName: "Jane",
    description: "",
    copyrightYear: 2026,
    language: "en",
    bisacCategory: "FIC027000",
    keywords: [],
    createdAt: "",
    updatedAt: "",
    chapterOrder: [],
    ...over,
  }) as Story;

const baseChapters: Chapter[] = [
  {
    id: "c1",
    title: "Ch1",
    summary: "",
    beats: [],
    prompt: "",
    recap: "",
    sections: [{ id: "s1", content: "Hello." }],
    wordCount: 1,
  } as unknown as Chapter,
];

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
    act(() => {
      root.unmount();
    });
    container.remove();
  };
  return { container, root, unmount };
}

describe("ReaderView author-note", () => {
  it("renders the note block when authorNoteHtml is provided", () => {
    const html =
      '<div class="author-note"><h2>A note from the author</h2><p>Hi</p></div>';
    const { container, unmount } = mount(
      <ReaderView
        story={baseStory()}
        chapters={baseChapters}
        authorNoteHtml={html}
      />,
    );

    expect(container.textContent).toContain("A note from the author");
    expect(container.querySelector(".author-note")).not.toBeNull();

    unmount();
  });

  it("omits the note block when authorNoteHtml is undefined", () => {
    const { container, unmount } = mount(
      <ReaderView story={baseStory()} chapters={baseChapters} />,
    );

    expect(container.textContent).not.toContain("A note from the author");
    expect(container.querySelector(".author-note")).toBeNull();

    unmount();
  });
});
