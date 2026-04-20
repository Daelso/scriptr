import type { Config } from "@/lib/config";
import type { Bible } from "@/lib/types";

export type StyleRules = {
  useContractions?: boolean;
  noEmDashes?: boolean;
  noSemicolons?: boolean;
  noNotXButY?: boolean;
  noRhetoricalQuestions?: boolean;
  sensoryGrounding?: boolean;
  tense?: "past" | "present";
  explicitness?: "fade" | "suggestive" | "explicit" | "graphic";
  dialogueTags?: "prefer-said" | "vary";
  customRules?: string;
};

export const DEFAULT_STYLE: Required<StyleRules> = {
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
};

function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj) as [keyof T, T[keyof T]][]) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Resolve style rules across three layers (low → high precedence):
 *   built-ins → config.styleDefaults → bible.styleOverrides
 *
 * Invariants:
 *   - undefined on a higher layer does NOT clobber lower-layer values.
 *   - customRules concatenates rather than replaces — both layers' text
 *     contribute, joined with a single newline.
 */
export function resolveStyleRules(
  config: Config,
  bible: Bible,
): Required<StyleRules> {
  const globals = config.styleDefaults ?? {};
  const story = bible.styleOverrides ?? {};

  const merged: Required<StyleRules> = {
    ...DEFAULT_STYLE,
    ...stripUndefined(globals),
    ...stripUndefined(story),
  };

  // customRules is the one field that concatenates rather than replaces.
  const parts = [globals.customRules, story.customRules]
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0);
  merged.customRules = parts.join("\n");

  return merged;
}
