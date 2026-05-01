import { describe, it, expect } from "vitest";
import { applyBoilerplateFlags } from "@/lib/epub/boilerplate";
import type { ChapterDraft } from "@/lib/epub/types";

function draft(navTitle: string): ChapterDraft {
  return {
    navTitle,
    body: "Some body text.",
    wordCount: 3,
    sourceHref: "OEBPS/x.xhtml",
    skippedByDefault: false,
    source: "nav",
  };
}

describe("applyBoilerplateFlags — denylist matches", () => {
  const cases: [string, string][] = [
    ["Copyright", "copyright"],
    ["Dedication", "dedication"],
    ["Acknowledgments", "acknowledg"],
    ["About the Author", "about the author"],
    ["Also by Jane Smith", "also by"],
    ["Table of Contents", "table of contents"],
    ["Title Page", "title page"],
    ["Other Works", "other works"],
    ["Cover", "cover"],
    ["Halftitle", "halftitle"],
    ["Frontmatter", "frontmatter"],
    ["Backmatter", "backmatter"],
    ["Imprint", "imprint"],
    ["Colophon", "colophon"],
  ];
  for (const [title, expectedReason] of cases) {
    it(`flags "${title}" with reason mentioning "${expectedReason}"`, () => {
      const out = applyBoilerplateFlags([draft(title)]);
      expect(out[0].skippedByDefault).toBe(true);
      expect(out[0].skipReason?.toLowerCase()).toContain(expectedReason);
    });
  }
});

describe("applyBoilerplateFlags — non-matches", () => {
  const titles = ["Chapter 1", "The Beginning", "Prologue", "Epilogue", "Part One"];
  for (const title of titles) {
    it(`does NOT flag "${title}"`, () => {
      const out = applyBoilerplateFlags([draft(title)]);
      expect(out[0].skippedByDefault).toBe(false);
      expect(out[0].skipReason).toBeUndefined();
    });
  }
});

describe("applyBoilerplateFlags — preserves prior skips", () => {
  it("keeps a prior skippedByDefault=true and its reason", () => {
    const ch = draft("Chapter 1");
    ch.skippedByDefault = true;
    ch.skipReason = "Empty chapter";
    const [out] = applyBoilerplateFlags([ch]);
    expect(out.skippedByDefault).toBe(true);
    expect(out.skipReason).toBe("Empty chapter");
  });
});
