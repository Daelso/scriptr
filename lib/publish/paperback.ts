import type { Chapter, Story } from "@/lib/types";
import { buildAuthorNoteHtml, type ResolvedAuthorNote } from "@/lib/publish/author-note";
import { renderSectionHtml } from "@/lib/publish/epub-preview";
import {
  calculatePaperbackCoverSpec,
  estimatePaperbackPageCount,
  getPaperbackTrimSize,
  inches,
  normalizePaperbackOptions,
  paperbackInteriorPageSize,
  paperbackMinimumMargins,
  type PaperbackCoverSpec,
  type PaperbackOptions,
} from "@/lib/publish/paperback-shared";

export type PaperbackBuildInput = {
  story: Story;
  chapters: Chapter[];
  options?: Partial<PaperbackOptions>;
  authorNote?: ResolvedAuthorNote;
  coverImageDataUrl?: string;
};

export type PaperbackBuildResult = {
  html: string;
  coverHtml: string;
  coverSpec: PaperbackCoverSpec;
  options: PaperbackOptions;
  warnings: string[];
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderChapter(chapter: Chapter, index: number): string {
  const sectionHtml = chapter.sections
    .map((section) => renderSectionHtml(section.content))
    .join('<div class="scene-break">* * *</div>');
  const subtitle = chapter.title
    ? `<p class="chapter-subtitle">${escapeHtml(chapter.title)}</p>`
    : "";
  return `<section class="chapter"><h1>Chapter ${index + 1}</h1>${subtitle}${sectionHtml}</section>`;
}

function renderPlainTextParagraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function cssFor(options: PaperbackOptions, coverSpec: PaperbackCoverSpec): string {
  const trim = getPaperbackTrimSize(options.trimSizeId);
  const pageSize = paperbackInteriorPageSize(trim, options.bleed);
  const margins = paperbackMinimumMargins(coverSpec.pageCount, options.bleed);

  return `
@page {
  size: ${pageSize.widthIn}in ${pageSize.heightIn}in;
  margin-top: ${margins.topIn}in;
  margin-bottom: ${margins.bottomIn}in;
}
@page :left {
  margin-left: ${margins.outsideIn}in;
  margin-right: ${margins.insideIn}in;
  @bottom-center { content: counter(page); font-size: 9pt; }
}
@page :right {
  margin-left: ${margins.insideIn}in;
  margin-right: ${margins.outsideIn}in;
  @bottom-center { content: counter(page); font-size: 9pt; }
}
@media screen {
  body { background: #d8d8d8; }
  .sheet {
    background: white;
    box-shadow: 0 0 0 1px #ccc, 0 12px 32px rgba(0,0,0,0.18);
    margin: 24px auto;
    max-width: ${trim.widthIn * 96}px;
    min-height: ${trim.heightIn * 96}px;
    padding: 48px;
  }
}
@media print {
  body { margin: 0; }
  .sheet { padding: 0; }
  .print-note { display: none; }
}
body {
  color: #111;
  font-family: Georgia, "Times New Roman", serif;
  font-size: ${options.fontSizePt}pt;
  line-height: ${options.lineHeight};
}
h1, h2, h3, p { orphans: 2; widows: 2; }
p {
  margin: 0 0 0.08in;
  text-align: justify;
  text-indent: 0.22in;
}
.print-note {
  font-family: Arial, sans-serif;
  font-size: 12px;
  line-height: 1.4;
  margin: 0 auto;
  max-width: ${trim.widthIn * 96}px;
  padding: 12px 0 0;
}
.frontmatter,
.chapter,
.backmatter {
  break-before: page;
  page-break-before: always;
}
.title-page {
  break-before: right;
  page-break-before: right;
  min-height: 6in;
  text-align: center;
}
.title-page h1 {
  font-size: 26pt;
  font-weight: 600;
  margin: 2.2in 0 0.2in;
}
.title-page .subtitle,
.title-page .author {
  text-align: center;
  text-indent: 0;
}
.copyright p,
.toc p,
.backmatter p:first-child,
.chapter p:first-of-type {
  text-indent: 0;
}
.toc ol {
  list-style: none;
  margin: 0.2in 0 0;
  padding: 0;
}
.toc li {
  margin: 0.08in 0;
}
.chapter {
  break-before: right;
  page-break-before: right;
}
.chapter h1 {
  font-size: 17pt;
  font-weight: 600;
  margin: 0.7in 0 0.05in;
  text-align: center;
}
.chapter-subtitle {
  font-style: italic;
  margin: 0 0 0.35in;
  text-align: center;
  text-indent: 0;
}
.scene-break {
  margin: 0.18in 0;
  text-align: center;
  text-indent: 0;
}
.author-note {
  border-top: 0.75pt solid #777;
  margin-top: 0.4in;
  padding-top: 0.24in;
}
.author-note h2,
.backmatter h1,
.toc h1,
.copyright h1 {
  font-size: 15pt;
  font-weight: 600;
  margin: 0.4in 0 0.2in;
  text-align: center;
}
.author-note-footer,
.author-note-footer p {
  text-align: center;
  text-indent: 0;
}
.author-note-footer img {
  display: block;
  margin: 0.12in auto;
  max-width: 1.6in;
}
`.trim();
}

export async function buildPaperbackHtml(input: PaperbackBuildInput): Promise<PaperbackBuildResult> {
  const options = normalizePaperbackOptions(input.options);
  const wordCount = input.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);
  const estimatedPageCount = estimatePaperbackPageCount(wordCount, input.authorNote ? 2 : 0);
  const coverSpec = calculatePaperbackCoverSpec(options, estimatedPageCount);
  const warnings: string[] = [];

  if (coverSpec.pageCount < 24) {
    warnings.push("KDP paperback interiors must be at least 24 pages.");
  }
  if (options.fontSizePt < 9) {
    warnings.push("Interior font size is small; KDP allows 7 pt minimum, but prose is usually more readable at 10-12 pt.");
  }

  const subtitle = input.story.subtitle?.trim()
    ? `<p class="subtitle">${escapeHtml(input.story.subtitle.trim())}</p>`
    : "";
  const isbn = input.story.isbn?.trim()
    ? `<p>ISBN: ${escapeHtml(input.story.isbn.trim())}</p>`
    : "";
  const tocItems = input.chapters
    .map((chapter, index) => {
      const title = chapter.title.trim() || `Chapter ${index + 1}`;
      return `<li>Chapter ${index + 1}: ${escapeHtml(title)}</li>`;
    })
    .join("");
  const authorNote = input.authorNote ? await buildAuthorNoteHtml(input.authorNote) : "";
  const backCoverText = options.backCoverText ?? input.story.description.trim();

  const body = `
<div class="print-note">
  KDP paperback interior: ${coverSpec.trimSize.label}, ${options.bleed ? "bleed" : "no bleed"}, ${coverSpec.pageCount} estimated pages.
  Use the browser print dialog to save as PDF, disable browser headers/footers, and inspect the PDF before upload.
</div>
<main class="sheet">
  <section class="frontmatter title-page">
    <h1>${escapeHtml(input.story.title)}</h1>
    ${subtitle}
    <p class="author">${escapeHtml(input.story.authorPenName)}</p>
  </section>
  <section class="frontmatter copyright">
    <h1>Copyright</h1>
    <p>Copyright &copy; ${escapeHtml(String(input.story.copyrightYear))} ${escapeHtml(input.story.authorPenName)}.</p>
    <p>All rights reserved.</p>
    ${isbn}
  </section>
  <section class="frontmatter toc">
    <h1>Contents</h1>
    <ol>${tocItems}</ol>
  </section>
  ${input.chapters.map(renderChapter).join("\n")}
  ${authorNote ? `<section class="backmatter">${authorNote}</section>` : ""}
</main>
`.trim();

  const coverTitle = escapeHtml(input.story.title);
  const coverSubtitle = input.story.subtitle?.trim()
    ? `<div class="cover-subtitle">${escapeHtml(input.story.subtitle.trim())}</div>`
    : "";
  const coverImage = input.coverImageDataUrl
    ? `<img class="front-image" src="${input.coverImageDataUrl}" alt="">`
    : "";
  const coverHtml = `<!doctype html>
<html lang="${escapeHtml(input.story.language || "en")}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${coverTitle} paperback cover</title>
  <style>
@page {
  size: ${coverSpec.coverWidthIn}in ${coverSpec.coverHeightIn}in;
  margin: 0;
}
* { box-sizing: border-box; }
html,
body {
  margin: 0;
  min-height: 100%;
}
body {
  background: #f3f0e8;
  color: #111;
  font-family: Georgia, "Times New Roman", serif;
}
.cover {
  height: ${coverSpec.coverHeightIn}in;
  overflow: hidden;
  position: relative;
  width: ${coverSpec.coverWidthIn}in;
}
.back,
.front,
.spine {
  bottom: 0;
  position: absolute;
  top: 0;
}
.back {
  background: #f3f0e8;
  border-right: 0.4pt solid rgba(0,0,0,0.2);
  left: 0;
  width: ${coverSpec.bleedIn + coverSpec.trimSize.widthIn}in;
}
.front {
  background: #222;
  left: ${coverSpec.bleedIn + coverSpec.trimSize.widthIn + coverSpec.spineWidthIn}in;
  width: ${coverSpec.trimSize.widthIn + coverSpec.bleedIn}in;
}
.front-image {
  height: 100%;
  object-fit: cover;
  width: 100%;
}
.front-placeholder {
  align-items: center;
  color: #fff;
  display: flex;
  flex-direction: column;
  gap: 0.25in;
  height: 100%;
  justify-content: center;
  padding: 0.5in;
  text-align: center;
}
.front-placeholder h1 {
  font-size: 34pt;
  font-weight: 600;
  line-height: 1.05;
  margin: 0;
}
.cover-subtitle,
.front-placeholder .author {
  font-size: 14pt;
  line-height: 1.3;
}
.spine {
  align-items: center;
  background: #161616;
  color: #fff;
  display: flex;
  justify-content: center;
  left: ${coverSpec.bleedIn + coverSpec.trimSize.widthIn}in;
  overflow: hidden;
  width: ${coverSpec.spineWidthIn}in;
}
.spine-text {
  font-family: Arial, sans-serif;
  font-size: ${Math.max(7, Math.min(12, coverSpec.spineWidthIn * 36))}pt;
  letter-spacing: 0;
  line-height: 1;
  max-width: ${Math.max(0.1, coverSpec.trimSize.heightIn - 0.5)}in;
  overflow: hidden;
  text-align: center;
  text-overflow: ellipsis;
  transform: rotate(90deg);
  white-space: nowrap;
}
.back-copy {
  font-size: 11pt;
  line-height: 1.35;
  left: ${coverSpec.bleedIn + coverSpec.safeTextFromOutsideEdgeIn}in;
  position: absolute;
  right: ${coverSpec.safeTextFromOutsideEdgeIn}in;
  top: ${coverSpec.bleedIn + coverSpec.safeTextFromOutsideEdgeIn}in;
}
.back-copy p {
  margin: 0 0 0.14in;
}
.barcode-reserve {
  align-items: center;
  background: #fff;
  border: 0.5pt solid #ddd;
  bottom: ${coverSpec.bleedIn + 0.25}in;
  color: #666;
  display: flex;
  font-family: Arial, sans-serif;
  font-size: 7pt;
  height: 1.2in;
  justify-content: center;
  left: ${coverSpec.bleedIn + coverSpec.trimSize.widthIn - 2.25}in;
  position: absolute;
  text-align: center;
  width: 2in;
}
@media screen {
  body {
    align-items: flex-start;
    display: flex;
    justify-content: center;
    padding: 24px;
  }
  .cover {
    box-shadow: 0 0 0 1px #aaa, 0 12px 32px rgba(0,0,0,0.22);
  }
}
  </style>
</head>
<body>
  <main class="cover" aria-label="Paperback cover">
    <section class="back" aria-label="Back cover">
      <div class="back-copy">${renderPlainTextParagraphs(backCoverText)}</div>
      <div class="barcode-reserve">KDP barcode area</div>
    </section>
    <section class="spine" aria-label="Spine">
      ${
        coverSpec.spineTextAllowed
          ? `<div class="spine-text">${coverTitle} &middot; ${escapeHtml(input.story.authorPenName)}</div>`
          : ""
      }
    </section>
    <section class="front" aria-label="Front cover">
      ${
        coverImage ||
        `<div class="front-placeholder"><h1>${coverTitle}</h1>${coverSubtitle}<div class="author">${escapeHtml(input.story.authorPenName)}</div></div>`
      }
    </section>
  </main>
</body>
</html>
`;

  const html = `<!doctype html>
<html lang="${escapeHtml(input.story.language || "en")}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(input.story.title)} paperback interior</title>
  <style>${cssFor(options, coverSpec)}</style>
</head>
<body>
${body}
<!--
Cover helper:
Trim: ${coverSpec.trimSize.label}
Page count used for spine: ${coverSpec.pageCount}
Spine: ${inches(coverSpec.spineWidthIn)}
Full cover: ${inches(coverSpec.coverWidthIn)} x ${inches(coverSpec.coverHeightIn)}
-->
</body>
</html>
`;

  return { html, coverHtml, coverSpec, options, warnings };
}
