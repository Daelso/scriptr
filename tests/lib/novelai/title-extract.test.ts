import { describe, it, expect } from "vitest";
import { extractBracketTitle } from "@/lib/novelai/title-extract";

describe("extractBracketTitle", () => {
  it("extracts a bracket title that is the first line", () => {
    const r = extractBracketTitle("[Chosen by the Goddess]\n\nThe morning light...");
    expect(r.title).toBe("Chosen by the Goddess");
    expect(r.body).toBe("The morning light...");
  });

  it("extracts when bracket is preceded by blank lines", () => {
    const r = extractBracketTitle("\n\n[Title]\n\nbody");
    expect(r.title).toBe("Title");
    expect(r.body).toBe("body");
  });

  it("strips the matched line and any blank lines immediately following it", () => {
    const r = extractBracketTitle("[Title]\n\n\n\nbody starts here");
    expect(r.title).toBe("Title");
    expect(r.body).toBe("body starts here");
  });

  it("trims whitespace inside the brackets", () => {
    const r = extractBracketTitle("[  Padded Title  ]\n\nbody");
    expect(r.title).toBe("Padded Title");
    expect(r.body).toBe("body");
  });

  it("handles \\r\\n line endings (normalizes output to \\n)", () => {
    // The whole NovelAI splitter pipeline normalizes line endings to \n
    // (see splitProseIntoStories itself). This helper does the same: it
    // splits on /\r?\n/ and rejoins with "\n", so CRLF inputs come out
    // with LF endings.
    const r = extractBracketTitle("[Title]\r\n\r\nbody line one\r\nbody line two");
    expect(r.title).toBe("Title");
    expect(r.body).toBe("body line one\nbody line two");
  });

  it("does not normalize line endings on no-match inputs", () => {
    const original = "Prose with\r\nCRLF endings and [an inline bracket].";
    const r = extractBracketTitle(original);
    expect(r.title).toBeNull();
    expect(r.body).toBe(original);
  });

  it("returns null/unchanged when first non-blank line is prose", () => {
    const original = "The morning light spilled across [the temple floor].\n\nMore prose.";
    const r = extractBracketTitle(original);
    expect(r.title).toBeNull();
    expect(r.body).toBe(original);
  });

  it("returns null/unchanged for empty input", () => {
    const r = extractBracketTitle("");
    expect(r.title).toBeNull();
    expect(r.body).toBe("");
  });

  it("returns null for empty brackets []", () => {
    const original = "[]\n\nbody";
    const r = extractBracketTitle(original);
    expect(r.title).toBeNull();
    expect(r.body).toBe(original);
  });

  it("returns null for whitespace-only brackets [   ]", () => {
    const original = "[   ]\n\nbody";
    const r = extractBracketTitle(original);
    expect(r.title).toBeNull();
    expect(r.body).toBe(original);
  });

  it("returns null for tab-only brackets [\\t]", () => {
    const original = "[\t]\n\nbody";
    const r = extractBracketTitle(original);
    expect(r.title).toBeNull();
    expect(r.body).toBe(original);
  });

  it("does not match if the bracket has trailing prose on the same line", () => {
    const original = "[Title] and the morning light...\n\nbody";
    const r = extractBracketTitle(original);
    expect(r.title).toBeNull();
    expect(r.body).toBe(original);
  });

  it("does not match a multi-line bracket span", () => {
    const original = "[Line one\nLine two]\n\nbody";
    const r = extractBracketTitle(original);
    expect(r.title).toBeNull();
    expect(r.body).toBe(original);
  });

  it("does not match a line with two adjacent bracket groups", () => {
    const original = "[Setting] [Author's note]\n\nbody";
    const r = extractBracketTitle(original);
    expect(r.title).toBeNull();
    expect(r.body).toBe(original);
  });

  it("does not match a line with bracket then text then bracket", () => {
    const original = "[Title] continued [more]\n\nbody";
    const r = extractBracketTitle(original);
    expect(r.title).toBeNull();
    expect(r.body).toBe(original);
  });

  it("returns body='' for bracket-only input with no following prose", () => {
    const r = extractBracketTitle("[Title]");
    expect(r.title).toBe("Title");
    expect(r.body).toBe("");
  });

  it("returns body='' for bracket-only input with trailing newline", () => {
    const r = extractBracketTitle("[Title]\n");
    expect(r.title).toBe("Title");
    expect(r.body).toBe("");
  });

  it("preserves interior blank lines (only strips blanks immediately after the matched line)", () => {
    const r = extractBracketTitle("[Title]\n\nfirst para\n\nsecond para");
    expect(r.title).toBe("Title");
    expect(r.body).toBe("first para\n\nsecond para");
  });
});
