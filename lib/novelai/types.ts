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

export type SplitResult = {
  chapters: ProposedChapter[];
  splitSource: SplitSource;
};

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
