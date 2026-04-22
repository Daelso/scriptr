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

import { buildEpubBytes } from "@/lib/publish/epub";
import type { Story } from "@/lib/types";

describe("buildEpubBytes", () => {
  function story(): Story {
    return {
      slug: "test-book",
      title: "Test Book",
      authorPenName: "J. Doe",
      description: "A tiny test.",
      copyrightYear: 2026,
      language: "en",
      bisacCategory: "FIC027000",
      keywords: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      chapterOrder: ["c1", "c2"],
    };
  }

  function chapters(): Chapter[] {
    return [
      {
        id: "c1",
        title: "Opening",
        summary: "",
        beats: [],
        prompt: "",
        recap: "",
        sections: [{ id: "s1", content: "It began." }],
        wordCount: 2,
      },
      {
        id: "c2",
        title: "Ending",
        summary: "",
        beats: [],
        prompt: "",
        recap: "",
        sections: [{ id: "s2", content: "It ended." }],
        wordCount: 2,
      },
    ];
  }

  it("produces a ZIP-magic-byte-prefixed buffer", async () => {
    const bytes = await buildEpubBytes({ story: story(), chapters: chapters() });
    expect(bytes.byteLength).toBeGreaterThan(500);
    const b = Buffer.from(bytes);
    expect(b[0]).toBe(0x50);
    expect(b[1]).toBe(0x4b);
  });

  it("handles missing coverPath without crashing", async () => {
    const bytes = await buildEpubBytes({
      story: story(),
      chapters: chapters(),
      coverPath: undefined,
    });
    expect(bytes.byteLength).toBeGreaterThan(500);
  });
});

import { readOpfVersion } from "./helpers/epub-inspect";

describe("buildEpubBytes version selection", () => {
  function story(): Story {
    return {
      slug: "version-test",
      title: "Version Test",
      authorPenName: "V. Tester",
      description: "Testing versions.",
      copyrightYear: 2026,
      language: "en",
      bisacCategory: "FIC027000",
      keywords: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      chapterOrder: ["c1"],
    };
  }

  function chapters(): Chapter[] {
    return [
      {
        id: "c1",
        title: "Chapter One",
        summary: "",
        beats: [],
        prompt: "",
        recap: "",
        sections: [{ id: "s1", content: "Content." }],
        wordCount: 1,
      },
    ];
  }

  it("buildEpubBytes with version 3 produces OPF with version=\"3.0\"", async () => {
    const bytes = await buildEpubBytes({ story: story(), chapters: chapters(), version: 3 });
    const opfVersion = await readOpfVersion(bytes);
    expect(opfVersion).toBe("3.0");
  });

  it("buildEpubBytes with version 2 produces OPF with version=\"2.0\"", async () => {
    const bytes = await buildEpubBytes({ story: story(), chapters: chapters(), version: 2 });
    const opfVersion = await readOpfVersion(bytes);
    expect(opfVersion).toBe("2.0");
  });

  it("buildEpubBytes defaults to version 3 when version is omitted", async () => {
    const bytes = await buildEpubBytes({ story: story(), chapters: chapters() });
    const opfVersion = await readOpfVersion(bytes);
    expect(opfVersion).toBe("3.0");
  });
});

import { validateEpub } from "@/lib/publish/epub";

describe("validateEpub", () => {
  // Local helpers — `story()` and `chapters()` from the previous describe
  // block are not in scope here. Same shape, so the test still exercises
  // a real built EPUB.
  function story(): Story {
    return {
      slug: "test-book",
      title: "Test Book",
      authorPenName: "J. Doe",
      description: "A tiny test.",
      copyrightYear: 2026,
      language: "en",
      bisacCategory: "FIC027000",
      keywords: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      chapterOrder: ["c1", "c2"],
    };
  }
  function chapters(): Chapter[] {
    return [
      {
        id: "c1",
        title: "Opening",
        summary: "",
        beats: [],
        prompt: "",
        recap: "",
        sections: [{ id: "s1", content: "It began." }],
        wordCount: 2,
      },
      {
        id: "c2",
        title: "Ending",
        summary: "",
        beats: [],
        prompt: "",
        recap: "",
        sections: [{ id: "s2", content: "It ended." }],
        wordCount: 2,
      },
    ];
  }

  it("returns a warnings array (possibly empty) for a built EPUB", async () => {
    const bytes = await buildEpubBytes({ story: story(), chapters: chapters() });
    const result = await validateEpub(bytes);
    expect(Array.isArray(result.warnings)).toBe(true);
  });
});
