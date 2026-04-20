export type CleanupStep =
  | "normalizeLineEndings"
  | "stripChatCruft"
  | "trimTrailingWhitespace"
  | "collapseInternalSpaces"
  | "normalizeQuotes"
  | "normalizeSceneBreaks"
  | "normalizeDashes"
  | "preserveMarkdownEmphasis"
  | "collapseBlankLines"
  | "splitIntoSections";

export type CleanupOptions = Partial<Record<CleanupStep, boolean>>;

export type CleanResult = {
  sections: string[];
  warnings: string[];
};

const DEFAULTS: Required<CleanupOptions> = {
  normalizeLineEndings: true,
  stripChatCruft: true,
  trimTrailingWhitespace: true,
  collapseInternalSpaces: true,
  normalizeQuotes: true,
  normalizeSceneBreaks: true,
  normalizeDashes: true,
  preserveMarkdownEmphasis: true,
  collapseBlankLines: true,
  splitIntoSections: true,
};

export function cleanPaste(raw: string, opts?: CleanupOptions): CleanResult {
  const on = { ...DEFAULTS, ...(opts ?? {}) };
  const warnings: string[] = [];
  let text = raw;
  if (on.normalizeLineEndings) {
    text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }
  // Individual steps filled in by subsequent tasks.
  const sections = on.splitIntoSections ? text.split("\n---\n") : [text];
  return { sections, warnings };
}
