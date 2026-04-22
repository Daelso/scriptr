// @vitest-environment jsdom
/**
 * Tests for SectionList's sticky-focus state ownership: one editingSectionId
 * across siblings, click-to-swap, and auto-exit when disableActions flips
 * true (any generation in flight).
 *
 * Generation store: this suite uses the REAL Zustand store and drives state
 * via useGenerationStore.setState(...) / .getState() — the same pattern as
 * tests/components/editor/generation-store.test.ts. No vi.mock on the store.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import type { Section } from "@/lib/types";
import { useGenerationStore } from "@/components/editor/generation-store";

// Tiptap mock — mirrors the chain-builder shape used in
// tests/components/editor/SectionEditor.test.tsx so SectionEditor mounts
// without crashing when a card flips into edit mode.
vi.mock("@tiptap/react", () => {
  const useEditor = () => {
    const chain: Record<string, (...args: unknown[]) => unknown> = {};
    chain.setTextSelection = () => chain;
    chain.focus = () => chain;
    chain.run = () => true;
    return {
      view: { posAtCoords: () => ({ pos: 0, inside: -1 }) },
      commands: { focus: () => {} },
      chain: () => chain,
    };
  };
  const EditorContent = () => <div data-testid="proseMirror" />;
  return { useEditor, EditorContent };
});

// Mock useAutoSave to avoid scheduling real timers.
vi.mock("@/hooks/useAutoSave", () => ({
  useAutoSave: () => ({ status: "idle" as const, flush: vi.fn() }),
}));

import { SectionList } from "@/components/editor/SectionList";

// Reset store to a known-idle state between tests. Mirrors the pattern at
// tests/components/editor/generation-store.test.ts:13-29.
const initialStore = useGenerationStore.getState();
function resetStore() {
  useGenerationStore.setState(
    {
      activeChapterId: initialStore.activeChapterId,
      liveText: initialStore.liveText,
      isStreaming: initialStore.isStreaming,
      regeneratingSectionId: initialStore.regeneratingSectionId,
      regeneratingChapterId: initialStore.regeneratingChapterId,
      lastRunMode: initialStore.lastRunMode,
    },
    false,
  );
}

const SECTIONS: Section[] = [
  { id: "A", content: "A content" },
  { id: "B", content: "B content" },
  { id: "C", content: "C content" },
];

type Mounted = {
  container: HTMLDivElement;
  root: Root;
  unmount: () => void;
  rerender: (el: React.ReactElement) => void;
};
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
    root,
    unmount: () => { act(() => root.unmount()); container.remove(); },
    rerender: (next) => { act(() => root.render(next)); },
  };
}

beforeEach(() => {
  resetStore();
});

// Index cards by their position in SECTIONS. Once a card flips into edit
// mode the read-only <p> disappears (replaced by the mocked EditorContent
// which has no body text), so text-based lookup becomes unreliable. Using
// the DOM order — which matches the `SECTIONS` array order SectionList
// renders — is stable across edit-state transitions.
function getCardByIndex(container: HTMLElement, idx: number): HTMLElement {
  const articles = Array.from(container.querySelectorAll("article"));
  const a = articles[idx];
  if (!a) throw new Error(`card at index ${idx} not found`);
  return a as HTMLElement;
}

const INDEX = { A: 0, B: 1, C: 2 } as const;

function getReadOnlyP(container: HTMLElement, sectionId: keyof typeof INDEX): HTMLElement {
  const card = getCardByIndex(container, INDEX[sectionId]);
  const p = card.querySelector('[aria-label="Edit section"]');
  if (!p) throw new Error(`read-only <p> for ${sectionId} not found`);
  return p as HTMLElement;
}

function hasEditor(container: HTMLElement, sectionId: keyof typeof INDEX): boolean {
  const card = getCardByIndex(container, INDEX[sectionId]);
  return Boolean(card.querySelector('[data-testid="proseMirror"]'));
}

describe("SectionList sticky-focus", () => {
  it("mounts with no section editing", () => {
    const { container, unmount } = mount(
      <SectionList
        slug="s"
        chapterId="ch"
        sections={SECTIONS}
        onSectionSaveBody={vi.fn()}
      />,
    );
    for (const id of ["A", "B", "C"] as const) expect(hasEditor(container, id)).toBe(false);
    unmount();
  });

  it("mousedown on section A's <p> opens A's editor only", () => {
    const { container, unmount } = mount(
      <SectionList
        slug="s"
        chapterId="ch"
        sections={SECTIONS}
        onSectionSaveBody={vi.fn()}
      />,
    );
    const pA = getReadOnlyP(container, "A");
    act(() => {
      pA.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, clientX: 10, clientY: 20 }),
      );
    });
    expect(hasEditor(container, "A")).toBe(true);
    expect(hasEditor(container, "B")).toBe(false);
    expect(hasEditor(container, "C")).toBe(false);
    unmount();
  });

  it("mousedown on section B after A swaps edit state", () => {
    const { container, unmount } = mount(
      <SectionList
        slug="s"
        chapterId="ch"
        sections={SECTIONS}
        onSectionSaveBody={vi.fn()}
      />,
    );
    act(() => {
      getReadOnlyP(container, "A").dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, clientX: 1, clientY: 1 }),
      );
    });
    expect(hasEditor(container, "A")).toBe(true);

    act(() => {
      getReadOnlyP(container, "B").dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, clientX: 1, clientY: 1 }),
      );
    });
    expect(hasEditor(container, "A")).toBe(false);
    expect(hasEditor(container, "B")).toBe(true);
    unmount();
  });

  it("flipping isStreaming true auto-exits any open editor", () => {
    const { container, unmount } = mount(
      <SectionList
        slug="s"
        chapterId="ch"
        sections={SECTIONS}
        onSectionSaveBody={vi.fn()}
      />,
    );
    act(() => {
      getReadOnlyP(container, "A").dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, clientX: 1, clientY: 1 }),
      );
    });
    expect(hasEditor(container, "A")).toBe(true);

    act(() => {
      useGenerationStore.setState({ isStreaming: true });
    });
    expect(hasEditor(container, "A")).toBe(false);
    unmount();
  });
});
