// @vitest-environment jsdom
/**
 * Tests for AuthorNoteCard — the per-story Author Note toggle + override
 * editor that lives on the MetadataPane. Manual React-19 render harness,
 * mirroring tests/components/editor/RichTextEditor.test.tsx.
 *
 * The card itself is presentational: it takes `story`, `profile`, and an
 * `onChange` callback. The wiring to /api/stories/[slug]/PATCH and the
 * /api/settings fetch is done in MetadataPane's container — those paths
 * are exercised by the Task 7.2 Playwright e2e, not here.
 */
import { describe, it, expect, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { AuthorNoteCard } from "@/components/editor/AuthorNoteCard";
import type { Story } from "@/lib/types";
import type { PenNameProfile } from "@/lib/config";

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

const baseStory = (over: Partial<Story> = {}): Story => ({
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
});

describe("AuthorNoteCard", () => {
  it("disables toggle and shows hint when no profile exists", () => {
    const { container, unmount } = mount(
      <AuthorNoteCard
        story={baseStory()}
        profile={undefined}
        onChange={vi.fn()}
      />,
    );

    const toggle = container.querySelector(
      '[data-testid="author-note-toggle"]',
    ) as HTMLInputElement | null;
    expect(toggle).not.toBeNull();
    expect(toggle!.disabled).toBe(true);

    // Helper text should mention setting up a pen-name profile.
    expect(container.textContent).toContain("Set up a pen-name profile");
    // And the pen name should be referenced.
    expect(container.textContent).toContain("Jane");

    unmount();
  });

  it("defaults toggle to checked when profile exists and authorNote undefined", () => {
    const profile: PenNameProfile = { email: "j@example.com" };
    const { container, unmount } = mount(
      <AuthorNoteCard
        story={baseStory()}
        profile={profile}
        onChange={vi.fn()}
      />,
    );

    const toggle = container.querySelector(
      '[data-testid="author-note-toggle"]',
    ) as HTMLInputElement;
    expect(toggle).not.toBeNull();
    expect(toggle.disabled).toBe(false);
    expect(toggle.checked).toBe(true);

    unmount();
  });

  it("reflects authorNote.enabled when explicitly set", () => {
    const profile: PenNameProfile = {};
    const { container, unmount } = mount(
      <AuthorNoteCard
        story={baseStory({ authorNote: { enabled: false } })}
        profile={profile}
        onChange={vi.fn()}
      />,
    );

    const toggle = container.querySelector(
      '[data-testid="author-note-toggle"]',
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(false);

    unmount();
  });

  it("emits onChange when toggle flipped", () => {
    const onChange = vi.fn();
    const profile: PenNameProfile = {};
    const { container, unmount } = mount(
      <AuthorNoteCard
        story={baseStory({ authorNote: { enabled: true, messageHtml: "<p>hi</p>" } })}
        profile={profile}
        onChange={onChange}
      />,
    );

    const toggle = container.querySelector(
      '[data-testid="author-note-toggle"]',
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(true);

    act(() => {
      toggle.click();
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const arg = onChange.mock.calls[0][0];
    expect(arg).toBeDefined();
    expect(arg.enabled).toBe(false);
    // messageHtml should be preserved when toggling off.
    expect(arg.messageHtml).toBe("<p>hi</p>");

    unmount();
  });

  it("renders the profile default preview when override is empty", () => {
    const profile: PenNameProfile = {
      defaultMessageHtml: "<p>Default thanks!</p>",
    };
    const { container, unmount } = mount(
      <AuthorNoteCard
        story={baseStory({ authorNote: { enabled: true, messageHtml: "" } })}
        profile={profile}
        onChange={vi.fn()}
      />,
    );

    const preview = container.querySelector(
      '[data-testid="author-note-default-preview"]',
    );
    expect(preview).not.toBeNull();
    expect(preview!.textContent).toContain("Default thanks!");

    unmount();
  });

  it("does NOT render the default preview when override is non-empty", () => {
    const profile: PenNameProfile = {
      defaultMessageHtml: "<p>Default</p>",
    };
    const { container, unmount } = mount(
      <AuthorNoteCard
        story={baseStory({
          authorNote: { enabled: true, messageHtml: "<p>Override</p>" },
        })}
        profile={profile}
        onChange={vi.fn()}
      />,
    );

    const preview = container.querySelector(
      '[data-testid="author-note-default-preview"]',
    );
    expect(preview).toBeNull();

    unmount();
  });

  it("hides the override editor when toggle is off", () => {
    const profile: PenNameProfile = {};
    const { container, unmount } = mount(
      <AuthorNoteCard
        story={baseStory({ authorNote: { enabled: false } })}
        profile={profile}
        onChange={vi.fn()}
      />,
    );

    expect(
      container.querySelector('[data-testid="author-note-override-editor"]'),
    ).toBeNull();

    unmount();
  });

  it("renders the override editor when profile exists and toggle is on", () => {
    const profile: PenNameProfile = {};
    const { container, unmount } = mount(
      <AuthorNoteCard
        story={baseStory()}
        profile={profile}
        onChange={vi.fn()}
      />,
    );

    expect(
      container.querySelector('[data-testid="author-note-override-editor"]'),
    ).not.toBeNull();

    unmount();
  });

  it("wraps the body in [data-testid='author-note-card']", () => {
    const { container, unmount } = mount(
      <AuthorNoteCard
        story={baseStory()}
        profile={undefined}
        onChange={vi.fn()}
      />,
    );
    expect(
      container.querySelector('[data-testid="author-note-card"]'),
    ).not.toBeNull();
    unmount();
  });
});
