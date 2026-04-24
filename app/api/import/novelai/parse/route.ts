import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api";
import { decodeNovelAIStory, NovelAIDecodeError } from "@/lib/novelai/decode";
import { splitProseIntoStories } from "@/lib/novelai/split";
import { mapToProposedWrite } from "@/lib/novelai/map";
import { cleanNovelAIText, titleFromFilename } from "@/lib/novelai/text-clean";
import type {
  ParsedStory,
  ProposedWrite,
  StoryProposal,
  StorySplit,
} from "@/lib/novelai/types";

/**
 * Sniff the first 1KB of a buffer to decide if it looks like UTF-8 text
 * rather than a binary/base64-packed `.story` file. NovelAI `.story` files
 * are JSON envelopes whose `content.document` is a long base64 blob — they
 * decode fine as UTF-8 but their bodies are almost entirely base64
 * characters. Plain-text exports, by contrast, contain spaces, newlines, and
 * normal prose. We only use this as a fallback when filename-based sniffing
 * can't decide.
 */
function looksLikeText(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(1024, buf.byteLength));
  let nonPrintable = 0;
  for (const byte of sample) {
    // Allow tab (0x09), LF (0x0A), CR (0x0D), and the full printable ASCII
    // range 0x20-0x7E, plus any high-bit byte (UTF-8 continuation).
    if (
      byte === 0x09 ||
      byte === 0x0a ||
      byte === 0x0d ||
      (byte >= 0x20 && byte <= 0x7e) ||
      byte >= 0x80
    ) {
      continue;
    }
    nonPrintable++;
  }
  // Allow a tiny amount of noise, but anything more means binary.
  return nonPrintable <= 2;
}

/**
 * Build a `ProposedWrite` for a single story chunk.
 *
 * - Story 1 of N (i === 0) reuses the mapped bible + metadata from the whole
 *   file, including description, keywords, and any lorebook-derived bible.
 * - Stories 2..N inherit nothing: empty description, no keywords, empty
 *   bible. The user can fill those in the preview UI per story. Title is
 *   suffixed "Part K" when there are multiple stories.
 */
function buildProposalForStory(
  parsed: ParsedStory,
  base: ProposedWrite,
  index: number,
  totalStories: number
): ProposedWrite {
  const baseTitle = parsed.title || base.story.title;
  if (totalStories === 1) {
    return base;
  }
  const partTitle = baseTitle
    ? `${baseTitle} - Part ${index + 1}`
    : `Part ${index + 1}`;
  if (index === 0) {
    return {
      story: { ...base.story, title: partTitle },
      bible: base.bible,
    };
  }
  return {
    story: { title: partTitle, description: "", keywords: [] },
    bible: {
      characters: [],
      setting: "",
      pov: "third-limited",
      tone: "",
      styleNotes: "",
      nsfwPreferences: "",
    },
  };
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("No file uploaded.", 400);
  }

  const fileEntry = form.get("file");
  if (
    fileEntry === null ||
    typeof fileEntry !== "object" ||
    typeof (fileEntry as { arrayBuffer?: unknown }).arrayBuffer !== "function"
  ) {
    return fail("No file uploaded.", 400);
  }
  const fileLike = fileEntry as {
    arrayBuffer(): Promise<ArrayBuffer>;
    name?: string;
  };

  const filename = typeof fileLike.name === "string" ? fileLike.name : "";
  const buf = Buffer.from(await fileLike.arrayBuffer());
  if (buf.byteLength === 0) {
    return fail("No file uploaded.", 400);
  }

  const isTxtByName = /\.txt$/i.test(filename);
  const isStoryByName = /\.story$/i.test(filename);

  let parsed: ParsedStory;
  if (isTxtByName || (!isStoryByName && looksLikeText(buf))) {
    const raw = buf.toString("utf-8");
    parsed = cleanNovelAIText(raw, { titleFallback: titleFromFilename(filename) });
  } else {
    try {
      parsed = await decodeNovelAIStory(buf);
    } catch (err) {
      if (err instanceof NovelAIDecodeError) return fail(err.userMessage, 400);
      return fail("Could not read the document inside this .story file.", 400);
    }
  }

  const splits: StorySplit[] = splitProseIntoStories(parsed.prose);
  const baseProposed = mapToProposedWrite(parsed);

  const stories: StoryProposal[] = splits.map((split, i) => ({
    split,
    proposed: buildProposalForStory(parsed, baseProposed, i, splits.length),
  }));

  return ok({ parsed, stories });
}
