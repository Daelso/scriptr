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

const PREAMBLE_PATTERNS: RegExp[] = [
  /^(sure|here(?:'s| is)|okay|got it|alright|absolutely)[\s,:\-]/i,
  /^(below|this is)\s+(?:the|a|your)\s+(?:chapter|scene|draft|version)/i,
];
const SIGNOFF_PATTERNS: RegExp[] = [
  /^(let me know|hope (?:this|you)|happy to (?:revise|tweak|continue)|feel free to)/i,
  /^(want me to (?:continue|revise|tweak)|shall i continue)/i,
];

function stripChatCruft(input: string, warnings: string[]): string {
  const paragraphs = input.split(/\n\s*\n/);
  if (paragraphs.length === 0) return input;

  const first = paragraphs[0].trim();
  // Strip preamble ONLY if the first paragraph is "obviously chat metadata":
  //  1. Matches a preamble trigger pattern (starts with "Sure, here's…", etc.), AND
  //  2. One of:
  //     a. Ends with `:` or `-` (typical chat lead-in like "Sure, here's chapter 3:"), OR
  //     b. Is a short single sentence (≤60 chars, no internal sentence-end
  //        followed by another capital/quote/opener — i.e. genuinely one utterance).
  //
  // The 60-char ceiling is the key guard against eating novel prose that
  // happens to start with "Sure," — real prose almost always runs longer
  // or contains a sentence break before the paragraph ends.
  const SENTENCE_BREAK = /\.\s+["'\u201C\u2018A-Z]/;
  const looksLikeChatPreamble =
    PREAMBLE_PATTERNS.some((p) => p.test(first)) &&
    (/[:\-]\s*$/.test(first) ||
      (first.length <= 60 && !SENTENCE_BREAK.test(first)));

  if (looksLikeChatPreamble) {
    const removed = paragraphs.shift() ?? "";
    warnings.push(
      `Stripped chat preamble: "${removed.slice(0, 50)}${removed.length > 50 ? "\u2026" : ""}"`
    );
  }

  if (paragraphs.length > 0) {
    const last = paragraphs[paragraphs.length - 1].trim();
    if (last.length <= 200 && SIGNOFF_PATTERNS.some((p) => p.test(last))) {
      const removed = paragraphs.pop() ?? "";
      warnings.push(
        `Stripped chat sign-off: "${removed.slice(0, 50)}${removed.length > 50 ? "\u2026" : ""}"`
      );
    }
  }

  return paragraphs.join("\n\n");
}

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
  if (on.stripChatCruft) {
    text = stripChatCruft(text, warnings);
  }
  // Individual steps filled in by subsequent tasks.
  const sections = on.splitIntoSections ? text.split("\n---\n") : [text];
  return { sections, warnings };
}
