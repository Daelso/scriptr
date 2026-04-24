import { describe, it, expect } from "vitest";
import { cleanNovelAIText, titleFromFilename } from "@/lib/novelai/text-clean";

describe("cleanNovelAIText", () => {
  it("strips the premise block up to and including the first [N/M] marker", () => {
    const raw = [
      "Story Premise (fixed canon):",
      "Some long-form user-written canon notes that should be dropped.",
      "More directives and user-typed context.",
      "",
      "Begin with Chapter 1: do this and that.",
      "[1/3]",
      "The story truly begins here.",
      "",
      "More prose continues.",
    ].join("\n");

    const out = cleanNovelAIText(raw);

    expect(out.prose).not.toContain("Story Premise");
    expect(out.prose).not.toContain("user-written canon");
    expect(out.prose).not.toContain("Begin with Chapter 1");
    expect(out.prose).not.toContain("[1/3]");
    expect(out.prose).toContain("The story truly begins here.");
    expect(out.prose).toContain("More prose continues.");
  });

  it("drops subsequent [N/M] markers from the body", () => {
    const raw = [
      "[1/3]",
      "First page of prose.",
      "",
      "[2/3]",
      "Second page of prose.",
      "",
      "[3/3]",
      "Third page of prose.",
    ].join("\n");

    const out = cleanNovelAIText(raw);

    expect(out.prose).not.toContain("[1/3]");
    expect(out.prose).not.toContain("[2/3]");
    expect(out.prose).not.toContain("[3/3]");
    expect(out.prose).toContain("First page of prose.");
    expect(out.prose).toContain("Second page of prose.");
    expect(out.prose).toContain("Third page of prose.");
  });

  it("drops single-line {author's notes} blocks", () => {
    const raw = [
      "[1/1]",
      "Here is some prose.",
      "",
      "{ Lets include some small penis humiliation soon. }",
      "",
      "More prose after the note.",
    ].join("\n");

    const out = cleanNovelAIText(raw);

    expect(out.prose).not.toContain("{");
    expect(out.prose).not.toContain("humiliation soon");
    expect(out.prose).toContain("Here is some prose.");
    expect(out.prose).toContain("More prose after the note.");
  });

  it("drops multi-line {author's notes} blocks", () => {
    const raw = [
      "[1/1]",
      "Opening prose.",
      "",
      "{ This author note",
      "spans multiple",
      "lines and should vanish. }",
      "",
      "Closing prose.",
    ].join("\n");

    const out = cleanNovelAIText(raw);

    expect(out.prose).not.toContain("{");
    expect(out.prose).not.toContain("}");
    expect(out.prose).not.toContain("author note");
    expect(out.prose).not.toContain("spans multiple");
    expect(out.prose).not.toContain("should vanish");
    expect(out.prose).toContain("Opening prose.");
    expect(out.prose).toContain("Closing prose.");
  });

  it("preserves short dialogue lines (no length threshold)", () => {
    const raw = [
      "[1/1]",
      '"Dare," I said.',
      "",
      '"No," she said softly.',
      "",
      "More prose.",
    ].join("\n");

    const out = cleanNovelAIText(raw);

    expect(out.prose).toContain('"Dare," I said.');
    expect(out.prose).toContain('"No," she said softly.');
  });

  it("preserves ***, ---, //// markers and chapter headings", () => {
    const raw = [
      "[1/1]",
      "Paragraph one.",
      "",
      "***",
      "",
      "Paragraph two.",
      "",
      "---",
      "",
      "Paragraph three.",
      "",
      "////",
      "",
      "Chapter 2: Morning",
      "",
      "Paragraph four.",
    ].join("\n");

    const out = cleanNovelAIText(raw);

    expect(out.prose).toContain("***");
    expect(out.prose).toContain("---");
    expect(out.prose).toContain("////");
    expect(out.prose).toContain("Chapter 2: Morning");
  });

  it("normalizes paragraphs so each authored line becomes its own paragraph (blank-line separated)", () => {
    // NovelAI emits paragraphs with single `\n` separators. Scriptr's editor
    // needs `\n\n` (a blank line) to render them as distinct paragraphs —
    // otherwise they render as one giant run-on paragraph.
    const raw = [
      "[1/1]",
      "First paragraph of prose.",
      "Second paragraph after a single newline.",
      "Third paragraph also single-newline separated.",
    ].join("\n");

    const out = cleanNovelAIText(raw);

    expect(out.prose).toBe(
      "First paragraph of prose.\n\nSecond paragraph after a single newline.\n\nThird paragraph also single-newline separated."
    );
  });

  it("is idempotent when paragraphs are already `\\n\\n`-separated", () => {
    const raw = [
      "[1/1]",
      "Para one.",
      "",
      "Para two.",
      "",
      "Para three.",
    ].join("\n");

    const out = cleanNovelAIText(raw);

    expect(out.prose).toBe("Para one.\n\nPara two.\n\nPara three.");
  });

  it("collapses runs of 3+ blank lines and never produces 4+ consecutive newlines", () => {
    const raw = [
      "[1/1]",
      "Line one.",
      "",
      "",
      "",
      "",
      "Line two.",
      "",
      "",
      "",
      "Line three.",
    ].join("\n");

    const out = cleanNovelAIText(raw);

    expect(out.prose).not.toMatch(/\n\n\n/);
    expect(out.prose).toContain("Line one.");
    expect(out.prose).toContain("Line two.");
    expect(out.prose).toContain("Line three.");
  });

  it("applies fallback when there is no [N/M] marker but a Story Premise header exists", () => {
    const raw = [
      "Story Premise (fixed canon):",
      "Premise body that describes the setup of the story.",
      "Continued premise that spans a few lines.",
      "",
      "Actual prose begins here after the blank line.",
      "",
      "And continues.",
    ].join("\n");

    const out = cleanNovelAIText(raw);

    expect(out.prose).not.toContain("Story Premise");
    expect(out.prose).not.toContain("Premise body");
    expect(out.prose).toContain("Actual prose begins here");
    expect(out.prose).toContain("And continues.");
  });

  it("passes text through unchanged when neither [N/M] nor Story Premise pattern exists", () => {
    const raw = [
      "Just a plain document without NovelAI artifacts.",
      "",
      "Second paragraph.",
    ].join("\n");

    const out = cleanNovelAIText(raw);

    expect(out.prose).toContain("Just a plain document");
    expect(out.prose).toContain("Second paragraph.");
  });

  it("returns a ParsedStory shape with empty fields other than prose and title", () => {
    const out = cleanNovelAIText("[1/1]\nSome prose.", {
      titleFallback: "My Story",
    });

    expect(out.title).toBe("My Story");
    expect(out.description).toBe("");
    expect(out.textPreview).toBe("");
    expect(out.tags).toEqual([]);
    expect(out.contextBlocks).toEqual([]);
    expect(out.lorebookEntries).toEqual([]);
    expect(out.prose).toContain("Some prose.");
  });

  it("defaults title to empty string when no fallback is provided", () => {
    const out = cleanNovelAIText("[1/1]\nSome prose.");
    expect(out.title).toBe("");
  });

  it("trims leading and trailing whitespace on the final prose", () => {
    const raw = [
      "",
      "",
      "[1/1]",
      "Prose content.",
      "",
      "",
      "",
    ].join("\n");

    const out = cleanNovelAIText(raw);
    expect(out.prose.startsWith(" ")).toBe(false);
    expect(out.prose.startsWith("\n")).toBe(false);
    expect(out.prose.endsWith("\n")).toBe(false);
    expect(out.prose).toBe("Prose content.");
  });
});

describe("titleFromFilename", () => {
  it("strips .txt extension", () => {
    expect(titleFromFilename("My Story.txt")).toBe("My Story");
  });

  it("strips .story extension", () => {
    expect(titleFromFilename("My Story.story")).toBe("My Story");
  });

  it("strips NovelAI timestamp suffix", () => {
    expect(
      titleFromFilename(
        "Sorority Sissification (2026-04-24T14_16_27.902Z).txt"
      )
    ).toBe("Sorority Sissification");
  });

  it("strips NovelAI timestamp suffix on .story files", () => {
    expect(
      titleFromFilename("Garden at Dusk (2026-01-02T03_04_05.678Z).story")
    ).toBe("Garden at Dusk");
  });

  it("trims whitespace", () => {
    expect(titleFromFilename("  Padded Title  .txt")).toBe("Padded Title");
  });

  it("returns empty string when filename is just the extension", () => {
    expect(titleFromFilename(".txt")).toBe("");
  });
});
