import type { ChapterDraft } from "@/lib/epub/types";

const BOILERPLATE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bcopyright\b/i, label: "copyright" },
  { pattern: /\bdedication\b/i, label: "dedication" },
  { pattern: /\backnowledg/i, label: "acknowledgments" },
  { pattern: /\babout the author\b/i, label: "about the author" },
  { pattern: /\balso by\b/i, label: "also by" },
  { pattern: /\btable of contents\b/i, label: "table of contents" },
  { pattern: /\btitle page\b/i, label: "title page" },
  { pattern: /\bother works\b/i, label: "other works" },
  { pattern: /^cover$/i, label: "cover" },
  { pattern: /\bhalftitle\b/i, label: "halftitle" },
  { pattern: /\bfrontmatter\b/i, label: "frontmatter" },
  { pattern: /\bbackmatter\b/i, label: "backmatter" },
  { pattern: /\bimprint\b/i, label: "imprint" },
  { pattern: /\bcolophon\b/i, label: "colophon" },
];

export function applyBoilerplateFlags(chapters: ChapterDraft[]): ChapterDraft[] {
  return chapters.map((ch) => {
    if (ch.skippedByDefault) return ch;
    const title = ch.navTitle.trim();
    for (const { pattern, label } of BOILERPLATE_PATTERNS) {
      if (pattern.test(title)) {
        return {
          ...ch,
          skippedByDefault: true,
          skipReason: `Matched '${label}' rule`,
        };
      }
    }
    return ch;
  });
}
