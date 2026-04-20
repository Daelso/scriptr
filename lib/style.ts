import type { Config } from "@/lib/config";
import type { Bible } from "@/lib/types";
import { logger } from "@/lib/logger";

export type StyleRules = {
  useContractions?: boolean;
  noEmDashes?: boolean;
  noSemicolons?: boolean;
  noNotXButY?: boolean;
  noRhetoricalQuestions?: boolean;
  sensoryGrounding?: boolean;
  // Erotica craft & ethics
  consentBeats?: boolean;
  adultsOnly?: boolean;
  bodiesDirectlyNamed?: boolean;
  rampArousal?: boolean;
  interiorPOVInSex?: boolean;
  noSuddenly?: boolean;
  dialogueDuringSex?: boolean;
  kinksAsLived?: boolean;
  mandatoryAftermath?: boolean;
  // Prose polish (opt-in)
  noBeganTo?: boolean;
  noWeatherMirror?: boolean;
  onePOVPerScene?: boolean;
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

  if (rules.consentBeats) {
    lines.push(
      "Every sexual act shows active, enthusiastic participation — a look, a nod, a pulled-closer. Weave consent into the prose as beats, not as a disclaimer.",
    );
  }
  if (rules.adultsOnly) {
    lines.push(
      "All sexual participants are adults. Never age down a character during intimate scenes. Never use terms that imply minors (schoolgirl, barely legal, etc.) even in role-play.",
    );
  }
  if (rules.bodiesDirectlyNamed) {
    lines.push(
      `During sex, name body parts directly (cock, clit, nipples). Avoid purple euphemism ("his manhood", "her sex") and clinical register ("glans", "perineum").`,
    );
  }
  if (rules.rampArousal) {
    lines.push(
      `Stage arousal across at least three beats before escalation: tension, hesitation, caught breath, first deliberate touch. Do not jump from a kiss to "soaking wet" or "rock hard".`,
    );
  }
  if (rules.interiorPOVInSex) {
    lines.push(
      "Narrate sex from inside the viewpoint character — felt sensation, noticed detail, intrusive thought — not as camera-angle description of limb positions.",
    );
  }
  if (rules.noSuddenly) {
    lines.push(
      `Never use "suddenly", "just then", or "as if on cue". Let cause and effect show through action and reaction.`,
    );
  }
  if (rules.dialogueDuringSex) {
    lines.push(
      "Characters speak during sex — interrupted, whispered, asked rather than demanded. Avoid porn-script clichés and avoid total silence.",
    );
  }
  if (rules.kinksAsLived) {
    lines.push(
      "Write kinks and specific acts as lived experience, not exposition. The narrator never explains what a character's preferences mean; the scene plays them.",
    );
  }
  if (rules.mandatoryAftermath) {
    lines.push(
      "Every sex scene ends with connective tissue — a touch, a word, a private thought — before cutting away. No immediate fade-to-black after orgasm.",
    );
  }
  if (rules.noBeganTo) {
    lines.push(`Avoid "began to X" and "started to X". Prefer the direct verb.`);
  }
  if (rules.noWeatherMirror) {
    lines.push("Do not use weather or natural imagery as a mirror for emotional state.");
  }
  if (rules.onePOVPerScene) {
    lines.push("Do not switch viewpoint mid-scene. Head-hopping is only allowed at scene breaks.");
  }

  switch (rules.tense) {
    case "past":
      lines.push("Write in past tense.");
      break;
    case "present":
      lines.push("Write in present tense.");
      break;
    default:
      logger.warn("formatStyleRules: unknown tense value, omitting line:", rules.tense);
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
    default:
      logger.warn("formatStyleRules: unknown explicitness value, omitting line:", rules.explicitness);
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
