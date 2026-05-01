import type { Bible } from "@/lib/types";

/**
 * Output of parseEpub(): everything we extracted from a .epub file before any
 * transformation into Scriptr shapes.
 */
export type ParsedEpub = {
  metadata: {
    title: string;
    creator: string;
    description: string;
    subjects: string[];
    language: string;
  };
  cover: { mimeType: string; bytes: Uint8Array } | null;
  chapters: ChapterDraft[];
  epubVersion: 2 | 3;
};

/**
 * One chapter as walked from the nav (or spine fallback). Body is markdown
 * (output of htmlToMarkdown). Carries the boilerplate-denylist verdict so
 * the UI can default-skip without the server filtering them out.
 *
 * NOTE: `source` is a plan-level addition not in the spec's ChapterDraft.
 * It backs the UI's `nav`/`spine` badge requirement (spec UI section). The
 * field is filled by walk.ts based on which code path produced the chapter.
 */
export type ChapterDraft = {
  navTitle: string;
  body: string;
  wordCount: number;
  sourceHref: string;
  skippedByDefault: boolean;
  skipReason?: string;
  /** "nav" when produced from nav.xhtml/toc.ncx; "spine" when nav was empty/missing. */
  source: "nav" | "spine";
};

/**
 * One nav entry as resolved from nav.xhtml or toc.ncx. Hrefs are split into
 * file (relative to the OPF dir) + optional anchor.
 */
export type NavEntry = {
  title: string;
  file: string;
  anchor?: string;
};

/**
 * Result of pen-name auto-match against the user's saved profiles.
 *
 * - "exact": metadata.creator equals a profile key.
 * - "case-insensitive": equals a profile key case-insensitively (UI uses the
 *   profile's canonical casing).
 * - "none": no match.
 */
export type PenNameMatch = "exact" | "case-insensitive" | "none";

/**
 * Output of mapToProposedWrite(): Scriptr-shaped story + bible data ready for
 * the UI to preview and commit. Uses the actual Bible shape from lib/types.ts.
 */
export type ProposedWrite = {
  story: {
    title: string;
    description: string;
    keywords: string[];
    authorPenName: string;
  };
  bible: Bible;
  cover: { mimeType: string; bytes: Uint8Array } | null;
  chapters: ChapterDraft[];
  penNameMatch: PenNameMatch;
};

/**
 * Tagged error class. parse.ts and its dependencies throw this; the API route
 * unwraps `userMessage` for a clean 400 response.
 */
export class EpubParseError extends Error {
  readonly userMessage: string;
  constructor(userMessage: string) {
    super(userMessage);
    this.name = "EpubParseError";
    this.userMessage = userMessage;
  }
}
