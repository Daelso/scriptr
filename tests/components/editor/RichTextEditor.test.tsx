// @vitest-environment jsdom
/**
 * Tests for RichTextEditor — a small TipTap-based rich-text editor with a
 * paragraph-only toolbar (Bold / Italic / Link). Uses the project's manual
 * React-19 render harness (no @testing-library/react), mirroring the pattern
 * in tests/components/editor/SectionCard.test.tsx.
 *
 * NOTE: Simulating keystrokes inside TipTap under jsdom is brittle (selection
 * APIs are stubbed; ProseMirror's view layer expects real ranges). The
 * Playwright e2e in Chunk 7 exercises the full typing flow against a real
 * browser. These vitest tests verify only the structural wiring: the
 * component mounts, renders the initial HTML, exposes the toolbar with
 * the correct aria-labels, and propagates prop changes via setContent.
 */
import { describe, it, expect, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { RichTextEditor } from "@/components/editor/RichTextEditor";

type Mounted = {
  container: HTMLDivElement;
  root: Root;
  unmount: () => void;
  rerender: (element: React.ReactElement) => void;
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
  const rerender = (el: React.ReactElement) => {
    act(() => {
      root.render(el);
    });
  };
  return { container, root, unmount, rerender };
}

describe("RichTextEditor", () => {
  it("renders initial HTML", () => {
    const { container, unmount } = mount(
      <RichTextEditor
        initialHtml="<p>Hello <strong>world</strong></p>"
        onChange={() => {}}
      />,
    );

    // The TipTap contenteditable host carries the stable .tiptap-rich-editor
    // class. The toolbar renders its own <strong>B</strong> button label, so
    // we scope the assertion to the editor surface to find the rendered
    // initial HTML rather than the toolbar icon.
    const surface = container.querySelector(".tiptap-rich-editor");
    expect(surface).not.toBeNull();
    const strong = surface!.querySelector("strong");
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe("world");
    expect(surface!.textContent).toContain("Hello");

    unmount();
  });

  it("renders the toolbar with Bold, Italic, and Link buttons", () => {
    const { container, unmount } = mount(
      <RichTextEditor initialHtml="<p></p>" onChange={() => {}} />,
    );

    const boldBtn = container.querySelector('[aria-label="Bold"]');
    const italicBtn = container.querySelector('[aria-label="Italic"]');
    const linkBtn = container.querySelector('[aria-label="Link"]');

    expect(boldBtn).not.toBeNull();
    expect(italicBtn).not.toBeNull();
    expect(linkBtn).not.toBeNull();

    // The contenteditable host must use the stable `tiptap-rich-editor` class
    // because Task 6.2 settings UI and Task 7.2 e2e select on it.
    expect(container.querySelector(".tiptap-rich-editor")).not.toBeNull();

    unmount();
  });

  it("re-syncs editor content when initialHtml prop changes", () => {
    const onChange = vi.fn();
    const { container, unmount, rerender } = mount(
      <RichTextEditor initialHtml="<p>first</p>" onChange={onChange} />,
    );

    const surface = () =>
      container.querySelector(".tiptap-rich-editor") as HTMLElement | null;
    expect(surface()?.textContent).toContain("first");

    rerender(
      <RichTextEditor initialHtml="<p>second</p>" onChange={onChange} />,
    );

    // After the prop change the new content should be visible inside the
    // editor surface, and the resync must NOT have triggered onChange
    // (emitUpdate: false).
    expect(surface()?.textContent).toContain("second");
    expect(onChange).not.toHaveBeenCalled();

    unmount();
  });

  it("clicking Bold toggles bold via the editor command (smoke test)", () => {
    // We don't simulate typing in jsdom, but we can confirm the toolbar
    // buttons are wired up: clicking Bold should not throw and the editor
    // should still be mounted afterward.
    const onChange = vi.fn();
    const { container, unmount } = mount(
      <RichTextEditor initialHtml="<p>x</p>" onChange={onChange} />,
    );

    const boldBtn = container.querySelector(
      '[aria-label="Bold"]',
    ) as HTMLButtonElement;
    expect(boldBtn).not.toBeNull();

    act(() => {
      boldBtn.click();
    });

    // Editor should still be rendered after the click.
    expect(container.querySelector(".tiptap-rich-editor")).not.toBeNull();

    unmount();
  });
});
