import { describe, it, expect } from "vitest";
import { cleanPaste, type CleanupStep } from "@/lib/publish/cleanup";

describe("cleanPaste — skeleton", () => {
  it("returns a result with sections[] and warnings[]", () => {
    const res = cleanPaste("hello world");
    expect(Array.isArray(res.sections)).toBe(true);
    expect(Array.isArray(res.warnings)).toBe(true);
  });

  it("exposes the full list of cleanup steps", () => {
    const steps: CleanupStep[] = [
      "normalizeLineEndings",
      "stripChatCruft",
      "trimTrailingWhitespace",
      "collapseInternalSpaces",
      "normalizeQuotes",
      "normalizeSceneBreaks",
      "normalizeDashes",
      "preserveMarkdownEmphasis",
      "collapseBlankLines",
      "splitIntoSections",
    ];
    expect(steps).toHaveLength(10);
  });
});

describe("normalizeLineEndings", () => {
  it("converts CRLF to LF", () => {
    const out = cleanPaste("a\r\nb\r\nc");
    expect(out.sections[0]).not.toMatch(/\r/);
    expect(out.sections[0].split("\n")).toEqual(["a", "b", "c"]);
  });

  it("converts lone CR to LF", () => {
    const out = cleanPaste("a\rb\rc");
    expect(out.sections[0]).not.toMatch(/\r/);
  });

  it("leaves already-LF text unchanged", () => {
    const out = cleanPaste("a\nb\nc");
    expect(out.sections[0]).toBe("a\nb\nc");
  });

  it("can be disabled", () => {
    const out = cleanPaste("a\r\nb", { normalizeLineEndings: false });
    expect(out.sections[0]).toContain("\r");
  });
});
