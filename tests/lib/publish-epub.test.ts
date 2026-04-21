import { describe, it, expect } from "vitest";
import {
  renderChapterPreviewHtml,
  EPUB_STYLESHEET,
  type EpubInput,
} from "@/lib/publish/epub";
import type { Chapter } from "@/lib/types";

describe("epub module scaffold", () => {
  it("exports a stylesheet constant with key CSS rules", () => {
    expect(typeof EPUB_STYLESHEET).toBe("string");
    expect(EPUB_STYLESHEET).toMatch(/\.scene-break/);
    expect(EPUB_STYLESHEET).toMatch(/\.chapter-title/);
    expect(EPUB_STYLESHEET).toMatch(/page-break-before/);
  });

  it("renderChapterPreviewHtml returns a string wrapped in a div", () => {
    const chapter: Chapter = {
      id: "c1",
      title: "Test",
      summary: "",
      beats: [],
      prompt: "",
      recap: "",
      sections: [{ id: "s1", content: "Hello." }],
      wordCount: 1,
    };
    const html = renderChapterPreviewHtml(chapter, { chapterNumber: 1 });
    expect(html.startsWith("<div")).toBe(true);
    expect(html.endsWith("</div>")).toBe(true);
    expect(html).toContain("Chapter 1");
    expect(html).toContain("Hello.");
  });
});

describe("renderSectionHtml (transformer)", () => {
  function chapterWith(contents: string[]): Chapter {
    return {
      id: "c1",
      title: "T",
      summary: "",
      beats: [],
      prompt: "",
      recap: "",
      sections: contents.map((c, i) => ({ id: `s${i}`, content: c })),
      wordCount: 0,
    };
  }

  it("escapes HTML entities in raw text", () => {
    const html = renderChapterPreviewHtml(chapterWith(["<script>alert(1)</script>"]));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("transforms **bold** to <strong>", () => {
    const html = renderChapterPreviewHtml(chapterWith(["He was **angry**."]));
    expect(html).toContain("<strong>angry</strong>");
    expect(html).not.toContain("**");
  });

  it("transforms *italic* to <em>", () => {
    const html = renderChapterPreviewHtml(chapterWith(["She was *tired*."]));
    expect(html).toContain("<em>tired</em>");
  });

  it("supports nested italic inside bold via two-pass order", () => {
    const html = renderChapterPreviewHtml(chapterWith(["**bold with *italic* inside**"]));
    expect(html).toContain("<strong>bold with <em>italic</em> inside</strong>");
  });

  it("wraps each blank-line-separated paragraph in its own <p>", () => {
    const html = renderChapterPreviewHtml(chapterWith(["para one.\n\npara two."]));
    // Count unadorned <p> (not <p class=...>) — should be 2.
    const pCount = (html.match(/<p>/g) ?? []).length;
    expect(pCount).toBe(2);
  });

  it("renders a scene-break div between sections within a chapter", () => {
    const html = renderChapterPreviewHtml(chapterWith(["one", "two"]));
    expect(html).toContain('<div class="scene-break">* * *</div>');
  });

  it("collapses single newlines within a paragraph to spaces", () => {
    const html = renderChapterPreviewHtml(
      chapterWith(["line one\nline two\n\nnew para."])
    );
    expect(html).toContain("<p>line one line two</p>");
    expect(html).toContain("<p>new para.</p>");
  });
});
