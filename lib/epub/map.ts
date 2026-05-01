import { htmlToMarkdown } from "@/lib/publish/html-to-markdown";
import type { Bible } from "@/lib/types";
import type { PenNameProfile } from "@/lib/config";
import type { ParsedEpub, ProposedWrite, PenNameMatch } from "@/lib/epub/types";

// Exported so Chunk 5's commit route can reuse the same empty-bible shape.
// Single source of truth — never duplicate this elsewhere.
export const EMPTY_BIBLE: Bible = {
  characters: [],
  setting: "",
  pov: "third-limited",
  tone: "",
  styleNotes: "",
  nsfwPreferences: "",
};

function matchPenName(
  creator: string,
  profiles: Record<string, PenNameProfile>
): { authorPenName: string; penNameMatch: PenNameMatch } {
  const trimmed = creator.trim();
  if (!trimmed) return { authorPenName: "", penNameMatch: "none" };
  if (profiles[trimmed]) return { authorPenName: trimmed, penNameMatch: "exact" };
  const lower = trimmed.toLowerCase();
  for (const key of Object.keys(profiles)) {
    if (key.toLowerCase() === lower) {
      return { authorPenName: key, penNameMatch: "case-insensitive" };
    }
  }
  return { authorPenName: "", penNameMatch: "none" };
}

export function mapToProposedWrite(
  parsed: ParsedEpub,
  profiles: Record<string, PenNameProfile>
): ProposedWrite {
  const description = parsed.metadata.description
    ? htmlToMarkdown(parsed.metadata.description).trim()
    : "";
  const keywords = parsed.metadata.subjects
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const { authorPenName, penNameMatch } = matchPenName(parsed.metadata.creator, profiles);

  return {
    story: {
      title: parsed.metadata.title.trim(),
      description,
      keywords,
      authorPenName,
    },
    bible: { ...EMPTY_BIBLE },
    cover: parsed.cover,
    chapters: parsed.chapters,
    penNameMatch,
  };
}
