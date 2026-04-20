import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStory } from "@/lib/storage/stories";
import { createImportedChapter, listChapters } from "@/lib/storage/chapters";

describe("createImportedChapter", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "scriptr-chapters-import-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates a chapter with source=imported, sections populated, and appends to order", async () => {
    const story = await createStory(dir, { title: "Book" });
    const chapter = await createImportedChapter(dir, story.slug, {
      title: "The Return",
      sectionContents: ["Scene one prose.", "Scene two prose."],
    });

    expect(chapter.source).toBe("imported");
    expect(chapter.title).toBe("The Return");
    expect(chapter.sections).toHaveLength(2);
    expect(chapter.sections[0].content).toBe("Scene one prose.");
    expect(chapter.sections[1].content).toBe("Scene two prose.");
    expect(chapter.wordCount).toBe(6);

    const chapters = await listChapters(dir, story.slug);
    expect(chapters.map((c) => c.id)).toEqual([chapter.id]);
  });

  it("accepts zero sections (edge) without crashing", async () => {
    const story = await createStory(dir, { title: "Empty" });
    const chapter = await createImportedChapter(dir, story.slug, {
      title: "Stub",
      sectionContents: [],
    });
    expect(chapter.sections).toEqual([]);
    expect(chapter.wordCount).toBe(0);
  });
});
