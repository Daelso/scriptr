import { describe, it, expect, vi } from "vitest";
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
      "consentBeats",
      "adultsOnly",
      "bodiesDirectlyNamed",
      "rampArousal",
      "interiorPOVInSex",
      "noSuddenly",
      "dialogueDuringSex",
      "kinksAsLived",
      "mandatoryAftermath",
      "noBeganTo",
      "noWeatherMirror",
      "onePOVPerScene",
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
      consentBeats: true,
      adultsOnly: true,
      bodiesDirectlyNamed: true,
      rampArousal: true,
      interiorPOVInSex: true,
      noSuddenly: true,
      dialogueDuringSex: true,
      kinksAsLived: true,
      mandatoryAftermath: true,
      noBeganTo: false,
      noWeatherMirror: false,
      onePOVPerScene: false,
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

import { formatStyleRules } from "@/lib/style";

describe("formatStyleRules", () => {
  it("returns empty string only when no rule emits a line", () => {
    // In practice tense and explicitness are always known-valid and always emit,
    // so this is a synthetic edge case — we feed invalid enum literals to exercise
    // the "nothing to emit" code path. Real usage never hits this.
    const rules = {
      useContractions: false,
      noEmDashes: false,
      noSemicolons: false,
      noNotXButY: false,
      noRhetoricalQuestions: false,
      sensoryGrounding: false,
      consentBeats: false,
      adultsOnly: false,
      bodiesDirectlyNamed: false,
      rampArousal: false,
      interiorPOVInSex: false,
      noSuddenly: false,
      dialogueDuringSex: false,
      kinksAsLived: false,
      mandatoryAftermath: false,
      noBeganTo: false,
      noWeatherMirror: false,
      onePOVPerScene: false,
      tense: "unknown",
      explicitness: "unknown",
      dialogueTags: "vary",
      customRules: "",
    } as unknown as Required<StyleRules>;
    expect(formatStyleRules(rules)).toBe("");
  });

  it("with DEFAULT_STYLE the block is non-empty (baseline emits tense+explicitness+dialogueTags)", () => {
    // Real-world sanity check: the baseline built-in set always emits something.
    expect(formatStyleRules(DEFAULT_STYLE)).toMatch(/^# Style rules$/m);
  });

  it("emits each boolean toggle exactly when it is on", () => {
    const rules = {
      ...DEFAULT_STYLE,
      useContractions: true,
      noEmDashes: true,
      noSemicolons: true,
      noNotXButY: true,
      noRhetoricalQuestions: true,
      sensoryGrounding: true,
      tense: "past",
      explicitness: "explicit",
      dialogueTags: "prefer-said",
      customRules: "",
    } as const;
    const out = formatStyleRules(rules);
    expect(out).toMatch(/^# Style rules$/m);
    expect(out).toMatch(/Use contractions/);
    expect(out).toMatch(/Do not use em-dashes/);
    expect(out).toMatch(/Do not use semicolons/);
    expect(out).toMatch(/Avoid "it wasn't X, it was Y"/);
    expect(out).toMatch(/Avoid rhetorical questions/);
    expect(out).toMatch(/Favor concrete sensory detail/);
    expect(out).toMatch(/Write in past tense/);
    expect(out).toMatch(/Explicitness: explicit/);
    expect(out).toMatch(/Prefer "said" as the default dialogue tag/);
  });

  it("numbers rules contiguously with no gaps when toggles are off", () => {
    const rules: Required<StyleRules> = {
      ...DEFAULT_STYLE,
      useContractions: true,
      noEmDashes: false, // skipped
      noSemicolons: false,
      noNotXButY: true,
      noRhetoricalQuestions: false,
      sensoryGrounding: false,
      consentBeats: false,
      adultsOnly: false,
      bodiesDirectlyNamed: false,
      rampArousal: false,
      interiorPOVInSex: false,
      noSuddenly: false,
      dialogueDuringSex: false,
      kinksAsLived: false,
      mandatoryAftermath: false,
      tense: "past",
      explicitness: "explicit",
      dialogueTags: "vary", // skipped
      customRules: "",
    };
    const out = formatStyleRules(rules);
    const numbered = out
      .split("\n")
      .filter((l) => /^\d+\./.test(l))
      .map((l) => parseInt(l.match(/^(\d+)/)![1], 10));
    // No gaps
    for (let i = 0; i < numbered.length; i++) {
      expect(numbered[i]).toBe(i + 1);
    }
  });

  it("emits each erotica craft rule when its toggle is on", () => {
    const out = formatStyleRules({ ...DEFAULT_STYLE });
    expect(out).toMatch(/Every sexual act shows active, enthusiastic participation/);
    expect(out).toMatch(/All sexual participants are adults/);
    expect(out).toMatch(/name body parts directly/);
    expect(out).toMatch(/Stage arousal across at least three beats/);
    expect(out).toMatch(/Narrate sex from inside the viewpoint character/);
    expect(out).toMatch(/Never use "suddenly"/);
    expect(out).toMatch(/Characters speak during sex/);
    expect(out).toMatch(/Write kinks and specific acts as lived experience/);
    expect(out).toMatch(/Every sex scene ends with connective tissue/);
  });

  it("omits each erotica craft rule when its toggle is off", () => {
    const off: Required<StyleRules> = {
      ...DEFAULT_STYLE,
      consentBeats: false,
      adultsOnly: false,
      bodiesDirectlyNamed: false,
      rampArousal: false,
      interiorPOVInSex: false,
      noSuddenly: false,
      dialogueDuringSex: false,
      kinksAsLived: false,
      mandatoryAftermath: false,
    };
    const out = formatStyleRules(off);
    expect(out).not.toMatch(/enthusiastic participation/);
    expect(out).not.toMatch(/All sexual participants are adults/);
    expect(out).not.toMatch(/name body parts directly/);
    expect(out).not.toMatch(/three beats before escalation/);
    expect(out).not.toMatch(/inside the viewpoint character/);
    expect(out).not.toMatch(/Never use "suddenly"/);
    expect(out).not.toMatch(/Characters speak during sex/);
    expect(out).not.toMatch(/lived experience/);
    expect(out).not.toMatch(/connective tissue/);
  });

  it("opt-in polish rules are off by default and emit only when toggled on", () => {
    const baseline = formatStyleRules(DEFAULT_STYLE);
    expect(baseline).not.toMatch(/began to X/);
    expect(baseline).not.toMatch(/weather or natural imagery/);
    expect(baseline).not.toMatch(/Head-hopping/);

    const on = formatStyleRules({
      ...DEFAULT_STYLE,
      noBeganTo: true,
      noWeatherMirror: true,
      onePOVPerScene: true,
    });
    expect(on).toMatch(/Avoid "began to X"/);
    expect(on).toMatch(/weather or natural imagery/);
    expect(on).toMatch(/Head-hopping/);
  });

  it("renders every tense value distinctly", () => {
    expect(formatStyleRules({ ...DEFAULT_STYLE, tense: "past" })).toMatch(/past tense/);
    expect(formatStyleRules({ ...DEFAULT_STYLE, tense: "present" })).toMatch(/present tense/);
  });

  it("renders every explicitness tier distinctly", () => {
    expect(formatStyleRules({ ...DEFAULT_STYLE, explicitness: "fade" })).toMatch(
      /fade-to-black/,
    );
    expect(formatStyleRules({ ...DEFAULT_STYLE, explicitness: "suggestive" })).toMatch(
      /suggestive/,
    );
    expect(formatStyleRules({ ...DEFAULT_STYLE, explicitness: "explicit" })).toMatch(
      /Explicitness: explicit/,
    );
    expect(formatStyleRules({ ...DEFAULT_STYLE, explicitness: "graphic" })).toMatch(
      /graphic/,
    );
  });

  it("dialogueTags: 'vary' produces NO dialogue-tag line", () => {
    const out = formatStyleRules({ ...DEFAULT_STYLE, dialogueTags: "vary" });
    expect(out).not.toMatch(/dialogue tag/i);
    expect(out).not.toMatch(/\"said\"/);
  });

  it("appends customRules verbatim under an 'Additional rules:' header", () => {
    const out = formatStyleRules({
      ...DEFAULT_STYLE,
      customRules: "never start a paragraph with 'Meanwhile'",
    });
    expect(out).toMatch(/Additional rules:\nnever start a paragraph with 'Meanwhile'/);
  });

  it("omits customRules when it is whitespace-only", () => {
    const out = formatStyleRules({ ...DEFAULT_STYLE, customRules: "   \n  " });
    expect(out).not.toMatch(/Additional rules/);
  });

  it("unknown tense value omits the tense line (graceful) and warns", () => {
    // Simulates a hand-edited config.json with an invalid enum value
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rules = { ...DEFAULT_STYLE, tense: "fugue" } as unknown as Required<StyleRules>;
    const out = formatStyleRules(rules);
    expect(out).not.toMatch(/tense/i);
    expect(warnSpy).toHaveBeenCalledWith(
      "[warn]",
      expect.stringContaining("unknown tense"),
    );
    warnSpy.mockRestore();
  });

  it("unknown explicitness value omits the explicitness line (graceful) and warns", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rules = {
      ...DEFAULT_STYLE,
      explicitness: "cosmic",
    } as unknown as Required<StyleRules>;
    const out = formatStyleRules(rules);
    expect(out).not.toMatch(/Explicitness/);
    expect(warnSpy).toHaveBeenCalledWith(
      "[warn]",
      expect.stringContaining("unknown explicitness"),
    );
    warnSpy.mockRestore();
  });
});
