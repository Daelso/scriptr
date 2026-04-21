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

function normalizeSceneBreaks(input: string, warnings: string[]): string {
  const UNMATCHED_WORD = /^[ \t]*={3,}[ \t]*([A-Za-z]+)[ \t]*={3,}[ \t]*$/;
  for (const line of input.split("\n")) {
    const m = line.match(UNMATCHED_WORD);
    if (m && m[1].toLowerCase() !== "chapter") {
      warnings.push(
        `Saw "${line.trim()}" but did not split into chapters; did you mean === CHAPTER ===?`
      );
    }
  }
  const MARKER_LINE = /^\s*(?:\*\s*\*\s*\*|\*{3,}|#|\u2014{3,}|-{3,}|={3,})\s*$/;
  let markersNormalized = 0;
  const lines = input.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (MARKER_LINE.test(line)) {
      if (line.trim() !== "---") markersNormalized++;
      out.push("---");
    } else {
      out.push(line);
    }
  }
  const joined = out.join("\n");
  const blankRunCollapsed = joined.replace(/\n(?:\s*\n){3,}/g, "\n\n---\n\n");
  if (blankRunCollapsed !== joined) markersNormalized++;

  if (markersNormalized > 0) {
    warnings.push(`Normalized ${markersNormalized} scene break marker(s).`);
  }
  return blankRunCollapsed;
}

function collapseBlankLines(input: string): string {
  // Runs of >1 blank line (but less than 3+ that became scene breaks) → 1 blank.
  return input.replace(/\n(?:\s*\n){2,}/g, "\n\n");
}

function preserveMarkdownEmphasis(input: string, enabled: boolean): string {
  if (enabled) return input;
  return input
    .replace(/\*\*([^*\n]+?)\*\*/g, "$1")
    .replace(/\*([^*\n]+?)\*/g, "$1");
}

function normalizeDashes(input: string): string {
  return input
    .split("\n")
    .map((line) => {
      if (line === "---") return line; // preserve our own marker
      return line.replace(/--/g, "\u2014");
    })
    .join("\n");
}

function normalizeQuotes(input: string, warnings: string[]): string {
  let count = 0;

  let out = input.replace(/"/g, (_, offset: number, full: string) => {
    count++;
    const prev = full[offset - 1] ?? "";
    const opening = offset === 0 || /[\s([{\u2014\u2013\-]/.test(prev);
    return opening ? "\u201C" : "\u201D";
  });

  out = out.replace(/'/g, (_, offset: number, full: string) => {
    count++;
    const prev = full[offset - 1] ?? "";
    const next = full[offset + 1] ?? "";
    if (/[A-Za-z]/.test(prev) && /[A-Za-z]/.test(next)) return "\u2019";
    if (offset === 0 || /[\s([{\u2014\u2013\-]/.test(prev)) return "\u2018";
    return "\u2019";
  });

  if (count > 0) warnings.push(`Converted ${count} straight quotes to curly.`);
  return out;
}

// Chapter-break pre-split. Runs BEFORE cleanup — the marker is consumed
// as a chapter delimiter, not fed to normalizeSceneBreaks.
// Matches whole-line `=== CHAPTER ===` with case-insensitive / relaxed whitespace.
const CHAPTER_MARKER = /^[ \t]*={3,}[ \t]*chapter[ \t]*={3,}[ \t]*$/gim;

export function splitChapterChunks(raw: string): string[] {
  return raw.split(CHAPTER_MARKER);
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
  if (on.trimTrailingWhitespace) {
    text = text
      .split("\n")
      .map((line) => line.replace(/[ \t]+$/g, ""))
      .join("\n");
  }
  if (on.collapseInternalSpaces) {
    text = text
      .split("\n")
      .map((line) => line.replace(/ {2,}/g, " "))
      .join("\n");
  }
  if (on.normalizeQuotes) {
    text = normalizeQuotes(text, warnings);
  }
  if (on.normalizeSceneBreaks) {
    text = normalizeSceneBreaks(text, warnings);
  }
  if (on.normalizeDashes) {
    text = normalizeDashes(text);
  }
  // "on" is a no-op; "off" strips markers.
  text = preserveMarkdownEmphasis(text, on.preserveMarkdownEmphasis);
  if (on.collapseBlankLines) {
    text = collapseBlankLines(text);
  }
  // Individual steps filled in by subsequent tasks.
  const sections = on.splitIntoSections
    ? text
        .split(/(?:^|\n)---(?:\n|$)/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : [text];
  return { sections, warnings };
}
