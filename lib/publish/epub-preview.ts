/**
 * Client-safe EPUB preview helpers.
 *
 * These helpers are pure string transformations and contain no server-only
 * imports (no `epub-gen-memory`, no `@likecoin/epubcheck-ts`). They are
 * imported by `components/publish/ImportChapterDialog.tsx` (a client
 * component) to render the live preview pane inside the paste-import dialog.
 *
 * Keep this file free of Node-only or EPUB-packaging imports. The server-
 * only module `lib/publish/epub.ts` re-exports everything here in addition
 * to `buildEpubBytes` and `validateEpub`.
 */
import type { Chapter } from "@/lib/types";

export type PreviewOpts = { chapterNumber?: number };

export const EPUB_STYLESHEET = `
body {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 1em;
  line-height: 1.5;
  color: #222;
  margin: 0;
  padding: 1.5em 1.75em;
}
h1.chapter-title {
  text-align: center;
  font-size: 1.35em;
  font-weight: 600;
  margin: 1.5em 0 0.25em;
  page-break-before: always;
}
p.chapter-subtitle {
  text-align: center;
  font-style: italic;
  font-weight: 400;
  margin: 0 0 1.25em;
}
p {
  text-align: justify;
  text-indent: 1.5em;
  margin: 0 0 0.3em;
}
p.first { text-indent: 0; }
div.scene-break {
  text-align: center;
  margin: 1em 0;
  letter-spacing: 0.3em;
}
.author-note {
  margin-top: 3em;
  border-top: 1px solid #888;
  padding-top: 2em;
}
.author-note h2 {
  text-align: center;
  margin-bottom: 1.2em;
}
.author-note-message {
  margin-bottom: 1.5em;
}
.author-note-footer {
  text-align: center;
  font-size: 0.95em;
  color: #555;
}
.author-note-footer img {
  display: block;
  margin: 0.5em auto;
  max-width: 200px;
}
.story-title-page {
  page-break-before: always;
  text-align: center;
  padding: 2em 0;
}
.story-title-page h1 {
  font-size: 1.8em;
  font-weight: 600;
  margin: 0 0 1em;
}
.story-title-page p {
  text-indent: 0;
  text-align: center;
  font-style: italic;
  margin: 0 1em;
}
`.trim();

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function renderStoryTitlePageHtml(title: string, description?: string): string {
  const trimmed = description?.trim() ?? "";
  const descBlock = trimmed.length > 0 ? `<p>${escapeHtml(trimmed)}</p>` : "";
  return `<div class="story-title-page"><h1>${escapeHtml(title)}</h1>${descBlock}</div>`;
}

export function stripPreviewWrapper(html: string): string {
  const prefix = '<div class="epub-preview">';
  const suffix = "</div>";
  if (html.startsWith(prefix) && html.endsWith(suffix)) {
    return html.slice(prefix.length, html.length - suffix.length);
  }
  return html;
}

export function renderSectionHtml(content: string): string {
  let t = escapeHtml(content);
  // Two-pass emphasis: bold first (lazy match across any non-newline chars,
  // so it can wrap interior single-* italic markers), then italic on the
  // result. The bold body uses `.+?` rather than `[^*\n]+?` so nested
  // patterns like `**bold *with* italic**` survive pass 1; the italic pass
  // then rewrites the now-isolated `*…*` runs.
  t = t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/\*([^*\n]+?)\*/g, "<em>$1</em>");

  const paragraphs = t
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  return paragraphs
    .map((p) => `<p>${p.replace(/\n/g, " ")}</p>`)
    .join("");
}

export function renderChapterPreviewHtml(
  chapter: Chapter,
  opts?: PreviewOpts,
): string {
  const num = opts?.chapterNumber ?? 1;
  const sectionHtml = chapter.sections
    .map((s) => renderSectionHtml(s.content))
    .join('<div class="scene-break">* * *</div>');
  const subtitle = chapter.title
    ? `<p class="chapter-subtitle">${escapeHtml(chapter.title)}</p>`
    : "";
  return `<div class="epub-preview"><h1 class="chapter-title">Chapter ${num}</h1>${subtitle}${sectionHtml}</div>`;
}
