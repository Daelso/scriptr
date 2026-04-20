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
