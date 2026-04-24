import type {
  ProposedChapter,
  SplitResult,
  SplitSource,
} from "@/lib/novelai/types";

const MARKER_LINE = /^\s*\/{4,}\s*$/;

export function splitProse(prose: string): SplitResult {
  const lines = prose.split(/\r?\n/);
  const hasMarker = lines.some((l) => MARKER_LINE.test(l));
  if (hasMarker) {
    return splitByMarker(lines);
  }

  const headingSplit = splitByChapterHeading(lines);
  if (headingSplit) return headingSplit;

  const ruleSplit = splitByHorizontalRules(lines);
  if (ruleSplit) return ruleSplit;

  return finalize([{ title: "", body: prose.trim() }], "none");
}

function splitByMarker(lines: string[]): SplitResult {
  const chunks: string[][] = [[]];
  for (const line of lines) {
    if (MARKER_LINE.test(line)) {
      chunks.push([]);
    } else {
      chunks[chunks.length - 1].push(line);
    }
  }
  const chapters: ProposedChapter[] = chunks
    .map((c) => c.join("\n").trim())
    .filter((b) => b.length > 0)
    .map((body) => ({ title: "", body }));
  return finalize(chapters, "marker");
}

// Matches lines like:
//   Chapter 1
//   Chapter 12: The Middle
//   Chapter IV - Moonrise
//   chapter iii — Title
const CHAPTER_HEADING =
  /^\s*chapter\s+([ivxlcdm]+|\d+)(?:\s*[:\-—]\s*(.+?))?\s*$/i;

function splitByChapterHeading(lines: string[]): SplitResult | null {
  // First pass: find all heading line indices and their captured titles.
  const headings: { index: number; title: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(CHAPTER_HEADING);
    if (m) headings.push({ index: i, title: (m[2] ?? "").trim() });
  }
  if (headings.length < 2) return null;

  const chapters: ProposedChapter[] = [];
  for (let h = 0; h < headings.length; h++) {
    const start = headings[h].index + 1;
    const end =
      h + 1 < headings.length ? headings[h + 1].index : lines.length;
    const body = lines.slice(start, end).join("\n").trim();
    chapters.push({ title: headings[h].title, body });
  }

  return finalize(
    chapters.filter((c) => c.body.length > 0 || c.title.length > 0),
    "heading"
  );
}

const RULE_LINE = /^\s*(?:\*\s*\*\s*\*|\*{3,}|-{3,}|_{3,})\s*$/;

function splitByHorizontalRules(lines: string[]): SplitResult | null {
  const ruleIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (RULE_LINE.test(lines[i])) ruleIndices.push(i);
  }
  if (ruleIndices.length < 3) return null;

  const chunks: string[][] = [[]];
  for (let i = 0; i < lines.length; i++) {
    if (ruleIndices.includes(i)) {
      chunks.push([]);
    } else {
      chunks[chunks.length - 1].push(lines[i]);
    }
  }
  const chapters: ProposedChapter[] = chunks
    .map((c) => c.join("\n").trim())
    .filter((b) => b.length > 0)
    .map((body) => ({ title: "", body }));
  return finalize(chapters, "scenebreak-fallback");
}

function finalize(
  chapters: ProposedChapter[],
  splitSource: SplitSource
): SplitResult {
  if (chapters.length === 0) {
    return { chapters: [{ title: "", body: "" }], splitSource: "none" };
  }
  return { chapters, splitSource };
}
