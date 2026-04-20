import { describe, it, expect } from "vitest";
import { DEFAULT_STYLE, type StyleRules } from "@/lib/style";

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
