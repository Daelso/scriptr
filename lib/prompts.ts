import type { Story, Bible, Chapter, Character } from "@/lib/types";
import { formatStyleRules, type StyleRules } from "@/lib/style";

export type ChapterPromptInput = {
  story: Story;
  bible: Bible;
  priorRecaps: { chapterIndex: number; recap: string }[];
  chapter: Chapter;
  includeLastChapterFullText?: boolean;
  lastChapterFullText?: string;
  style: Required<StyleRules>;
};

export type SectionRegenInput = {
  story: Story;
  bible: Bible;
  chapter: Chapter;
  targetSectionId: string;
  regenNote: string;
};

export type RecapPromptInput = {
  story: Story;
  chapter: Chapter;
};

export type PromptPair = { system: string; user: string };

function formatCharacter(c: Character): string {
  const traits = c.traits ? ` Traits: ${c.traits}.` : "";
  return `- ${c.name}: ${c.description}${traits}`;
}

export function formatBible(b: Bible): string {
  const chars = b.characters.length
    ? b.characters.map(formatCharacter).join("\n")
    : "(none)";
  return [
    `Characters:\n${chars}`,
    `Setting: ${b.setting}`,
    `POV: ${b.pov}`,
    `Tone: ${b.tone}`,
    `Style notes: ${b.styleNotes}`,
    `NSFW preferences: ${b.nsfwPreferences}`,
  ].join("\n\n");
}

export function formatBeats(beats: string[]): string {
  if (beats.length === 0) return "(none)";
  return beats.map((b) => `- ${b}`).join("\n");
}

export function formatPriorRecaps(recaps: { chapterIndex: number; recap: string }[]): string {
  if (recaps.length === 0) return "(no prior chapters)";
  return recaps.map((r) => `Ch.${r.chapterIndex} \u2014 ${r.recap}`).join("\n");
}

export function buildChapterPrompt(input: ChapterPromptInput): PromptPair {
  const system =
    `You are a novelist writing the next chapter of "${input.story.title}" by ${input.story.authorPenName || "the author"}. ` +
    `Write in-scene prose. Separate scenes with a line containing exactly '---'.`;

  const bibleBlock = formatBible(input.bible);
  const priorRecapsBlock = formatPriorRecaps(input.priorRecaps);
  const beatsBlock = formatBeats(input.chapter.beats);

  const lastChapterSection =
    input.includeLastChapterFullText && input.lastChapterFullText
      ? `\n\nPrior chapter full text (for continuity):\n${input.lastChapterFullText}`
      : "";

  const summaryBlock = input.chapter.summary ? `Summary: ${input.chapter.summary}\n\n` : "";
  const userPromptBlock = input.chapter.prompt ? `Author guidance: ${input.chapter.prompt}\n\n` : "";
  const targetBlock = input.chapter.targetWords ? `Target length: ~${input.chapter.targetWords} words.\n\n` : "";

  const rulesBlock = formatStyleRules(input.style);
  const rulesSection = rulesBlock ? `\n\n${rulesBlock}` : "";

  const user =
    `# Story bible\n${bibleBlock}\n\n` +
    `# Prior chapter recaps\n${priorRecapsBlock}\n\n` +
    `# Current chapter: ${input.chapter.title}\n${summaryBlock}${userPromptBlock}${targetBlock}` +
    `Beats:\n${beatsBlock}${lastChapterSection}${rulesSection}\n\n` +
    `Write this chapter now. Separate scenes with a line containing exactly '---'.`;

  return { system, user };
}

export function buildSectionRegenPrompt(input: SectionRegenInput): PromptPair {
  const { story, bible, chapter, targetSectionId, regenNote } = input;

  const system =
    `You are rewriting a single scene of "${story.title}". ` +
    `Preserve story continuity. Output only the rewritten scene (no framing, no section headers).`;

  const bibleBlock = formatBible(bible);

  const joined = chapter.sections
    .map((s) => {
      if (s.id === targetSectionId) {
        return `\u27EAREWRITE:${regenNote}\u27EB\n${s.content}\n\u27EA/REWRITE\u27EB`;
      }
      return s.content;
    })
    .join("\n---\n");

  const user =
    `# Story bible\n${bibleBlock}\n\n` +
    `# Chapter: ${chapter.title}\n\n` +
    `# Current scenes (rewrite only the marked one):\n${joined}`;

  return { system, user };
}

export type ContinuePromptInput = {
  story: Story;
  bible: Bible;
  priorRecaps: { chapterIndex: number; recap: string }[];
  /** chapter already truncated to include only sections up to and including the pivot */
  chapter: Chapter;
  regenNote: string;
  style: Required<StyleRules>;
};

/**
 * Builds a prompt for continue mode. The chapter is assumed to have already been
 * truncated so that chapter.sections contains only the sections to continue from.
 * The model is asked to append new prose picking up exactly where the text ends.
 *
 * Design note: sectionId is reused as the continue pivot (same field, different
 * semantics disambiguated by mode). No fromSectionId field was added to GenerateRequest.
 */
export function buildContinuePrompt(input: ContinuePromptInput): PromptPair {
  const system =
    `You are continuing a chapter of "${input.story.title}". ` +
    `Append new prose that picks up exactly where the current text ends. ` +
    `Separate scenes with a line containing exactly '---'.`;

  const bibleBlock = formatBible(input.bible);
  const priorRecapsBlock = formatPriorRecaps(input.priorRecaps);
  const beatsBlock = formatBeats(input.chapter.beats);
  const currentText = input.chapter.sections.map((s) => s.content).join("\n---\n");
  const regenBlock = input.regenNote ? `Regen note: ${input.regenNote}\n\n` : "";

  const rulesBlock = formatStyleRules(input.style);
  const rulesSection = rulesBlock ? `\n\n${rulesBlock}` : "";

  const user =
    `# Story bible\n${bibleBlock}\n\n` +
    `# Prior chapter recaps\n${priorRecapsBlock}\n\n` +
    `# Current chapter: ${input.chapter.title}\n` +
    (input.chapter.summary ? `Summary: ${input.chapter.summary}\n\n` : "") +
    `Beats:\n${beatsBlock}\n\n` +
    `${regenBlock}` +
    `Current text so far:\n${currentText || "(nothing yet)"}${rulesSection}\n\n` +
    `Continue writing. Separate scenes with a line containing exactly '---'.`;

  return { system, user };
}

export function buildRecapPrompt(input: RecapPromptInput): PromptPair {
  const system =
    `You write tight 2\u20133 sentence recaps for a novel-in-progress. ` +
    `The recap will be used to give continuity context for the next chapter. ` +
    `Focus on plot and character development \u2014 not prose style.`;

  const body = input.chapter.sections.map((s) => s.content).join("\n\n");

  const user =
    `Summarize the following chapter ("${input.chapter.title}") in 2\u20133 sentences:\n\n${body}`;

  return { system, user };
}
