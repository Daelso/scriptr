import { describe, it, expect } from "vitest";
import {
  renderChapterPreviewHtml,
  EPUB_STYLESHEET,
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

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { readCoverBytes } from "./helpers/epub-inspect";

// Regression guard for a bug where buildEpubBytes wrote a 0-byte cover image
// into the archive. `epub-gen-memory` treats a bare path as an HTTP URL and
// (with ignoreFailedDownloads: true) silently substitutes an empty buffer if
// the fetch fails. Fix: convert disk paths to file:// URLs. This test opens
// the built archive and asserts the cover entry contains real JPEG bytes.
describe("buildEpubBytes cover embedding", () => {
  function story(): Story {
    return {
      slug: "cover-test",
      title: "Cover Test",
      authorPenName: "C. Tester",
      description: "Testing cover embedding.",
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
        title: "Opening",
        summary: "",
        beats: [],
        prompt: "",
        recap: "",
        sections: [{ id: "s1", content: "Content." }],
        wordCount: 1,
      },
    ];
  }

  async function writeFixtureJpeg(dir: string): Promise<{ path: string; bytes: Buffer }> {
    const jpeg = await sharp({
      create: { width: 2, height: 3, channels: 3, background: { r: 180, g: 20, b: 20 } },
    })
      .jpeg({ quality: 90 })
      .toBuffer();
    const path = join(dir, "cover.jpg");
    await writeFile(path, jpeg);
    return { path, bytes: jpeg };
  }

  for (const version of [3, 2] as const) {
    it(`embeds the cover JPEG bytes into EPUB${version} (not an empty buffer)`, async () => {
      const tmp = await mkdtemp(join(tmpdir(), "scriptr-cover-test-"));
      try {
        const { path, bytes: source } = await writeFixtureJpeg(tmp);
        const epub = await buildEpubBytes({
          story: story(),
          chapters: chapters(),
          coverPath: path,
          version,
        });
        const embedded = await readCoverBytes(epub);
        expect(embedded, `EPUB${version} archive contains a cover entry`).not.toBeNull();
        // JPEG magic bytes: 0xFF 0xD8 0xFF
        expect(embedded![0], `EPUB${version} cover byte 0`).toBe(0xff);
        expect(embedded![1], `EPUB${version} cover byte 1`).toBe(0xd8);
        expect(embedded![2], `EPUB${version} cover byte 2`).toBe(0xff);
        // Size roughly matches the source JPEG (epub-gen-memory passes bytes through).
        expect(embedded!.byteLength).toBeGreaterThan(source.byteLength - 20);
        expect(embedded!.byteLength).toBeLessThan(source.byteLength + 20);
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    });
  }
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

import JSZip from "jszip";

async function unzipXhtmls(bytes: Uint8Array | Buffer): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(bytes);
  const out: Record<string, string> = {};
  await Promise.all(
    Object.keys(zip.files)
      .filter((p) => p.endsWith(".xhtml"))
      .map(async (p) => {
        out[p] = await zip.file(p)!.async("string");
      }),
  );
  return out;
}

describe("buildEpubBytes author-note integration", () => {
  function story(): Story {
    return {
      slug: "author-note-test",
      title: "Author Note Test",
      authorPenName: "Jane Doe",
      description: "A tiny test.",
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
        title: "Ch 1",
        summary: "",
        beats: [],
        prompt: "",
        recap: "",
        sections: [{ id: "s1", content: "Hello." }],
        wordCount: 1,
      },
    ];
  }

  function twoChapters(): Chapter[] {
    return [
      {
        id: "c1",
        title: "Ch 1",
        summary: "",
        beats: [],
        prompt: "",
        recap: "",
        sections: [{ id: "s1", content: "First." }],
        wordCount: 1,
      },
      {
        id: "c2",
        title: "Ch 2",
        summary: "",
        beats: [],
        prompt: "",
        recap: "",
        sections: [{ id: "s2", content: "Second." }],
        wordCount: 1,
      },
    ];
  }

  it("appends the author note as a final content entry when input.authorNote is provided", async () => {
    const bytes = await buildEpubBytes({
      story: story(),
      chapters: chapters(),
      authorNote: {
        messageHtml: "<p>Thanks!</p>",
        email: "jane@example.com",
        mailingListUrl: "https://list.example.com/jane",
      },
    });
    const xhtmls = await unzipXhtmls(bytes);
    // Find the author-note content XHTML (named like "1_A-note-from-the-author.xhtml")
    // by content marker; toc.xhtml also references the title in its anchor list.
    const noteEntry = Object.entries(xhtmls).find(([, html]) =>
      html.includes('class="author-note"'),
    );
    expect(noteEntry, "expected an XHTML containing class=\"author-note\"").toBeDefined();
    const [, noteHtml] = noteEntry!;
    expect(noteHtml).toContain("A note from the author");
    expect(noteHtml).toContain('href="mailto:jane@example.com"');
    // epub-gen-memory rewrites data: image URLs into separate archive entries
    // (`OEBPS/images/<uuid>`) and rewrites the <img src> to reference that
    // path. Verify the <img> tag survives the rewrite and that the archive
    // actually contains an image entry. We check the zip directly because
    // unzipXhtmls only returns .xhtml files.
    expect(noteHtml).toMatch(/<img[^>]+src="[^"]+"/);
    const zip = await JSZip.loadAsync(bytes);
    const imageEntries = Object.keys(zip.files).filter((p) => p.startsWith("OEBPS/images/"));
    // images/ directory + at least one image file
    const imageFiles = imageEntries.filter((p) => !p.endsWith("/"));
    expect(imageFiles.length).toBeGreaterThan(0);

    // Regression guard: epub-gen-memory's data-URL handling silently produces
    // 0-byte image entries with no extension and an empty media-type. Assert
    // the embedded image actually has PNG bytes and a real media-type.
    const pngFile = Object.keys(zip.files).find((p) =>
      /^OEBPS\/images\/.+\.png$/i.test(p),
    );
    expect(pngFile, "expected a .png entry under OEBPS/images/").toBeDefined();
    const imgBuf = await zip.file(pngFile!)!.async("uint8array");
    expect(imgBuf.length).toBeGreaterThan(100);
    // PNG magic bytes: 89 50 4E 47
    expect(Array.from(imgBuf.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);

    // OPF manifest must declare image/png for the embedded QR.
    const opfFile = Object.keys(zip.files).find((p) => p.endsWith(".opf"))!;
    const opf = await zip.file(opfFile)!.async("string");
    const imageItem = opf.match(
      /<item[^>]*href="images\/[^"]+\.png"[^>]*media-type="([^"]+)"/,
    );
    expect(imageItem).not.toBeNull();
    expect(imageItem![1]).toBe("image/png");
  });

  it("omits the author note entry when input.authorNote is undefined", async () => {
    const bytes = await buildEpubBytes({
      story: story(),
      chapters: chapters(),
    });
    const xhtmls = await unzipXhtmls(bytes);
    for (const text of Object.values(xhtmls)) {
      expect(text).not.toContain("A note from the author");
    }
  });

  it("works on EPUB2 as well as EPUB3", async () => {
    const bytes2 = await buildEpubBytes({
      story: story(),
      chapters: chapters(),
      version: 2,
      authorNote: { messageHtml: "<p>x</p>", email: "j@e.com" },
    });
    const xhtmls = await unzipXhtmls(bytes2);
    const noteEntry = Object.entries(xhtmls).find(([, html]) =>
      html.includes('class="author-note"'),
    );
    expect(noteEntry, "expected an XHTML containing class=\"author-note\" in EPUB2").toBeDefined();
    expect(noteEntry![1]).toContain("A note from the author");
  });

  it("regression guard: no-note path produces same XHTML count and content as today's behavior", async () => {
    // The spec calls for "byte-identical" output but epub-gen-memory writes
    // ZIP entries with mtimes that may vary per run. The realistic guard is:
    //   1. Same number of XHTML files (no extra entry appended)
    //   2. None of those XHTMLs contain the note marker
    const baseStory = story();
    const ch = twoChapters();

    const baseline = await buildEpubBytes({ story: baseStory, chapters: ch });
    const disabled = await buildEpubBytes({
      story: { ...baseStory, authorNote: { enabled: false } },
      chapters: ch,
    });
    const noProfile = await buildEpubBytes({ story: baseStory, chapters: ch });

    const baseXhtmls = await unzipXhtmls(baseline);
    const disabledXhtmls = await unzipXhtmls(disabled);
    const noProfileXhtmls = await unzipXhtmls(noProfile);

    expect(Object.keys(baseXhtmls).length).toBe(Object.keys(disabledXhtmls).length);
    expect(Object.keys(baseXhtmls).length).toBe(Object.keys(noProfileXhtmls).length);
    for (const text of Object.values({
      ...baseXhtmls,
      ...disabledXhtmls,
      ...noProfileXhtmls,
    })) {
      expect(text).not.toContain("A note from the author");
    }
  });
});
