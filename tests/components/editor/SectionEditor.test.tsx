// @vitest-environment jsdom
/**
 * Tests for SectionEditor — new sticky-focus behavior: caret prop resolved via
 * posAtCoords on mount, no blur-exit, blur triggers useAutoSave flush.
 *
 * Uses the project's manual React-19 render harness (no @testing-library/react
 * by project rule — see tests/components/editor/SectionCard.test.tsx).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

// Mock the autosave hook before importing SectionEditor so the editor sees our
// mock. We expose a spy `flushSpy` that the tests inspect.
const flushSpy = vi.fn(async () => {});
vi.mock("@/hooks/useAutoSave", () => ({
  useAutoSave: () => ({ status: "idle" as const, flush: flushSpy }),
}));

// Mock @tiptap/react so we can intercept `useEditor` and drive it from the
// test. Capture the options so tests can invoke handleDOMEvents.blur directly.
//
// Tiptap v3: `editor.commands.setTextSelection(pos)` returns boolean; chaining
// uses `editor.chain().setTextSelection(pos).focus().run()`. Our mock models
// the chain API so we can observe which commands got chained.
const setTextSelectionSpy = vi.fn();
const chainFocusSpy = vi.fn();
const commandsFocusSpy = vi.fn();
const posAtCoordsStub = vi.fn<
  (_: { left: number; top: number }) => { pos: number; inside: number } | null
>(() => ({ pos: 42, inside: -1 }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let capturedEditorOpts: any = null;

vi.mock("@tiptap/react", () => {
  const useEditor = (opts: Record<string, unknown>) => {
    capturedEditorOpts = opts;
    // Chainable builder: every method returns `chain` itself except `run()`.
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
    return {
      view: {
        posAtCoords: posAtCoordsStub,
      },
      commands: {
        focus: commandsFocusSpy,
      },
      chain: () => chain,
      __opts: opts,
    };
  };
  const EditorContent = () => <div data-testid="proseMirror" />;
  return { useEditor, EditorContent };
});

import { SectionEditor } from "@/components/editor/SectionEditor";

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
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
    rerender: (next) => {
      act(() => root.render(next));
    },
  };
}

beforeEach(() => {
  flushSpy.mockClear();
  setTextSelectionSpy.mockClear();
  chainFocusSpy.mockClear();
  commandsFocusSpy.mockClear();
  posAtCoordsStub.mockClear();
  posAtCoordsStub.mockReturnValue({ pos: 42, inside: -1 });
  capturedEditorOpts = null;
});

describe("SectionEditor sticky-focus behavior", () => {
  it("places the cursor at posAtCoords resolution when caret is provided", () => {
    const { unmount } = mount(
      <SectionEditor
        sectionId="sec-1"
        initialContent="hello world"
        caret={{ x: 10, y: 20 }}
        onSave={vi.fn()}
        onExit={vi.fn()}
      />,
    );

    expect(posAtCoordsStub).toHaveBeenCalledTimes(1);
    expect(posAtCoordsStub).toHaveBeenCalledWith({ left: 10, top: 20 });
    expect(setTextSelectionSpy).toHaveBeenCalledWith(42);
    // Focus happens via the chain, not via editor.commands.focus().
    expect(chainFocusSpy).toHaveBeenCalledTimes(1);
    expect(commandsFocusSpy).not.toHaveBeenCalled();

    unmount();
  });

  it("falls back to focus('end') when caret is null", () => {
    const { unmount } = mount(
      <SectionEditor
        sectionId="sec-1"
        initialContent="hello world"
        caret={null}
        onSave={vi.fn()}
        onExit={vi.fn()}
      />,
    );

    expect(posAtCoordsStub).not.toHaveBeenCalled();
    expect(setTextSelectionSpy).not.toHaveBeenCalled();
    expect(commandsFocusSpy).toHaveBeenCalledWith("end");

    unmount();
  });

  it("falls back to focus('end') when posAtCoords returns null", () => {
    posAtCoordsStub.mockReturnValueOnce(null);

    const { unmount } = mount(
      <SectionEditor
        sectionId="sec-1"
        initialContent="hello world"
        caret={{ x: 999, y: 999 }}
        onSave={vi.fn()}
        onExit={vi.fn()}
      />,
    );

    expect(posAtCoordsStub).toHaveBeenCalledTimes(1);
    expect(setTextSelectionSpy).not.toHaveBeenCalled();
    expect(commandsFocusSpy).toHaveBeenCalledWith("end");

    unmount();
  });

  it("does not re-resolve caret when the caret prop identity changes mid-mount", () => {
    const { rerender, unmount } = mount(
      <SectionEditor
        sectionId="sec-1"
        initialContent="hello"
        caret={{ x: 10, y: 20 }}
        onSave={vi.fn()}
        onExit={vi.fn()}
      />,
    );
    expect(posAtCoordsStub).toHaveBeenCalledTimes(1);
    posAtCoordsStub.mockClear();

    rerender(
      <SectionEditor
        sectionId="sec-1"
        initialContent="hello"
        caret={{ x: 500, y: 500 }}
        onSave={vi.fn()}
        onExit={vi.fn()}
      />,
    );
    expect(posAtCoordsStub).not.toHaveBeenCalled();

    unmount();
  });

  it("blur handler does NOT call onExit (regression guard for sticky-focus)", () => {
    const onExit = vi.fn();
    const { unmount } = mount(
      <SectionEditor
        sectionId="sec-1"
        initialContent="hello"
        caret={null}
        onSave={vi.fn()}
        onExit={onExit}
      />,
    );
    // Invoke the captured blur handler directly.
    const blurHandler = capturedEditorOpts?.editorProps?.handleDOMEvents?.blur;
    expect(blurHandler).toBeTypeOf("function");
    act(() => {
      blurHandler({}, new Event("blur"));
    });
    expect(onExit).not.toHaveBeenCalled();
    unmount();
  });

  it("blur handler calls useAutoSave.flush()", () => {
    const { unmount } = mount(
      <SectionEditor
        sectionId="sec-1"
        initialContent="hello"
        caret={null}
        onSave={vi.fn()}
        onExit={vi.fn()}
      />,
    );
    const blurHandler = capturedEditorOpts?.editorProps?.handleDOMEvents?.blur;
    expect(blurHandler).toBeTypeOf("function");
    act(() => {
      blurHandler({}, new Event("blur"));
    });
    expect(flushSpy).toHaveBeenCalledTimes(1);
    unmount();
  });
});
