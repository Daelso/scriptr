// @vitest-environment jsdom
/**
 * Tests for SectionCard — per-section kebab menu (Regenerate / Regenerate
 * with note… / Delete), inline note input, and skeleton-shimmer state while
 * a regen is in flight.
 *
 * Manual React-19 render harness (no @testing-library/react by project rule).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

// Mock useAutoSave + @tiptap/react so the sticky-focus describe block can
// render SectionCard with isEditing=true (which mounts SectionEditor, which
// calls useEditor + useAutoSave). These mocks mirror the shapes used in
// tests/components/editor/SectionEditor.test.tsx. The existing kebab/note/
// shimmer tests don't mount SectionEditor so they're unaffected.
const flushSpy = vi.fn(async () => {});
vi.mock("@/hooks/useAutoSave", () => ({
  useAutoSave: () => ({ status: "idle" as const, flush: flushSpy }),
}));

const setTextSelectionSpy = vi.fn();
const chainFocusSpy = vi.fn();
const commandsFocusSpy = vi.fn();
const posAtCoordsStub = vi.fn<
  (_: { left: number; top: number }) => { pos: number; inside: number } | null
>(() => ({ pos: 42, inside: -1 }));

type FakeEditor = {
  view: { posAtCoords: typeof posAtCoordsStub };
  commands: { focus: typeof commandsFocusSpy };
  chain: () => Record<string, (...args: unknown[]) => unknown>;
  __opts: Record<string, unknown>;
};

let fakeEditor: FakeEditor | null = null;

vi.mock("@tiptap/react", () => {
  const useEditor = (opts: Record<string, unknown>) => {
    if (!fakeEditor) {
      const chain: Record<string, (...args: unknown[]) => unknown> = {};
      chain.setTextSelection = (...args: unknown[]) => {
        setTextSelectionSpy(...args);
        return chain;
      };
      chain.focus = (...args: unknown[]) => {
        chainFocusSpy(...args);
        return chain;
      };
      chain.run = () => true;
      fakeEditor = {
        view: { posAtCoords: posAtCoordsStub },
        commands: { focus: commandsFocusSpy },
        chain: () => chain,
        __opts: opts,
      };
    } else {
      fakeEditor.__opts = opts;
    }
    return fakeEditor;
  };
  const EditorContent = () => <div data-testid="proseMirror" />;
  return { useEditor, EditorContent };
});

import { SectionCard } from "@/components/editor/SectionCard";
import type { Section } from "@/lib/types";

beforeEach(() => {
  flushSpy.mockClear();
  setTextSelectionSpy.mockClear();
  chainFocusSpy.mockClear();
  commandsFocusSpy.mockClear();
  posAtCoordsStub.mockClear();
  posAtCoordsStub.mockReturnValue({ pos: 42, inside: -1 });
  fakeEditor = null;
});

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

const baseSection: Section = { id: "sec-1", content: "Body of section one." };

describe("SectionCard", () => {
  it("renders section content and an enabled kebab button", () => {
    const { container, unmount } = mount(
      <SectionCard
        section={baseSection}
        onRegenerate={vi.fn()}
        onRegenerateWithNote={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(container.textContent).toContain("Body of section one.");
    const kebab = container.querySelector(
      '[aria-label="Section options"]',
    ) as HTMLButtonElement | null;
    expect(kebab).not.toBeNull();
    expect(kebab!.disabled).toBe(false);

    unmount();
  });

  it("disables the kebab when disableActions is true", () => {
    const { container, unmount } = mount(
      <SectionCard section={baseSection} disableActions />,
    );
    const kebab = container.querySelector(
      '[aria-label="Section options"]',
    ) as HTMLButtonElement;
    expect(kebab.disabled).toBe(true);
    unmount();
  });

  it("hides the body and renders a Regenerating status region when isRegenerating", () => {
    const { container, unmount } = mount(
      <SectionCard section={baseSection} isRegenerating />,
    );

    // Body text is hidden while the shimmer is shown.
    expect(container.textContent).not.toContain("Body of section one.");

    // Status region exists and has live polite semantics.
    const status = container.querySelector(
      '[aria-label="Regenerating section"]',
    );
    expect(status).not.toBeNull();
    expect(status?.getAttribute("role")).toBe("status");
    expect(status?.getAttribute("aria-live")).toBe("polite");

    // Kebab is not rendered during regen.
    const kebab = container.querySelector('[aria-label="Section options"]');
    expect(kebab).toBeNull();

    unmount();
  });

  it("hides the inline regenNote while regenerating (so the stale note doesn't appear above the shimmer)", () => {
    const withNote: Section = { ...baseSection, regenNote: "less purple prose" };
    const { container, unmount } = mount(
      <SectionCard section={withNote} isRegenerating />,
    );

    expect(container.textContent).not.toContain("less purple prose");
    unmount();
  });

  it("clicking 'Regenerate with note…' opens an inline textarea; Cancel closes it", () => {
    const onRegenerate = vi.fn();
    const onRegenerateWithNote = vi.fn();
    const { container, unmount } = mount(
      <SectionCard
        section={baseSection}
        onRegenerate={onRegenerate}
        onRegenerateWithNote={onRegenerateWithNote}
      />,
    );

    // Note input isn't present by default.
    expect(container.querySelector('[aria-label="Regen note"]')).toBeNull();

    // Simulate the menu item's onClick handler directly — the base-ui Menu
    // portal renders into document.body and is heavier than we need. The
    // component's internal state is what we care about.
    //
    // We open the note input by dispatching a click on the "Regenerate with
    // note…" menu item via the same path the menu uses: find the dropdown
    // trigger and click it, then locate the menu item text.
    const trigger = container.querySelector(
      '[aria-label="Section options"]',
    ) as HTMLButtonElement;
    act(() => {
      trigger.click();
    });

    // base-ui Menu portal renders items into document.body.
    const items = Array.from(document.body.querySelectorAll("[data-slot='dropdown-menu-item']"));
    const withNoteItem = items.find((el) =>
      el.textContent?.includes("Regenerate with note"),
    ) as HTMLElement | undefined;
    expect(withNoteItem).toBeDefined();

    act(() => {
      withNoteItem!.click();
    });

    const textarea = container.querySelector(
      '[aria-label="Regen note"]',
    ) as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();

    // Cancel button closes it.
    const cancelBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Cancel",
    ) as HTMLButtonElement | undefined;
    expect(cancelBtn).toBeDefined();
    act(() => {
      cancelBtn!.click();
    });
    expect(container.querySelector('[aria-label="Regen note"]')).toBeNull();

    expect(onRegenerate).not.toHaveBeenCalled();
    expect(onRegenerateWithNote).not.toHaveBeenCalled();
    unmount();
  });

  it("Apply submits the trimmed note and closes the input", () => {
    const onRegenerateWithNote = vi.fn();
    const { container, unmount } = mount(
      <SectionCard
        section={baseSection}
        onRegenerateWithNote={onRegenerateWithNote}
      />,
    );

    // Open the note input.
    const trigger = container.querySelector(
      '[aria-label="Section options"]',
    ) as HTMLButtonElement;
    act(() => { trigger.click(); });
    const items = Array.from(document.body.querySelectorAll("[data-slot='dropdown-menu-item']"));
    const withNoteItem = items.find((el) =>
      el.textContent?.includes("Regenerate with note"),
    ) as HTMLElement;
    act(() => { withNoteItem.click(); });

    // Type into the textarea.
    const textarea = container.querySelector(
      '[aria-label="Regen note"]',
    ) as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    act(() => {
      setter.call(textarea, "  more dialogue  ");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const applyBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Apply",
    ) as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(false);
    act(() => { applyBtn.click(); });

    expect(onRegenerateWithNote).toHaveBeenCalledWith("sec-1", "more dialogue");
    expect(container.querySelector('[aria-label="Regen note"]')).toBeNull();

    unmount();
  });

  it("Ctrl+Enter submits the note; Esc cancels", () => {
    const onRegenerateWithNote = vi.fn();
    const { container, unmount } = mount(
      <SectionCard
        section={baseSection}
        onRegenerateWithNote={onRegenerateWithNote}
      />,
    );

    const trigger = container.querySelector(
      '[aria-label="Section options"]',
    ) as HTMLButtonElement;
    act(() => { trigger.click(); });
    const items = Array.from(document.body.querySelectorAll("[data-slot='dropdown-menu-item']"));
    const withNoteItem = items.find((el) =>
      el.textContent?.includes("Regenerate with note"),
    ) as HTMLElement;
    act(() => { withNoteItem.click(); });

    const textarea = container.querySelector(
      '[aria-label="Regen note"]',
    ) as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    act(() => {
      setter.call(textarea, "slow the pacing");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // Ctrl+Enter submits.
    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          ctrlKey: true,
          bubbles: true,
        }),
      );
    });
    expect(onRegenerateWithNote).toHaveBeenCalledWith("sec-1", "slow the pacing");

    // Re-open for Esc test.
    act(() => { trigger.click(); });
    const items2 = Array.from(document.body.querySelectorAll("[data-slot='dropdown-menu-item']"));
    const withNoteItem2 = items2.find((el) =>
      el.textContent?.includes("Regenerate with note"),
    ) as HTMLElement;
    act(() => { withNoteItem2.click(); });

    const textarea2 = container.querySelector(
      '[aria-label="Regen note"]',
    ) as HTMLTextAreaElement;
    expect(textarea2).not.toBeNull();

    act(() => {
      textarea2.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(container.querySelector('[aria-label="Regen note"]')).toBeNull();
    // onRegenerateWithNote count should not have increased from the Esc.
    expect(onRegenerateWithNote).toHaveBeenCalledTimes(1);

    unmount();
  });

  it("Regenerate menu item fires onRegenerate with the section id", () => {
    const onRegenerate = vi.fn();
    const { container, unmount } = mount(
      <SectionCard section={baseSection} onRegenerate={onRegenerate} />,
    );

    const trigger = container.querySelector(
      '[aria-label="Section options"]',
    ) as HTMLButtonElement;
    act(() => { trigger.click(); });

    const items = Array.from(
      document.body.querySelectorAll("[data-slot='dropdown-menu-item']"),
    );
    const regenItem = items.find(
      (el) => el.textContent?.trim() === "Regenerate",
    ) as HTMLElement | undefined;
    expect(regenItem).toBeDefined();
    act(() => { regenItem!.click(); });

    expect(onRegenerate).toHaveBeenCalledWith("sec-1");

    unmount();
  });

  it("Delete menu item fires onDelete with the section id", () => {
    const onDelete = vi.fn();
    const { container, unmount } = mount(
      <SectionCard section={baseSection} onDelete={onDelete} />,
    );

    const trigger = container.querySelector(
      '[aria-label="Section options"]',
    ) as HTMLButtonElement;
    act(() => { trigger.click(); });

    const items = Array.from(
      document.body.querySelectorAll("[data-slot='dropdown-menu-item']"),
    );
    const deleteItem = items.find(
      (el) => el.textContent?.trim() === "Delete",
    ) as HTMLElement | undefined;
    expect(deleteItem).toBeDefined();
    act(() => { deleteItem!.click(); });

    expect(onDelete).toHaveBeenCalledWith("sec-1");

    unmount();
  });

  it("Apply is disabled when the note is only whitespace", () => {
    const onRegenerateWithNote = vi.fn();
    const { container, unmount } = mount(
      <SectionCard
        section={baseSection}
        onRegenerateWithNote={onRegenerateWithNote}
      />,
    );

    const trigger = container.querySelector(
      '[aria-label="Section options"]',
    ) as HTMLButtonElement;
    act(() => { trigger.click(); });
    const items = Array.from(
      document.body.querySelectorAll("[data-slot='dropdown-menu-item']"),
    );
    const withNoteItem = items.find((el) =>
      el.textContent?.includes("Regenerate with note"),
    ) as HTMLElement;
    act(() => { withNoteItem.click(); });

    const textarea = container.querySelector(
      '[aria-label="Regen note"]',
    ) as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    act(() => {
      setter.call(textarea, "   ");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const applyBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Apply",
    ) as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);

    unmount();
  });
});

describe("SectionCard sticky-focus wiring", () => {
  it("renders read-only <p> (no SectionEditor) when isEditing=false", () => {
    const { container, unmount } = mount(
      <SectionCard
        section={baseSection}
        isEditing={false}
        caret={null}
        onRequestEdit={vi.fn()}
        onExit={vi.fn()}
        onSaveBody={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-testid="proseMirror"]')).toBeNull();
    expect(container.querySelector('[aria-label="Edit section"]')).not.toBeNull();
    unmount();
  });

  it("onMouseDown captures clientX/clientY and calls onRequestEdit", () => {
    const onRequestEdit = vi.fn();
    const { container, unmount } = mount(
      <SectionCard
        section={baseSection}
        isEditing={false}
        caret={null}
        onRequestEdit={onRequestEdit}
        onExit={vi.fn()}
        onSaveBody={vi.fn()}
      />,
    );
    const p = container.querySelector('[aria-label="Edit section"]') as HTMLElement;
    expect(p).not.toBeNull();
    act(() => {
      p.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, clientX: 123, clientY: 456 }),
      );
    });
    expect(onRequestEdit).toHaveBeenCalledWith("sec-1", { x: 123, y: 456 });
    unmount();
  });

  it("keyboard Enter activates with null caret", () => {
    const onRequestEdit = vi.fn();
    const { container, unmount } = mount(
      <SectionCard
        section={baseSection}
        isEditing={false}
        caret={null}
        onRequestEdit={onRequestEdit}
        onExit={vi.fn()}
        onSaveBody={vi.fn()}
      />,
    );
    const p = container.querySelector('[aria-label="Edit section"]') as HTMLElement;
    act(() => {
      p.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onRequestEdit).toHaveBeenCalledWith("sec-1", null);
    unmount();
  });

  it("renders SectionEditor (not read-only <p>) when isEditing=true", () => {
    const { container, unmount } = mount(
      <SectionCard
        section={baseSection}
        isEditing={true}
        caret={{ x: 10, y: 20 }}
        onRequestEdit={vi.fn()}
        onExit={vi.fn()}
        onSaveBody={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-testid="proseMirror"]')).not.toBeNull();
    unmount();
  });

  it("click alone (without mousedown) does not fire onRequestEdit", () => {
    const onRequestEdit = vi.fn();
    const { container, unmount } = mount(
      <SectionCard
        section={baseSection}
        isEditing={false}
        caret={null}
        onRequestEdit={onRequestEdit}
        onExit={vi.fn()}
        onSaveBody={vi.fn()}
      />,
    );
    const p = container.querySelector('[aria-label="Edit section"]') as HTMLElement;
    act(() => {
      p.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onRequestEdit).not.toHaveBeenCalled();
    unmount();
  });
});
