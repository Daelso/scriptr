import type { Bible } from "@/lib/types";

/**
 * Output of decode(): everything we extracted from a .story file before any
 * transformation into Scriptr shapes.
 */
export type ParsedStory = {
  title: string;
  description: string;
  tags: string[];
  textPreview: string;
  contextBlocks: string[];
  lorebookEntries: LorebookEntry[];
  prose: string; // long-string prose joined in first-encounter order, separated by "\n\n"
};

export type LorebookEntry = {
  displayName: string;
  text: string;
  keys: string[];
  category?: string;
};

/**
 * Output of split(): prose cut into per-chapter chunks.
 */
export type ProposedChapter = {
  title: string; // may be empty if split source had no title hint
  body: string;
};

export type SplitSource =
  | "marker" // //// markers (highest confidence)
  | "heading" // Chapter N / Chapter N: Title
  | "scenebreak-fallback" // horizontal rules used as chapter breaks
  | "none"; // single chapter, no split

/**
 * A single story produced by splitting input prose. A multi-story file
 * (separated by `////` story markers) yields multiple of these.
 *
 * Structurally identical to the legacy `SplitResult` type (kept below as a
 * back-compat alias).
 */
export type StorySplit = {
  chapters: ProposedChapter[];
  splitSource: SplitSource;
};

/**
 * Back-compat alias. `SplitResult` used to describe the (single) result of
 * `splitProse(prose)`. It is now identical to `StorySplit` — kept for any
 * imports that still reference the old name.
 */
export type SplitResult = StorySplit;

/**
 * Output of map(): Scriptr-shaped story + bible data ready for the UI to
 * preview and commit. Uses the actual Bible shape from lib/types.ts, not
 * a per-importer shape.
 */
export type ProposedWrite = {
  story: {
    title: string;
    description: string;
    keywords: string[];
  };
  bible: Bible;
};

/**
 * A story chunk plus its mapped Story+Bible proposal. The parse route returns
 * one of these per `////`-separated story chunk (length >= 1).
 */
export type StoryProposal = {
  split: StorySplit;
  proposed: ProposedWrite;
};
