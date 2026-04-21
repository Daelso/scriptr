import type { Chapter, Story } from "@/lib/types";

export type EpubInput = {
  story: Story;
  chapters: Chapter[];
  coverPath?: string;
};

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
`.trim();

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function renderChapterPreviewHtml(
  chapter: Chapter,
  opts?: PreviewOpts
): string {
  const num = opts?.chapterNumber ?? 1;
  // Minimal stub; full transformer lands in Task 3.2.
  const body = chapter.sections
    .map((s) => `<p>${escapeHtml(s.content)}</p>`)
    .join("");
  const subtitle = chapter.title
    ? `<p class="chapter-subtitle">${escapeHtml(chapter.title)}</p>`
    : "";
  return `<div class="epub-preview"><h1 class="chapter-title">Chapter ${num}</h1>${subtitle}${body}</div>`;
}
