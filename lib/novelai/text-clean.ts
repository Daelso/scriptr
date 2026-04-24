import type { ParsedStory } from "@/lib/novelai/types";

/**
 * Matches a NovelAI "page" marker line like `[1/3]`, `[12/40]`. Standalone
 * on its own line (whitespace permitted on either side).
 */
const PAGE_MARKER_LINE = /^\s*\[\d+\/\d+\]\s*$/;

/**
 * Global pattern for `[N/M]` markers — used to strip any stragglers that
 * appear inline rather than on their own line (defense in depth).
 */
const PAGE_MARKER_INLINE = /\[\d+\/\d+\]/g;

/**
 * Strips NovelAI `.txt` export artifacts and returns a ParsedStory. All bible-
 * ish fields are empty; only title (from opts.titleFallback) and prose are
 * populated.
 *
 * Artifacts removed:
 *   - Premise header block above the first `[N/M]` marker (entire block).
 *   - All subsequent `[N/M]` marker lines.
 *   - `{ ... }` author's-notes blocks (may span multiple lines).
 *   - Leading/trailing whitespace.
 *   - Runs of 3+ blank lines collapsed to 2.
 *
 * Preserved verbatim:
 *   - `////` chapter-split markers.
 *   - `***` / `---` / `___` horizontal rules.
 *   - `Chapter N` / `Chapter N: Title` headings.
 *   - All prose including short dialogue lines.
 */
export function cleanNovelAIText(
  raw: string,
  opts?: { titleFallback?: string }
): ParsedStory {
  let text = stripPremiseBlock(raw);
  text = stripAuthorsNotes(text);
  text = stripPageMarkers(text);
  text = collapseBlankLines(text);
  text = text.trim();

  return {
    title: opts?.titleFallback ?? "",
    description: "",
    tags: [],
    textPreview: "",
    contextBlocks: [],
    lorebookEntries: [],
    prose: text,
  };
}

/**
 * If there is a `[N/M]` marker anywhere in the document, drop everything up
 * to and including the *first* such line — this throws away the premise /
 * directives block that NovelAI prepends.
 *
 * Fallback: if no `[N/M]` marker is found but the text begins with
 * `Story Premise (fixed canon):`, strip up to and including the first blank
 * line after the premise paragraph ends. We detect "premise paragraph ends"
 * as the first blank line, then include one additional paragraph break's
 * worth of leading whitespace.
 *
 * If neither pattern matches, return the text unchanged.
 */
function stripPremiseBlock(raw: string): string {
  const lines = raw.split(/\r?\n/);
  const firstMarker = lines.findIndex((l) => PAGE_MARKER_LINE.test(l));
  if (firstMarker !== -1) {
    return lines.slice(firstMarker + 1).join("\n");
  }

  // Fallback: Story Premise header
  const trimmedStart = raw.trimStart();
  if (trimmedStart.startsWith("Story Premise (fixed canon):")) {
    // Find the first blank line after the premise block. The premise header
    // and its body may span multiple lines; we treat the first completely
    // empty line as the terminator.
    const idx = lines.findIndex((l, i) => i > 0 && l.trim() === "");
    if (idx !== -1) {
      return lines.slice(idx + 1).join("\n");
    }
    // No blank line found — leave unchanged rather than eat the whole file.
  }
  return raw;
}

/**
 * Remove `{ ... }` blocks. We match greedily across newlines but non-greedy
 * on content so successive blocks are handled independently. NovelAI never
 * nests braces in practice.
 */
function stripAuthorsNotes(text: string): string {
  // `[\s\S]` to span newlines; `*?` for non-greedy.
  return text.replace(/\{[\s\S]*?\}/g, "");
}

/**
 * Drop any remaining `[N/M]` markers anywhere in the document. Standalone
 * lines are replaced with an empty line; inline occurrences are removed.
 */
function stripPageMarkers(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (PAGE_MARKER_LINE.test(line)) {
      out.push("");
    } else {
      out.push(line.replace(PAGE_MARKER_INLINE, ""));
    }
  }
  return out.join("\n");
}

/**
 * Collapse runs of 3+ blank lines to exactly 2 blank lines (i.e. three
 * consecutive `\n` characters).
 */
function collapseBlankLines(text: string): string {
  // Normalize line endings first so the regex is simple.
  const normalized = text.replace(/\r\n/g, "\n");
  return normalized.replace(/\n{4,}/g, "\n\n\n");
}

/**
 * Extract a human-readable title from a NovelAI-style filename.
 *
 *   - Strips `.txt` / `.story` extensions.
 *   - Strips the NovelAI timestamp suffix pattern
 *     ` (YYYY-MM-DDTHH_MM_SS.mmmZ)` that NovelAI appends to exports.
 *   - Trims whitespace.
 */
export function titleFromFilename(filename: string): string {
  let name = filename;
  // Strip extension (case-insensitive).
  name = name.replace(/\.(txt|story)$/i, "");
  // Strip NovelAI timestamp suffix.
  name = name.replace(/\s*\(\d{4}-\d{2}-\d{2}T[\d_]+\.\d+Z\)$/, "");
  return name.trim();
}
