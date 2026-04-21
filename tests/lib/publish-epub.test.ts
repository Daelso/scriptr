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
