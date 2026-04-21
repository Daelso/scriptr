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
  opts?: PreviewOpts
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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const epubGen: unknown = require("epub-gen-memory");

type EpubGenFn = (
  options: {
    title: string;
    author: string;
    description?: string;
    lang?: string;
    cover?: string;
    ignoreFailedDownloads?: boolean;
    css?: string;
  },
  content: Array<{ title: string; content: string }>
) => Promise<Buffer>;

function getGenerator(): EpubGenFn {
  const mod = epubGen as { default?: EpubGenFn } & EpubGenFn;
  return (mod.default ?? mod) as EpubGenFn;
}

export async function buildEpubBytes(input: EpubInput): Promise<Uint8Array> {
  const { story, chapters, coverPath } = input;

  const content = chapters.map((chapter, idx) => {
    const inner = renderChapterPreviewHtml(chapter, { chapterNumber: idx + 1 });
    // Strip the outer .epub-preview wrapper — not meaningful in the package XHTML.
    const stripped = inner
      .replace(/^<div class="epub-preview">/, "")
      .replace(/<\/div>$/, "");
    return {
      title: chapter.title || `Chapter ${idx + 1}`,
      content: stripped,
    };
  });

  const generator = getGenerator();
  const buffer = await generator(
    {
      title: story.title,
      author: story.authorPenName,
      description: story.description,
      lang: story.language || "en",
      cover: coverPath,
      ignoreFailedDownloads: true,
      css: EPUB_STYLESHEET,
    },
    content
  );

  return new Uint8Array(buffer);
}

// EPUB validation. The plan named `epubcheck-wasm` but that package does not
// exist on npm; Chunk 1 substituted `@likecoin/epubcheck-ts@0.6.0` per the
// spec's fallback clause. Its API exposes `EpubCheck.validate(data, options?)`
// returning `{ valid, messages: ValidationMessage[], warningCount, ... }` where
// each message has `{ id, severity, message }`. The validator accepts a
// `Uint8Array` directly, so no temp file is needed.
//
// We use dynamic `import()` rather than `require()` because the package is
// pure ESM (`"type": "module"`) and one of its transitive deps
// (`libxml2-wasm`) uses top-level await — which CJS `require()` cannot load.
//
// We surface every non-info / non-usage message as a warning string.
// Validation is non-blocking — any throw is caught and reported as a single
// warning instead of propagating.
type EpubcheckMessage = {
  id?: string;
  severity?: string;
  message?: string;
};
type EpubcheckResult = {
  valid?: boolean;
  messages?: EpubcheckMessage[];
};
type EpubcheckModule = {
  EpubCheck?: {
    validate?: (data: Uint8Array) => Promise<EpubcheckResult>;
  };
  default?: {
    EpubCheck?: {
      validate?: (data: Uint8Array) => Promise<EpubcheckResult>;
    };
  };
};

export type ValidationResult = { warnings: string[] };

export async function validateEpub(bytes: Uint8Array): Promise<ValidationResult> {
  try {
    const mod = (await import("@likecoin/epubcheck-ts")) as EpubcheckModule;
    const ns = mod.default ?? mod;
    const validate = ns.EpubCheck?.validate;
    if (typeof validate !== "function") {
      return { warnings: ["validator error: @likecoin/epubcheck-ts API not recognized"] };
    }
    const report = await validate(bytes);
    const messages = report.messages ?? [];
    const warnings = messages
      .filter((m) => m.severity !== "info" && m.severity !== "usage")
      .map((m) => {
        const sev = m.severity ? `[${m.severity}] ` : "";
        const id = m.id ? `${m.id}: ` : "";
        return `${sev}${id}${m.message ?? ""}`.trim();
      });
    return { warnings };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { warnings: [`validator error: ${msg}`] };
  }
}
