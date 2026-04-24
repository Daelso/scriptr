// @vitest-environment jsdom
/**
 * Tests for ChapterEditList — editable chapter list for NovelAI import dialogs.
 *
 * Manual React-19 render harness (no @testing-library/react by project rule).
 */
import { describe, it, expect, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { ChapterEditList } from "@/components/import/ChapterEditList";
import type { ProposedChapter } from "@/lib/novelai/types";

const initial: ProposedChapter[] = [
  { title: "One", body: "body one" },
  { title: "Two", body: "body two" },
  { title: "", body: "body three" },
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

/** Fire a React-compatible change event on a controlled input/textarea. */
function fireChange(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    el.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    nativeSetter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("ChapterEditList", () => {
  it("renders one row per chapter with editable title", () => {
    const { container, unmount } = mount(
      <ChapterEditList chapters={initial} splitSource="marker" onChange={() => {}} />,
    );

    const inputs = Array.from(container.querySelectorAll("input"));
    expect(inputs).toHaveLength(3);

    const values = inputs.map((i) => i.value);
    expect(values).toContain("One");
    expect(values).toContain("Two");
    // third chapter has empty title
    expect(values).toContain("");

    unmount();
  });

  it("calls onChange when a title is edited", () => {
    const onChange = vi.fn();
    const { container, unmount } = mount(
      <ChapterEditList chapters={initial} splitSource="marker" onChange={onChange} />,
    );

    const inputs = Array.from(container.querySelectorAll("input"));
    const oneInput = inputs.find((i) => i.value === "One")!;
    expect(oneInput).toBeTruthy();

    fireChange(oneInput, "One Updated");

    expect(onChange).toHaveBeenCalled();
    const last: ProposedChapter[] =
      onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(last[0].title).toBe("One Updated");

    unmount();
  });

  it("removes a chapter when delete is clicked", () => {
    const onChange = vi.fn();
    const { container, unmount } = mount(
      <ChapterEditList chapters={initial} splitSource="marker" onChange={onChange} />,
    );

    // All buttons with aria-label matching /delete/i
    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).filter((b) => /delete/i.test(b.getAttribute("aria-label") ?? ""));
    expect(buttons.length).toBeGreaterThanOrEqual(3);

    act(() => {
      buttons[1].click();
    });

    const last: ProposedChapter[] =
      onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(last).toHaveLength(2);
    expect(last.map((c) => c.title)).toEqual(["One", ""]);

    unmount();
  });

  it("merges a chapter into the next when 'merge with next' is clicked", () => {
    const onChange = vi.fn();
    const { container, unmount } = mount(
      <ChapterEditList chapters={initial} splitSource="marker" onChange={onChange} />,
    );

    const mergeButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).filter((b) => /merge with next/i.test(b.getAttribute("aria-label") ?? ""));
    // Row 0's "merge with next" should combine rows 0+1.
    act(() => {
      mergeButtons[0].click();
    });

    const last: ProposedChapter[] =
      onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(last).toHaveLength(2);
    expect(last[0].title).toBe("One");
    expect(last[0].body).toBe("body one\n\nbody two");

    unmount();
  });

  it("shows the split-source badge", () => {
    const { container, unmount } = mount(
      <ChapterEditList
        chapters={initial}
        splitSource="scenebreak-fallback"
        onChange={() => {}}
      />,
    );

    const text = container.textContent ?? "";
    expect(/scene breaks/i.test(text)).toBe(true);

    unmount();
  });
});
