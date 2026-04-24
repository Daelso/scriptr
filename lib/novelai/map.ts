import type { Bible, Character } from "@/lib/types";
import type { LorebookEntry, ParsedStory, ProposedWrite } from "@/lib/novelai/types";

type Classification = "character" | "place" | "ambiguous";

const PERSON_CATEGORY = /person|character|people/i;
const PLACE_CATEGORY = /place|location|setting/i;
const PRONOUN_CUE = /\b(?:he|she|they|his|her|their)\b/i;
const PLACE_CUE =
  /\bis\s+an?\s+[^.]*\b(city|town|village|room|house|building|campus|dorm|forest|garden|castle|mountain|river|street|neighborhood|district|planet|realm)\b/i;

function classify(entry: LorebookEntry): Classification {
  if (entry.category) {
    if (PERSON_CATEGORY.test(entry.category)) return "character";
    if (PLACE_CATEGORY.test(entry.category)) return "place";
  }
  // Use first sentence of text for heuristics. Strip to reduce noise.
  const firstSentence = entry.text.split(/(?<=\.)\s+/)[0] ?? "";
  if (PLACE_CUE.test(firstSentence)) return "place";
  if (PRONOUN_CUE.test(firstSentence)) return "character";
  return "ambiguous";
}

function nameFor(entry: LorebookEntry): string {
  if (entry.displayName) return entry.displayName;
  if (entry.keys.length > 0) return entry.keys[0];
  return "";
}

export function mapToProposedWrite(parsed: ParsedStory): ProposedWrite {
  const description = parsed.description || parsed.textPreview;
  const keywords = parsed.tags;

  const characters: Character[] = [];
  const placeBlocks: string[] = [];

  for (const entry of parsed.lorebookEntries) {
    const name = nameFor(entry);
    if (!name && !entry.text) continue;
    const kind = classify(entry);
    if (kind === "place") {
      const header = name ? `## ${name}` : "## (unnamed)";
      placeBlocks.push(`${header}\n${entry.text}`.trim());
    } else {
      // character or ambiguous (default to character)
      characters.push({
        name,
        description: entry.text,
      });
    }
  }

  const bible: Bible = {
    characters,
    setting: placeBlocks.join("\n\n"),
    pov: "third-limited",
    tone: "",
    styleNotes: parsed.contextBlocks.join("\n\n---\n\n"),
    nsfwPreferences: "",
  };

  return {
    story: {
      title: parsed.title,
      description,
      keywords,
    },
    bible,
  };
}
