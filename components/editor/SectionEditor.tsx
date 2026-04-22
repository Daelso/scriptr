"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

import { useAutoSave } from "@/hooks/useAutoSave";

interface SectionEditorProps {
  sectionId: string;
  /** Initial plain-text body (paragraph breaks are "\n\n"). */
  initialContent: string;
  /**
   * Viewport coordinates of the user's click on the read-only <p>, captured
   * once on mount via a ref; re-renders ignore prop identity changes. Null or
   * undefined when the editor was opened via keyboard or has no caller yet,
   * in which case the cursor lands at end-of-content.
   */
  caret?: { x: number; y: number } | null;
  /**
   * Persist a new plain-text body. Caller handles PATCH + SWR revalidation +
   * error toast. Throwing is how the autosave hook surfaces an "error" status.
   */
  onSave: (sectionId: string, newContent: string) => Promise<void>;
  /**
   * Called after blur or Esc. The editor is expected to flush any pending save
   * first, so the parent can safely swap the component back to the read-only
   * view without losing edits.
   */
  onExit: () => void;
}

// ─── Plain-text ↔ HTML round-trip ─────────────────────────────────────────────
//
// Section bodies live in storage as plain text with blank-line paragraph
// breaks and single-newline line breaks. Tiptap's Document model is a tree of
// Paragraph nodes, so we convert on mount and on save:
//
//  storage ──split("\n\n")──►  <p>paragraph</p><p>…</p>  (HTML, Tiptap input)
//  editor  ──getText({"\n\n"})──►  paragraph\n\nparagraph  (plain text, storage)
//
// Intra-paragraph newlines (a single "\n") become <br> in the HTML and are
// preserved in getText() output as "\n", so a user who types Shift+Enter
// inside a paragraph still round-trips correctly.

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

/** Convert storage plain text to Tiptap-compatible HTML paragraph nodes. */
function textToHtml(text: string): string {
  if (text.length === 0) return "<p></p>";
  // Split on blank lines (one or more whitespace-only lines between paragraphs).
  const paragraphs = text.split(/\n\s*\n/);
  return paragraphs
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/**
 * Tiptap-based inline prose editor for a single section. Uncontrolled per
 * task 7.5 guidance: the editor owns its state; we only read the body on blur
 * / debounce / Esc and write it back to storage via `onSave`.
 *
 * Keybinds:
 *  - Esc: exit edit mode (the autosave hook flushes any pending save on
 *    unmount, so we don't need to save manually here).
 *  - Blur: same as Esc — exit and flush.
 */
export function SectionEditor({
  sectionId,
  initialContent,
  caret,
  onSave,
  onExit,
}: SectionEditorProps) {
  // Memoise the initial HTML so it's computed once per mount. We deliberately
  // do NOT thread `initialContent` into the editor after mount — this is the
  // "uncontrolled" contract: prop changes mid-edit would clobber the user's
  // in-progress text.
  const initialHtml = useMemo(() => textToHtml(initialContent), [initialContent]);

  // Caret captured once on mount. Prop identity changes mid-edit are ignored;
  // the cursor position is resolved exactly once after the editor initializes.
  const caretOnMountRef = useRef<{ x: number; y: number } | null>(caret ?? null);

  // Current text buffer that drives useAutoSave. Updated on each editor
  // transaction via `onUpdate`. We keep this as a ref-like piece of state so
  // the hook can observe changes while the editor itself stays uncontrolled
  // from React's perspective (no `setContent` on every keystroke).
  const [buffer, setBuffer] = useState(initialContent);

  // Whether we're still actively editing. Flipped to false on blur/Esc so the
  // autosave hook's unmount cleanup runs (the hook fires a pending save on
  // unmount when `enabled` is true — which it remains right up to unmount,
  // since the parent swaps the component out synchronously on onExit()).
  const exitedRef = useRef(false);

  // Stable save callback so useAutoSave keeps identity across renders.
  const save = useCallback(
    async (text: string) => {
      await onSave(sectionId, text);
    },
    [onSave, sectionId],
  );

  const { flush } = useAutoSave(buffer, save, { debounceMs: 500, enabled: true });

  const handleExit = useCallback(() => {
    if (exitedRef.current) return;
    exitedRef.current = true;
    onExit();
  }, [onExit]);

  const editor = useEditor({
    // SSR safety: useEditor reads from the DOM during render, which fails in
    // the Node render pass of an App Router page. This file is a client
    // component ("use client"), but `immediatelyRender: false` is the
    // officially recommended flag for client components that Next may
    // still try to prerender (see @tiptap/react v3 docs).
    immediatelyRender: false,
    extensions: [
      // Prose-only configuration: disable every block-level structure that
      // isn't a plain paragraph. What's left: Bold / Italic / Strike /
      // HardBreak / History / Paragraph / Document / Dropcursor / Gapcursor /
      // Text. TaskList is not part of StarterKit, so nothing to disable.
      StarterKit.configure({
        heading: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
      }),
    ],
    content: initialHtml,
    editable: true,
    editorProps: {
      attributes: {
        "aria-label": "Edit section",
        // Match the read-only <p>'s typography so there's no visual jump
        // between modes. `outline-none` removes the default browser ring;
        // we add our own focus-visible ring in globals.css.
        class:
          "tiptap-section-editor text-base leading-relaxed text-foreground whitespace-pre-wrap outline-none",
      },
      handleKeyDown: (_view, event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          handleExit();
          return true;
        }
        return false;
      },
      handleDOMEvents: {
        blur: () => {
          // Sticky-focus: clicking off does NOT exit edit mode. We only flush
          // any pending debounced save so work is persisted even if the user
          // closes the tab before returning to the editor.
          void flush();
          return false;
        },
      },
    },
    onUpdate: ({ editor: e }) => {
      // Push the latest plain-text representation into the autosave buffer.
      // Tiptap's `getText` with `blockSeparator: "\n\n"` emits blank-line
      // paragraph breaks, matching our storage format.
      setBuffer(e.getText({ blockSeparator: "\n\n" }));
    },
  });

  // Place the cursor on mount. If a caret was captured from a click, resolve
  // it via posAtCoords; otherwise (or if coords don't map to a document
  // position), fall back to end-of-content so keyboard users can start typing.
  useEffect(() => {
    if (!editor) return;
    const c = caretOnMountRef.current;
    if (c) {
      const resolved = editor.view.posAtCoords({ left: c.x, top: c.y });
      if (resolved) {
        // Use chain() for atomic "select then focus" — one transaction, one
        // paint. commands.setTextSelection's typed return is boolean in
        // Tiptap v3, so we can't method-chain off it directly.
        editor.chain().setTextSelection(resolved.pos).focus().run();
        return;
      }
    }
    editor.commands.focus("end");
  }, [editor]);

  // `useEditor` handles its own teardown on unmount; no explicit destroy here.
  return <EditorContent editor={editor} />;
}
