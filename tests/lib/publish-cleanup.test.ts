import { describe, it, expect } from "vitest";
import {
  cleanPaste,
  splitChapterChunks,
  type CleanupStep,
} from "@/lib/publish/cleanup";

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
    const out = cleanPaste(raw, { stripChatCruft: false, normalizeQuotes: false });
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

describe("normalizeQuotes", () => {
  it("converts straight doubles to curly contextually", () => {
    const raw = '"You\'re here," she said.';
    const out = cleanPaste(raw, { stripChatCruft: false });
    expect(out.sections[0]).toContain("\u201CYou");
    expect(out.sections[0]).toContain(",\u201D she said");
  });

  it("uses closing single for contractions (don't, he'd)", () => {
    const raw = "don't he'd won't";
    const out = cleanPaste(raw, { stripChatCruft: false });
    expect(out.sections[0]).toBe("don\u2019t he\u2019d won\u2019t");
  });

  it("uses opening single after whitespace", () => {
    const raw = "He said, 'no.'";
    const out = cleanPaste(raw, { stripChatCruft: false });
    expect(out.sections[0]).toContain("\u2018no");
    expect(out.sections[0]).toContain("no.\u2019");
  });

  it("preserves already-curly quotes", () => {
    const raw = "\u201Calready curly\u201D";
    const out = cleanPaste(raw, { stripChatCruft: false });
    expect(out.sections[0]).toBe("\u201Calready curly\u201D");
  });

  it("can be disabled", () => {
    const raw = '"foo"';
    const out = cleanPaste(raw, { normalizeQuotes: false, stripChatCruft: false });
    expect(out.sections[0]).toBe('"foo"');
  });

  it("emits a warning with the count of converted quotes", () => {
    const raw = '"a" "b" don\'t';
    const out = cleanPaste(raw, { stripChatCruft: false });
    const msg = out.warnings.find((w) => /quote/i.test(w));
    expect(msg).toBeDefined();
    expect(msg).toMatch(/\d+/);
  });
});

describe("normalizeSceneBreaks", () => {
  const base = { stripChatCruft: false, normalizeQuotes: false };

  it("converts * * * to ---", () => {
    const raw = "a\n\n* * *\n\nb";
    const out = cleanPaste(raw, base);
    expect(out.sections).toEqual(["a", "b"]);
  });

  it("converts *** to ---", () => {
    const raw = "a\n\n***\n\nb";
    const out = cleanPaste(raw, base);
    expect(out.sections).toEqual(["a", "b"]);
  });

  it("converts a lone # to ---", () => {
    const raw = "a\n\n#\n\nb";
    const out = cleanPaste(raw, base);
    expect(out.sections).toEqual(["a", "b"]);
  });

  it("collapses 3+ blank lines to a scene break", () => {
    const raw = "a\n\n\n\nb";
    const out = cleanPaste(raw, base);
    expect(out.sections).toEqual(["a", "b"]);
  });

  it("leaves already-canonical --- markers alone", () => {
    const raw = "a\n\n---\n\nb";
    const out = cleanPaste(raw, base);
    expect(out.sections).toEqual(["a", "b"]);
  });

  it("warns per marker normalized", () => {
    const raw = "a\n\n* * *\n\nb\n\n***\n\nc";
    const out = cleanPaste(raw, base);
    const msg = out.warnings.find((w) => /scene|break/i.test(w));
    expect(msg).toBeDefined();
  });
});

describe("normalizeDashes", () => {
  const base = { stripChatCruft: false, normalizeQuotes: false };

  it("converts -- to em dash", () => {
    const raw = "She walked -- slowly -- into the room.";
    const out = cleanPaste(raw, base);
    expect(out.sections[0]).toBe("She walked \u2014 slowly \u2014 into the room.");
  });

  it("does NOT touch --- scene markers (regression guard for ordering bug)", () => {
    const raw = "a\n\n---\n\nb";
    const out = cleanPaste(raw, base);
    expect(out.sections).toEqual(["a", "b"]);
  });

  it("leaves hyphens in compound words alone", () => {
    const raw = "state-of-the-art";
    const out = cleanPaste(raw, base);
    expect(out.sections[0]).toBe("state-of-the-art");
  });
});

describe("preserveMarkdownEmphasis", () => {
  const base = { stripChatCruft: false, normalizeQuotes: false };

  it("leaves *italic* and **bold** in content by default (on)", () => {
    const raw = "She was *very* tired. He was **angry**.";
    const out = cleanPaste(raw, base);
    expect(out.sections[0]).toBe("She was *very* tired. He was **angry**.");
  });

  it("strips markdown markers when disabled (off), keeping inner text", () => {
    const raw = "She was *very* tired. He was **angry**.";
    const out = cleanPaste(raw, { ...base, preserveMarkdownEmphasis: false });
    expect(out.sections[0]).toBe("She was very tired. He was angry.");
  });
});

describe("collapseBlankLines + splitIntoSections", () => {
  const base = { stripChatCruft: false, normalizeQuotes: false };

  it("collapses runs of >1 blank line (that weren't scene breaks) to one", () => {
    const raw = "a\n\n\nb"; // two blank lines; not a scene break (needs 3+)
    const out = cleanPaste(raw, base);
    expect(out.sections[0]).toBe("a\n\nb");
  });

  it("splits on --- markers into multiple sections", () => {
    const raw = "first section\n\n---\n\nsecond section\n\n---\n\nthird";
    const out = cleanPaste(raw, base);
    expect(out.sections).toEqual(["first section", "second section", "third"]);
  });

  it("leading / trailing --- do not create empty sections", () => {
    const raw = "---\n\na\n\n---\n\nb\n\n---";
    const out = cleanPaste(raw, base);
    expect(out.sections).toEqual(["a", "b"]);
  });

  it("a paste with no --- returns one section", () => {
    const raw = "single scene only";
    const out = cleanPaste(raw, base);
    expect(out.sections).toEqual(["single scene only"]);
  });
});

describe("cleanPaste idempotency + end-to-end", () => {
  it("running cleanPaste on its own (rejoined) output yields identical sections", () => {
    const raw = [
      "Sure, here's chapter 3:",
      "",
      'She walked in -- slowly -- and said "hi."',
      "",
      "* * *",
      "",
      "He replied, 'yes.'",
      "",
      "Let me know if you want more.",
    ].join("\n");

    const first = cleanPaste(raw);
    const rejoin = first.sections.join("\n\n---\n\n");
    const second = cleanPaste(rejoin);

    expect(second.sections).toEqual(first.sections);
  });

  it("kitchen-sink paste produces expected sections", () => {
    const raw = [
      "Here's the chapter:",
      "",
      "Chapter 3: The Return",
      "",
      'She walked into the room -- the same room. "You\'re here," she said.',
      "",
      '"I never left."',
      "",
      "***",
      "",
      "Later, in the kitchen, she poured two glasses of wine...",
      "",
      "Hope you like it!",
    ].join("\n");
    const out = cleanPaste(raw);

    expect(out.sections.join("\n")).not.toMatch(/Here's the chapter/);
    expect(out.sections.join("\n")).not.toMatch(/Hope you like it/);
    expect(out.sections.length).toBeGreaterThanOrEqual(2);
    expect(out.sections[0]).toContain("\u2014");
    expect(out.sections[0]).toContain("\u201CYou");
    expect(out.warnings.length).toBeGreaterThan(0);
  });
});

describe("unmatched === word === warning", () => {
  it("warns when a ===-bracketed word other than 'chapter' appears", () => {
    const raw = "a\n\n=== END ===\n\nb";
    const out = cleanPaste(raw, { stripChatCruft: false, normalizeQuotes: false });
    const msg = out.warnings.find((w) => /did you mean/i.test(w));
    expect(msg).toBeDefined();
    expect(msg).toMatch(/END/i);
    expect(msg).toMatch(/CHAPTER/i);
  });

  it("does NOT warn on plain === (no word)", () => {
    const raw = "a\n\n===\n\nb";
    const out = cleanPaste(raw, { stripChatCruft: false, normalizeQuotes: false });
    expect(out.warnings.some((w) => /did you mean/i.test(w))).toBe(false);
  });

  it("does NOT warn on the canonical === CHAPTER === form", () => {
    // cleanup pipeline is the fallback if pre-split missed it; this test
    // verifies we don't self-trigger on the canonical form.
    const raw = "a\n\n=== CHAPTER ===\n\nb";
    const out = cleanPaste(raw, { stripChatCruft: false, normalizeQuotes: false });
    expect(out.warnings.some((w) => /did you mean/i.test(w))).toBe(false);
  });

  it("leaves === CHAPTER === in the prose if pre-split didn't consume it (defense-in-depth)", () => {
    // The existing MARKER_LINE regex does NOT match lines with embedded words,
    // so the canonical marker survives cleanup as literal text. This verifies
    // the survival — if a regression ever widens MARKER_LINE to swallow
    // `=== CHAPTER ===`, this test catches it.
    const raw = "a\n\n=== CHAPTER ===\n\nb";
    const out = cleanPaste(raw, { stripChatCruft: false, normalizeQuotes: false });
    expect(out.sections.join("\n")).toContain("=== CHAPTER ===");
    expect(out.sections.join("\n")).not.toContain("\n---\n");
  });
});

describe("splitChapterChunks", () => {
  it("returns [raw] when no marker present", () => {
    expect(splitChapterChunks("just prose")).toEqual(["just prose"]);
  });

  it("splits on canonical === CHAPTER === marker", () => {
    const raw = "chapter one prose\n\n=== CHAPTER ===\n\nchapter two prose";
    expect(splitChapterChunks(raw)).toEqual([
      "chapter one prose\n\n",
      "\n\nchapter two prose",
    ]);
  });

  it("accepts case-insensitive variants", () => {
    const lower = "a\n=== chapter ===\nb";
    const title = "a\n=== Chapter ===\nb";
    const tight = "a\n===CHAPTER===\nb";
    const wide = "a\n==== CHAPTER ====\nb";
    for (const raw of [lower, title, tight, wide]) {
      const out = splitChapterChunks(raw);
      expect(out).toHaveLength(2);
    }
  });

  it("does NOT split on === without the word 'chapter'", () => {
    expect(splitChapterChunks("a\n===\nb")).toEqual(["a\n===\nb"]);
    expect(splitChapterChunks("a\n=== END ===\nb")).toEqual(["a\n=== END ===\nb"]);
  });

  it("handles multiple markers", () => {
    const raw = "a\n=== CHAPTER ===\nb\n=== CHAPTER ===\nc";
    expect(splitChapterChunks(raw)).toHaveLength(3);
  });

  it("preserves leading / trailing empty chunks for caller to filter", () => {
    const raw = "=== CHAPTER ===\nonly";
    const out = splitChapterChunks(raw);
    expect(out).toHaveLength(2);
    expect(out[0].trim()).toBe("");
  });
});
