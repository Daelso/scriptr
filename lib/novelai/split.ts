import type {
  ProposedChapter,
  StorySplit,
  SplitSource,
} from "@/lib/novelai/types";

/**
 * Line containing a `////` story-split marker.
 *
 * Historically this was used as a *chapter* split inside a single story. As
 * of the multi-story refactor it is a **story** split — one input file with
 * `////` markers produces N separate Scriptr stories.
 */
const MARKER_LINE = /^\s*\/{4,}\s*$/;

/**
 * Split input prose into one or more stories. Each story is itself split into
 * chapters using the priority:
 *
 *   1. `Chapter N` / `Chapter N: Title` headings (>=1 occurrence)
 *   2. Horizontal rules `***` / `* * *` / `---` / `___` (>=1 occurrence)
 *   3. Fallback: single chapter, `splitSource: "none"`
 *
 * Any story chunk that produces zero non-empty chapters is dropped. If the
 * whole input produces zero stories (e.g., empty prose), a single empty
 * story is returned so downstream validation can reject it with a useful
 * error ("at least one chapter required").
 */
export function splitProseIntoStories(prose: string): StorySplit[] {
  const lines = prose.split(/\r?\n/);

  // Cut the lines into story chunks on `////` marker lines.
  const storyChunks: string[][] = [[]];
  for (const line of lines) {
    if (MARKER_LINE.test(line)) {
      storyChunks.push([]);
    } else {
      storyChunks[storyChunks.length - 1].push(line);
    }
  }

  // Drop chunks that are all whitespace.
  const nonEmptyChunks = storyChunks.filter(
    (c) => c.join("\n").trim().length > 0
  );

  const stories: StorySplit[] = [];
  for (const chunk of nonEmptyChunks) {
    const split = splitChunkIntoChapters(chunk);
    if (split.chapters.length === 0) continue;
    stories.push(split);
  }

  if (stories.length === 0) {
    return [{ chapters: [{ title: "", body: "" }], splitSource: "none" }];
  }
  return stories;
}

function splitChunkIntoChapters(lines: string[]): StorySplit {
  const chunkProse = lines.join("\n").trim();

  const headingSplit = splitByChapterHeading(lines);
  if (headingSplit) return headingSplit;

  const ruleSplit = splitByHorizontalRules(lines);
  if (ruleSplit) return ruleSplit;

  return finalize([{ title: "", body: chunkProse }], "none");
}

// Matches lines like:
//   Chapter 1
//   Chapter 12: The Middle
//   Chapter IV - Moonrise
//   chapter iii — Title
const CHAPTER_HEADING =
  /^\s*chapter\s+([ivxlcdm]+|\d+)(?:\s*[:\-—]\s*(.+?))?\s*$/i;

function splitByChapterHeading(lines: string[]): StorySplit | null {
  // First pass: find all heading line indices and their captured titles.
  const headings: { index: number; title: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(CHAPTER_HEADING);
    if (m) headings.push({ index: i, title: (m[2] ?? "").trim() });
  }
  if (headings.length < 1) return null;

  // If the first heading is not at the top, the prose before it is an
  // unnamed first chapter. (Preserves old behavior for files that start
  // with narrative before the first `Chapter N`.)
  const chapters: ProposedChapter[] = [];
  if (headings[0].index > 0) {
    const body = lines.slice(0, headings[0].index).join("\n").trim();
    if (body.length > 0) chapters.push({ title: "", body });
  }

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

function splitByHorizontalRules(lines: string[]): StorySplit | null {
  const ruleIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (RULE_LINE.test(lines[i])) ruleIndices.push(i);
  }
  if (ruleIndices.length < 1) return null;

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
): StorySplit {
  if (chapters.length === 0) {
    return { chapters: [], splitSource: "none" };
  }
  return { chapters, splitSource };
}
