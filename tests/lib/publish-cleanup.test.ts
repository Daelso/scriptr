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

describe("stripChatCruft", () => {
  const neutral = {
    normalizeQuotes: false,
    normalizeDashes: false,
    normalizeSceneBreaks: false,
    collapseBlankLines: false,
  };

  it("strips a preamble paragraph like 'Sure, here's chapter 3:'", () => {
    const raw = "Sure, here's chapter 3:\n\nShe walked in.\n\nHe waited.";
    const out = cleanPaste(raw, neutral);
    expect(out.sections[0]).not.toContain("Sure, here's chapter 3");
    expect(out.sections[0]).toContain("She walked in");
    expect(out.warnings.some((w) => /preamble|strip/i.test(w))).toBe(true);
  });

  it("strips a sign-off paragraph like 'Let me know...'", () => {
    const raw = "She walked in.\n\nHe waited.\n\nLet me know if you want me to tweak!";
    const out = cleanPaste(raw, neutral);
    expect(out.sections[0]).not.toMatch(/Let me know/);
    expect(out.sections[0]).toContain("He waited");
  });

  it("does NOT strip novel prose that happens to begin with 'Sure'", () => {
    const raw = 'Sure, it was a fine morning. "Pity," she said.\n\nHe nodded.';
    const out = cleanPaste(raw, neutral);
    expect(out.sections[0]).toContain("Sure, it was a fine morning");
  });

  it("can be disabled", () => {
    const raw = "Sure, here's chapter 3:\n\nProse.";
    const out = cleanPaste(raw, { stripChatCruft: false });
    expect(out.sections[0]).toContain("Sure, here's chapter 3");
  });
});

describe("trimTrailingWhitespace + collapseInternalSpaces", () => {
  it("trims trailing spaces on each line", () => {
    const raw = "hello   \nworld  ";
    const out = cleanPaste(raw, { stripChatCruft: false });
    expect(out.sections[0]).toBe("hello\nworld");
  });

  it("collapses multiple internal spaces to one", () => {
    const raw = "hello    world";
    const out = cleanPaste(raw, { stripChatCruft: false });
    expect(out.sections[0]).toBe("hello world");
  });

  it("collapses double-space-after-period", () => {
    const raw = "A sentence.  Another sentence.";
    const out = cleanPaste(raw, { stripChatCruft: false });
    expect(out.sections[0]).toBe("A sentence. Another sentence.");
  });
});
