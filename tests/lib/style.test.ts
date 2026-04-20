import { describe, it, expect } from "vitest";
import { DEFAULT_STYLE, type StyleRules, resolveStyleRules } from "@/lib/style";
import type { Config } from "@/lib/config";
import type { Bible } from "@/lib/types";

describe("DEFAULT_STYLE", () => {
  it("has every field populated (no undefined)", () => {
    const keys: (keyof Required<StyleRules>)[] = [
      "useContractions",
      "noEmDashes",
      "noSemicolons",
      "noNotXButY",
      "noRhetoricalQuestions",
      "sensoryGrounding",
      "tense",
      "explicitness",
      "dialogueTags",
      "customRules",
    ];
    for (const k of keys) {
      expect(DEFAULT_STYLE[k]).not.toBeUndefined();
    }
  });

  it("matches the spec's built-in values", () => {
    expect(DEFAULT_STYLE).toEqual({
      useContractions: true,
      noEmDashes: true,
      noSemicolons: false,
      noNotXButY: true,
      noRhetoricalQuestions: true,
      sensoryGrounding: true,
      tense: "past",
      explicitness: "explicit",
      dialogueTags: "prefer-said",
      customRules: "",
    });
  });
});

function cfg(styleDefaults?: StyleRules): Config {
  return {
    defaultModel: "grok-4-latest",
    bindHost: "127.0.0.1",
    bindPort: 3000,
    theme: "system",
    autoRecap: true,
    includeLastChapterFullText: false,
    styleDefaults,
  };
}

function bib(styleOverrides?: StyleRules): Bible {
  return {
    characters: [],
    setting: "",
    pov: "third-limited",
    tone: "",
    styleNotes: "",
    nsfwPreferences: "",
    styleOverrides,
  };
}

describe("resolveStyleRules", () => {
  it("returns built-ins when neither layer sets anything", () => {
    expect(resolveStyleRules(cfg(), bib())).toEqual(DEFAULT_STYLE);
  });

  it("applies globals over built-ins", () => {
    const r = resolveStyleRules(cfg({ tense: "present" }), bib());
    expect(r.tense).toBe("present");
    expect(r.useContractions).toBe(true); // unchanged
  });

  it("applies bible over globals", () => {
    const r = resolveStyleRules(
      cfg({ tense: "present" }),
      bib({ tense: "past" }),
    );
    expect(r.tense).toBe("past");
  });

  it("explicit-undefined in bible does NOT clobber global", () => {
    const r = resolveStyleRules(
      cfg({ tense: "present" }),
      bib({ tense: undefined }),
    );
    expect(r.tense).toBe("present");
  });

  it("concatenates customRules across layers with a newline", () => {
    const r = resolveStyleRules(
      cfg({ customRules: "global rule" }),
      bib({ customRules: "story rule" }),
    );
    expect(r.customRules).toBe("global rule\nstory rule");
  });

  it("customRules: empty bible leaves globals unchanged", () => {
    const r = resolveStyleRules(cfg({ customRules: "global rule" }), bib());
    expect(r.customRules).toBe("global rule");
  });

  it("customRules: empty globals leaves bible unchanged", () => {
    const r = resolveStyleRules(cfg(), bib({ customRules: "story rule" }));
    expect(r.customRules).toBe("story rule");
  });

  it("returns a Required<StyleRules> — no undefined fields", () => {
    const r = resolveStyleRules(cfg(), bib());
    for (const v of Object.values(r)) {
      expect(v).not.toBeUndefined();
    }
  });
});
