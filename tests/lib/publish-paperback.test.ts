import { describe, expect, it } from "vitest";
import type { Chapter, Story } from "@/lib/types";
import { buildPaperbackHtml } from "@/lib/publish/paperback";
import {
  calculatePaperbackCoverSpec,
  estimatePaperbackPageCount,
  normalizePaperbackOptions,
  paperbackMinimumMargins,
} from "@/lib/publish/paperback-shared";

function story(): Story {
  return {
    slug: "paperback-test",
    title: "Paperback Test",
    subtitle: "A Print Trial",
    authorPenName: "P. Tester",
    description: "Testing print export.",
    copyrightYear: 2026,
    language: "en",
    bisacCategory: "FIC027000",
    keywords: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
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
      sections: [{ id: "s1", content: "Hello.\n\nThis is print-ready prose." }],
      wordCount: 6,
    },
  ];
}

describe("paperback shared calculations", () => {
  it("uses KDP gutter tiers and bleed outside margins", () => {
    expect(paperbackMinimumMargins(150, false).insideIn).toBe(0.375);
    expect(paperbackMinimumMargins(151, false).insideIn).toBe(0.5);
    expect(paperbackMinimumMargins(301, true)).toMatchObject({
      insideIn: 0.625,
      outsideIn: 0.375,
    });
  });

  it("calculates cover wrap dimensions from trim, bleed, spine, and page count", () => {
    const opts = normalizePaperbackOptions({
      trimSizeId: "6x9",
      paperType: "white",
      pageCountOverride: 100,
    });
    const spec = calculatePaperbackCoverSpec(opts, estimatePaperbackPageCount(20_000));
    expect(spec.spineWidthIn).toBeCloseTo(0.2252, 4);
    expect(spec.coverWidthIn).toBeCloseTo(12.4752, 4);
    expect(spec.coverHeightIn).toBe(9.25);
    expect(spec.spineTextAllowed).toBe(true);
  });
});

describe("buildPaperbackHtml", () => {
  it("renders front matter, chapter prose, print CSS, and cover comments", async () => {
    const out = await buildPaperbackHtml({
      story: story(),
      chapters: chapters(),
      options: { trimSizeId: "6x9", bleed: false, pageCountOverride: 24 },
    });

    expect(out.html).toContain("<!doctype html>");
    expect(out.html).toContain("Paperback Test");
    expect(out.html).toContain("Copyright");
    expect(out.html).toContain("Chapter 1");
    expect(out.html).toContain("This is print-ready prose.");
    expect(out.html).toContain("@page");
    expect(out.html).toContain("Full cover:");
    expect(out.coverHtml).toContain("Paperback Test paperback cover");
    expect(out.coverHtml).toContain("Testing print export.");
    expect(out.coverHtml).toContain("KDP barcode area");
    expect(out.coverSpec.pageCount).toBe(24);
  });
});
