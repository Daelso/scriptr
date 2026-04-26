"use client";

import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

interface Props {
  /** Initial HTML to seed the editor with on mount. */
  initialHtml: string;
  /** Fires on every editor transaction with the current HTML. */
  onChange: (html: string) => void;
  /** Optional aria-label for the contenteditable host (default: "Rich text editor"). */
  ariaLabel?: string;
}

/**
 * Reusable TipTap-based rich-text editor with a paragraph-only toolbar.
 *
 * Used by the settings page's pen-name profile cards and the story metadata
 * pane's author-note card. The toolbar exposes Bold, Italic, and Link only —
 * headings, lists, blockquotes, and code blocks are intentionally disabled.
 *
 * The contenteditable host carries the stable `tiptap-rich-editor` class,
 * which is the selector Task 7.2's Playwright e2e relies on. Toolbar buttons
 * carry stable aria-labels (`Bold`, `Italic`, `Link`) for the same reason.
 */
export function RichTextEditor({ initialHtml, onChange, ariaLabel }: Props) {
  const editor = useEditor({
    // SSR safety: useEditor reads from the DOM during render, which fails in
    // the Node render pass of an App Router page. This file is a client
    // component ("use client"), but `immediatelyRender: false` is the
    // officially recommended flag for client components that Next may still
    // try to prerender (see @tiptap/react v3 docs).
    immediatelyRender: false,
    extensions: [
      // Prose-only configuration: disable every block-level structure that
      // isn't a plain paragraph. What's left from StarterKit: Bold / Italic /
      // Link / HardBreak / History / Paragraph / Document / Dropcursor /
      // Gapcursor / Text. Strike is disabled too — the v1 toolbar is
      // bold/italic/link only.
      //
      // StarterKit v3 bundles @tiptap/extension-link (we install it as a
      // direct dep so the import resolves and to lock the version), so we
      // configure Link via StarterKit's `link` option here rather than as a
      // separate extension entry — adding it twice triggers a duplicate-name
      // warning. openOnClick=false keeps clicks inside the editor from
      // navigating away; autolink=false avoids auto-creating links from
      // typed URLs (the user toggles via the toolbar).
      StarterKit.configure({
        heading: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        link: { openOnClick: false, autolink: false },
      }),
    ],
    content: initialHtml,
    editable: true,
    editorProps: {
      attributes: {
        "aria-label": ariaLabel ?? "Rich text editor",
        class:
          "tiptap-rich-editor min-h-[5em] rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
      },
    },
    onUpdate({ editor: e }) {
      onChange(e.getHTML());
    },
  });

  // Re-sync if the prop changes after mount (e.g., switching stories or
  // pen-name profiles). emitUpdate: false avoids firing onChange for our
  // own programmatic resync — only user edits should trigger onChange.
  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() !== initialHtml) {
      editor.commands.setContent(initialHtml, { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHtml]);

  if (!editor) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 border border-input rounded-md p-1 bg-background">
        <button
          type="button"
          aria-label="Bold"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`px-2 py-1 text-sm rounded ${
            editor.isActive("bold") ? "bg-accent" : ""
          }`}
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          aria-label="Italic"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`px-2 py-1 text-sm rounded ${
            editor.isActive("italic") ? "bg-accent" : ""
          }`}
        >
          <em>I</em>
        </button>
        <button
          type="button"
          aria-label={editor.isActive("link") ? "Remove link" : "Link"}
          onClick={() => {
            // When the cursor is inside a link, the toolbar button toggles
            // to "Remove link" so the user has a way to undo a previous
            // setLink without learning a keyboard shortcut.
            if (editor.isActive("link")) {
              editor.chain().focus().unsetLink().run();
              return;
            }
            const raw = window.prompt("URL");
            if (!raw) return;
            const url = raw.trim();
            // Client-side scheme guard. The DOMPurify sanitizer also strips
            // `javascript:` / `data:text/html` URIs at render time
            // (AUTHOR_NOTE_SANITIZE_OPTS.ALLOWED_URI_REGEXP), but that runs
            // on output — disallowed URLs would still persist in the editor
            // model until next reload. Reject obvious bad schemes here so
            // the user gets immediate feedback and the saved HTML stays
            // clean.
            if (!/^(https?:\/\/|mailto:)/i.test(url)) {
              window.alert(
                "URL must start with http://, https://, or mailto:",
              );
              return;
            }
            editor.chain().focus().setLink({ href: url }).run();
          }}
          className={`px-2 py-1 text-sm rounded ${
            editor.isActive("link") ? "bg-accent" : ""
          }`}
        >
          Link
        </button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
