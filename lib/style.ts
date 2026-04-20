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

export function formatStyleRules(rules: Required<StyleRules>): string {
  const lines: string[] = [];

  if (rules.useContractions) {
    lines.push("Use contractions (I'm, don't, won't) in narration and dialogue.");
  }
  if (rules.noEmDashes) {
    lines.push("Do not use em-dashes. Use commas, periods, or parentheses instead.");
  }
  if (rules.noSemicolons) {
    lines.push("Do not use semicolons.");
  }
  if (rules.noNotXButY) {
    lines.push(`Avoid "it wasn't X, it was Y" constructions.`);
  }
  if (rules.noRhetoricalQuestions) {
    lines.push("Avoid rhetorical questions in narration.");
  }
  if (rules.sensoryGrounding) {
    lines.push("Favor concrete sensory detail over abstract emotion statements.");
  }

  switch (rules.tense) {
    case "past":
      lines.push("Write in past tense.");
      break;
    case "present":
      lines.push("Write in present tense.");
      break;
    // unknown values → omit
  }

  switch (rules.explicitness) {
    case "fade":
      lines.push(
        "Explicitness: fade-to-black — suggest intimacy, cut before physical detail.",
      );
      break;
    case "suggestive":
      lines.push(
        "Explicitness: suggestive — evocative but non-graphic; imply rather than describe.",
      );
      break;
    case "explicit":
      lines.push(
        "Explicitness: explicit — detailed physical and sensory description, no censorship or fade-outs.",
      );
      break;
    case "graphic":
      lines.push(
        "Explicitness: graphic — unflinching, anatomically specific, no euphemism.",
      );
      break;
    // unknown values → omit
  }

  if (rules.dialogueTags === "prefer-said") {
    lines.push(
      `Prefer "said" as the default dialogue tag. Vary only when the tag carries information.`,
    );
  }
  // "vary" is the no-op default — emit nothing.

  // Emit all zero-argument toggles first, then customRules addendum if present.
  const trimmedCustom = rules.customRules.trim();

  // Caller-friendly empty case: everything off AND no custom rules.
  if (lines.length === 0 && !trimmedCustom) return "";

  const numbered = lines.map((line, i) => `${i + 1}. ${line}`);

  if (trimmedCustom) {
    numbered.push(`${numbered.length + 1}. Additional rules:\n${trimmedCustom}`);
  }

  return `# Style rules\n${numbered.join("\n")}`;
}
