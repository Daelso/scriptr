import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStory, getStory, updateStory } from "@/lib/storage/stories";
import { createChapter, getChapter, listChapters, updateChapter } from "@/lib/storage/chapters";
import { bibleJson } from "@/lib/storage/paths";
import { saveBible, getBible } from "@/lib/storage/bible";
import {
  assembleChapterPrompt,
  StoryNotFoundError,
  BibleNotFoundError,
  ChapterNotFoundError,
} from "@/lib/prompt-assembly";
import { buildChapterPrompt } from "@/lib/prompts";
import { loadConfig, saveConfig } from "@/lib/config";
import { resolveStyleRules } from "@/lib/style";
import type { Bible } from "@/lib/types";

const SAMPLE_BIBLE: Bible = {
  characters: [{ name: "Alice", description: "curious cat" }],
  setting: "an attic",
  pov: "third-limited",
  tone: "whimsical",
  styleNotes: "short sentences",
  nsfwPreferences: "fade to black",
};

describe("assembleChapterPrompt", () => {
  const originalEnv = process.env;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scriptr-prompt-assembly-"));
    process.env = { ...originalEnv, SCRIPTR_DATA_DIR: tmpDir };
    delete process.env.XAI_API_KEY;
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function seed() {
    const story = await createStory(tmpDir, { title: "Test Story" });
    await saveBible(tmpDir, story.slug, SAMPLE_BIBLE);
    const ch1 = await createChapter(tmpDir, story.slug, {
      title: "Chapter One",
    });
    await updateChapter(tmpDir, story.slug, ch1.id, {
      beats: ["opens with Alice waking"],
    });
    return { story, ch1 };
  }

  it("chapter 1: returns empty priorRecaps, chapterIndex 1", async () => {
    const { story, ch1 } = await seed();
    const result = await assembleChapterPrompt(tmpDir, story.slug, ch1.id);
    expect(result.meta.chapterIndex).toBe(1);
    expect(result.meta.priorRecapCount).toBe(0);
    expect(result.meta.includesLastChapterFullText).toBe(false);
    expect(result.user).toContain("# Story bible");
    expect(result.user).toContain("(no prior chapters)");
  });

  it("chapter 3: priorRecaps contains chapters 1 and 2 with 1-based indexing", async () => {
    const story = await createStory(tmpDir, { title: "Three-Chapter Story" });
    await saveBible(tmpDir, story.slug, SAMPLE_BIBLE);
    const ch1 = await createChapter(tmpDir, story.slug, { title: "Ch1" });
    await updateChapter(tmpDir, story.slug, ch1.id, {
      recap: "Alice wakes and finds a key.",
    });
    const ch2 = await createChapter(tmpDir, story.slug, { title: "Ch2" });
    await updateChapter(tmpDir, story.slug, ch2.id, {
      recap: "She unlocks a mysterious door.",
    });
    const ch3 = await createChapter(tmpDir, story.slug, { title: "Ch3" });

    const result = await assembleChapterPrompt(tmpDir, story.slug, ch3.id);
    expect(result.meta.chapterIndex).toBe(3);
    expect(result.meta.priorRecapCount).toBe(2);
    expect(result.user).toContain("Ch.1 \u2014 Alice wakes and finds a key.");
    expect(result.user).toContain("Ch.2 \u2014 She unlocks a mysterious door.");
    expect(result.user).not.toContain("Ch.3 \u2014");
    expect(ch1.id).toBeTruthy();
    expect(ch2.id).toBeTruthy();
  });

  it("lastChapterFullText: omitted when config.includeLastChapterFullText is false (default)", async () => {
    const { story } = await seed();
    const ch2 = await createChapter(tmpDir, story.slug, { title: "Ch2" });
    const result = await assembleChapterPrompt(tmpDir, story.slug, ch2.id);
    expect(result.meta.includesLastChapterFullText).toBe(false);
    expect(result.user).not.toContain("Prior chapter full text (for continuity):");
  });

  it("lastChapterFullText: included when config.includeLastChapterFullText is true", async () => {
    const story = await createStory(tmpDir, { title: "With Last Chapter" });
    await saveBible(tmpDir, story.slug, SAMPLE_BIBLE);
    const ch1 = await createChapter(tmpDir, story.slug, { title: "Ch1" });
    await updateChapter(tmpDir, story.slug, ch1.id, {
      sections: [{ id: "s1", content: "Once upon a time." }],
    });
    const ch2 = await createChapter(tmpDir, story.slug, { title: "Ch2" });
    await saveConfig(tmpDir, { includeLastChapterFullText: true });

    const result = await assembleChapterPrompt(tmpDir, story.slug, ch2.id);
    expect(result.meta.includesLastChapterFullText).toBe(true);
    expect(result.user).toContain("Prior chapter full text (for continuity):");
    expect(result.user).toContain("Once upon a time.");
    expect(ch1.id).toBeTruthy();
  });

  it("meta.model: falls back to config.defaultModel when story has no override", async () => {
    const { story, ch1 } = await seed();
    const config = await loadConfig(tmpDir);
    const result = await assembleChapterPrompt(tmpDir, story.slug, ch1.id);
    expect(result.meta.model).toBe(config.defaultModel);
  });

  it("meta.model: uses story.modelOverride when present", async () => {
    const { story, ch1 } = await seed();
    await updateStory(tmpDir, story.slug, { modelOverride: "grok-4-fast-reasoning" });
    const result = await assembleChapterPrompt(tmpDir, story.slug, ch1.id);
    expect(result.meta.model).toBe("grok-4-fast-reasoning");
  });

  it("throws StoryNotFoundError when slug unknown", async () => {
    await expect(
      assembleChapterPrompt(tmpDir, "nonexistent-slug", "whatever"),
    ).rejects.toThrow(StoryNotFoundError);
  });

  it("throws BibleNotFoundError when bible.json missing", async () => {
    // createStory always writes a default bible.json; remove it to simulate absence.
    const story = await createStory(tmpDir, { title: "Bible-less" });
    const ch1 = await createChapter(tmpDir, story.slug, { title: "Ch1" });
    await unlink(bibleJson(tmpDir, story.slug));
    await expect(
      assembleChapterPrompt(tmpDir, story.slug, ch1.id),
    ).rejects.toThrow(BibleNotFoundError);
  });

  it("throws ChapterNotFoundError when chapter id unknown", async () => {
    const { story } = await seed();
    await expect(
      assembleChapterPrompt(tmpDir, story.slug, "nonexistent-chapter-id"),
    ).rejects.toThrow(ChapterNotFoundError);
  });

  it("byte-for-byte: helper output matches direct buildChapterPrompt call with same inputs", async () => {
    const story = await createStory(tmpDir, { title: "Guardrail Story" });
    await saveBible(tmpDir, story.slug, SAMPLE_BIBLE);
    const ch1 = await createChapter(tmpDir, story.slug, { title: "Ch1" });
    await updateChapter(tmpDir, story.slug, ch1.id, { recap: "Alice wakes." });
    const ch2 = await createChapter(tmpDir, story.slug, { title: "Ch2" });
    await updateChapter(tmpDir, story.slug, ch2.id, {
      beats: ["She finds a key", "She unlocks a door"],
    });

    const viaHelper = await assembleChapterPrompt(tmpDir, story.slug, ch2.id);

    const config = await loadConfig(tmpDir);
    const s = await getStory(tmpDir, story.slug);
    const b = await getBible(tmpDir, story.slug);
    const c = await getChapter(tmpDir, story.slug, ch2.id);
    const all = await listChapters(tmpDir, story.slug);
    const idx = all.findIndex((x) => x.id === c!.id);
    const priorRecaps = all
      .slice(0, idx)
      .map((cc, i) => ({ chapterIndex: i + 1, recap: cc.recap }));
    const lastText =
      config.includeLastChapterFullText && idx > 0
        ? all[idx - 1].sections.map((ss) => ss.content).join("\n---\n")
        : undefined;
    const direct = buildChapterPrompt({
      story: s!,
      bible: b!,
      priorRecaps,
      chapter: c!,
      includeLastChapterFullText: config.includeLastChapterFullText,
      lastChapterFullText: lastText,
      style: resolveStyleRules(config, b!),
    });

    expect(viaHelper.system).toBe(direct.system);
    expect(viaHelper.user).toBe(direct.user);
    expect(ch1.id).toBeTruthy();
  });
});
