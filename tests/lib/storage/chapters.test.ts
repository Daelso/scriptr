import { describe, it, expect } from "vitest";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStory, getStory } from "@/lib/storage/stories";
import { chaptersDir } from "@/lib/storage/paths";
import {
  createChapter,
  listChapters,
  getChapter,
  updateChapter,
  deleteChapter,
  reorderChapters,
} from "@/lib/storage/chapters";

async function withTemp(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "scriptr-chapters-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("createChapter", () => {
  it("creates a chapter with defaults and appends its id to chapterOrder", async () => {
    await withTemp(async (dir) => {
      const story = await createStory(dir, { title: "My Story" });
      const chapter = await createChapter(dir, story.slug, { title: "Chapter One" });

      expect(chapter.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(chapter.title).toBe("Chapter One");
      expect(chapter.summary).toBe("");
      expect(chapter.beats).toEqual([]);
      expect(chapter.prompt).toBe("");
      expect(chapter.recap).toBe("");
      expect(chapter.sections).toEqual([]);
      expect(chapter.wordCount).toBe(0);
      expect(chapter.targetWords).toBeUndefined();

      const updated = await getStory(dir, story.slug);
      expect(updated!.chapterOrder).toEqual([chapter.id]);
    });
  });

  it("accepts optional summary", async () => {
    await withTemp(async (dir) => {
      const story = await createStory(dir, { title: "My Story" });
      const chapter = await createChapter(dir, story.slug, {
        title: "Chapter One",
        summary: "A brief overview",
      });
      expect(chapter.summary).toBe("A brief overview");
    });
  });

  it("writes chapter file as chapters/001-<slug>.json", async () => {
    await withTemp(async (dir) => {
      const story = await createStory(dir, { title: "My Story" });
      await createChapter(dir, story.slug, { title: "My Title" });

      const files = await readdir(chaptersDir(dir, story.slug));
      expect(files).toEqual(["001-my-title.json"]);
    });
  });

  it("appends subsequent chapters at end of chapterOrder with correct ordinal prefix", async () => {
    await withTemp(async (dir) => {
      const story = await createStory(dir, { title: "My Story" });
      const ch1 = await createChapter(dir, story.slug, { title: "Alpha" });
      const ch2 = await createChapter(dir, story.slug, { title: "Bravo" });
      const ch3 = await createChapter(dir, story.slug, { title: "Charlie" });

      const updated = await getStory(dir, story.slug);
      expect(updated!.chapterOrder).toEqual([ch1.id, ch2.id, ch3.id]);

      const files = (await readdir(chaptersDir(dir, story.slug))).sort();
      expect(files).toEqual(["001-alpha.json", "002-bravo.json", "003-charlie.json"]);
    });
  });

  it("bumps story.json updatedAt", async () => {
    await withTemp(async (dir) => {
      const story = await createStory(dir, { title: "My Story" });
      const originalUpdatedAt = story.updatedAt;
      await new Promise((r) => setTimeout(r, 10));

      await createChapter(dir, story.slug, { title: "Chapter One" });

      const updated = await getStory(dir, story.slug);
      expect(updated!.updatedAt).not.toBe(originalUpdatedAt);
    });
  });
});

describe("listChapters", () => {
  it("returns empty array when no chapters exist", async () => {
    await withTemp(async (dir) => {
      const story = await createStory(dir, { title: "My Story" });
      const chapters = await listChapters(dir, story.slug);
      expect(chapters).toEqual([]);
    });
  });

  it("returns chapters in chapterOrder order, not filesystem order", async () => {
    await withTemp(async (dir) => {
      const story = await createStory(dir, { title: "My Story" });
      const ch1 = await createChapter(dir, story.slug, { title: "Alpha" });
      const ch2 = await createChapter(dir, story.slug, { title: "Bravo" });
      const ch3 = await createChapter(dir, story.slug, { title: "Charlie" });

      // reorder so filesystem order != chapterOrder
      await reorderChapters(dir, story.slug, [ch3.id, ch1.id, ch2.id]);

      const chapters = await listChapters(dir, story.slug);
      expect(chapters.map((c) => c.id)).toEqual([ch3.id, ch1.id, ch2.id]);
    });
  });

  it("ignores orphan files (id not in chapterOrder) without deleting them", async () => {
    await withTemp(async (dir) => {
      const story = await createStory(dir, { title: "My Story" });
      const ch1 = await createChapter(dir, story.slug, { title: "Alpha" });
      await createChapter(dir, story.slug, { title: "Bravo" });

      // Manually remove ch2 from chapterOrder without deleting its file (simulate orphan)
      await getStory(dir, story.slug);
      const { updateStory } = await import("@/lib/storage/stories");
      await updateStory(dir, story.slug, { chapterOrder: [ch1.id] });

      const chapters = await listChapters(dir, story.slug);
      expect(chapters).toHaveLength(1);
      expect(chapters[0].id).toBe(ch1.id);

      // Orphan file still exists on disk
      const files = await readdir(chaptersDir(dir, story.slug));
      expect(files).toHaveLength(2);
    });
  });

  it("returns null for nonexistent story", async () => {
    await withTemp(async (dir) => {
      const chapters = await listChapters(dir, "nonexistent-story");
      expect(chapters).toEqual([]);
    });
  });
});

describe("getChapter", () => {
  it("returns the chapter for an existing id", async () => {
    await withTemp(async (dir) => {
      const story = await createStory(dir, { title: "My Story" });
      const created = await createChapter(dir, story.slug, { title: "Chapter One" });

      const found = await getChapter(dir, story.slug, created.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.title).toBe("Chapter One");
    });
  });

  it("returns null for a missing chapter id", async () => {
    await withTemp(async (dir) => {
      const story = await createStory(dir, { title: "My Story" });
      const result = await getChapter(dir, story.slug, "nonexistent-id");
      expect(result).toBeNull();
    });
  });

  it("returns null when story is missing", async () => {
    await withTemp(async (dir) => {
      const result = await getChapter(dir, "nonexistent-story", "some-id");
      expect(result).toBeNull();
    });
  });
});

describe("updateChapter", () => {
  it("patches fields and persists them", async () => {
    await withTemp(async (dir) => {
      const story = await createStory(dir, { title: "My Story" });
      const created = await createChapter(dir, story.slug, { title: "Original Title" });

      const updated = await updateChapter(dir, story.slug, created.id, {
        title: "Updated Title",
        summary: "A new summary",
        beats: ["beat one", "beat two"],
      });

      expect(updated.title).toBe("Updated Title");
      expect(updated.summary).toBe("A new summary");
      expect(updated.beats).toEqual(["beat one", "beat two"]);
      expect(updated.id).toBe(created.id);

      // Verify persistence
      const reloaded = await getChapter(dir, story.slug, created.id);
      expect(reloaded!.title).toBe("Updated Title");
    });
  });

  it("bumps story.json updatedAt", async () => {
    await withTemp(async (dir) => {
      const story = await createStory(dir, { title: "My Story" });
      const created = await createChapter(dir, story.slug, { title: "Chapter One" });
      await new Promise((r) => setTimeout(r, 10));

      await updateChapter(dir, story.slug, created.id, { summary: "changed" });

      const reloaded = await getStory(dir, story.slug);
      expect(reloaded!.updatedAt).not.toBe(story.updatedAt);
    });
  });

  it("renames file when title changes", async () => {
    await withTemp(async (dir) => {
      const story = await createStory(dir, { title: "My Story" });
      await createChapter(dir, story.slug, { title: "Old Title" });

      const filesBefore = await readdir(chaptersDir(dir, story.slug));
      expect(filesBefore).toContain("001-old-title.json");

      await updateChapter(dir, story.slug, (await listChapters(dir, story.slug))[0].id, {
        title: "New Title",
      });

      const filesAfter = await readdir(chaptersDir(dir, story.slug));
      expect(filesAfter).toContain("001-new-title.json");
      expect(filesAfter).not.toContain("001-old-title.json");
    });
  });

  it("throws for a missing chapter id", async () => {
    await withTemp(async (dir) => {
      const story = await createStory(dir, { title: "My Story" });
      await expect(
        updateChapter(dir, story.slug, "nonexistent-id", { title: "X" })
      ).rejects.toThrow("Chapter not found: nonexistent-id");
    });
  });
});

describe("deleteChapter", () => {
  it("removes the chapter file and its id from chapterOrder", async () => {
    await withTemp(async (dir) => {
      const story = await createStory(dir, { title: "My Story" });
      const ch = await createChapter(dir, story.slug, { title: "Alpha" });

      await deleteChapter(dir, story.slug, ch.id);

      const files = await readdir(chaptersDir(dir, story.slug));
      expect(files).toHaveLength(0);

      const updated = await getStory(dir, story.slug);
      expect(updated!.chapterOrder).toEqual([]);
    });
  });

  it("renames remaining files with new ordinal prefixes after middle chapter deleted", async () => {
    await withTemp(async (dir) => {
      const story = await createStory(dir, { title: "My Story" });
      const ch1 = await createChapter(dir, story.slug, { title: "Alpha" });
      const ch2 = await createChapter(dir, story.slug, { title: "Bravo" });
      const ch3 = await createChapter(dir, story.slug, { title: "Charlie" });

      await deleteChapter(dir, story.slug, ch2.id);

      // 1. On-disk filenames reflect new order
      const files = (await readdir(chaptersDir(dir, story.slug))).sort();
      expect(files).toEqual(["001-alpha.json", "002-charlie.json"]);

      // 2. chapterOrder no longer contains deleted id
      const updated = await getStory(dir, story.slug);
      expect(updated!.chapterOrder).toEqual([ch1.id, ch3.id]);

      // 3. JSON id fields inside remaining files are unchanged
      const raw1 = JSON.parse(
        await readFile(join(chaptersDir(dir, story.slug), "001-alpha.json"), "utf-8")
      );
      const raw2 = JSON.parse(
        await readFile(join(chaptersDir(dir, story.slug), "002-charlie.json"), "utf-8")
      );
      expect(raw1.id).toBe(ch1.id);
      expect(raw2.id).toBe(ch3.id);
    });
  });

  it("bumps story.json updatedAt", async () => {
    await withTemp(async (dir) => {
      const story = await createStory(dir, { title: "My Story" });
      const ch = await createChapter(dir, story.slug, { title: "Alpha" });
      await new Promise((r) => setTimeout(r, 10));

      await deleteChapter(dir, story.slug, ch.id);

      const updated = await getStory(dir, story.slug);
      expect(updated!.updatedAt).not.toBe(story.updatedAt);
    });
  });

  it("is a no-op if chapter id is not in chapterOrder", async () => {
    await withTemp(async (dir) => {
      const story = await createStory(dir, { title: "My Story" });
      await createChapter(dir, story.slug, { title: "Alpha" });

      await expect(deleteChapter(dir, story.slug, "bogus-id")).resolves.toBeUndefined();

      const files = await readdir(chaptersDir(dir, story.slug));
      expect(files).toHaveLength(1);
    });
  });
});

describe("reorderChapters", () => {
  it("rewrites filenames with new ordinal prefixes", async () => {
    await withTemp(async (dir) => {
      const story = await createStory(dir, { title: "My Story" });
      const ch1 = await createChapter(dir, story.slug, { title: "Alpha" });
      const ch2 = await createChapter(dir, story.slug, { title: "Bravo" });
      const ch3 = await createChapter(dir, story.slug, { title: "Charlie" });

      await reorderChapters(dir, story.slug, [ch3.id, ch1.id, ch2.id]);

      const files = (await readdir(chaptersDir(dir, story.slug))).sort();
      expect(files).toEqual(["001-charlie.json", "002-alpha.json", "003-bravo.json"]);

      const updated = await getStory(dir, story.slug);
      expect(updated!.chapterOrder).toEqual([ch3.id, ch1.id, ch2.id]);
    });
  });

  it("chapters returned by listChapters follow new order", async () => {
    await withTemp(async (dir) => {
      const story = await createStory(dir, { title: "My Story" });
      const ch1 = await createChapter(dir, story.slug, { title: "Alpha" });
      const ch2 = await createChapter(dir, story.slug, { title: "Bravo" });
      const ch3 = await createChapter(dir, story.slug, { title: "Charlie" });

      await reorderChapters(dir, story.slug, [ch2.id, ch3.id, ch1.id]);

      const chapters = await listChapters(dir, story.slug);
      expect(chapters.map((c) => c.id)).toEqual([ch2.id, ch3.id, ch1.id]);
    });
  });

  it("throws when newOrder is not a permutation of existing ids", async () => {
    await withTemp(async (dir) => {
      const story = await createStory(dir, { title: "My Story" });
      await createChapter(dir, story.slug, { title: "Alpha" });
      await createChapter(dir, story.slug, { title: "Bravo" });

      await expect(
        reorderChapters(dir, story.slug, ["bogus-id"])
      ).rejects.toThrow("newOrder must be a permutation of existing chapterOrder");
    });
  });

  it("throws when newOrder has wrong length", async () => {
    await withTemp(async (dir) => {
      const story = await createStory(dir, { title: "My Story" });
      const ch1 = await createChapter(dir, story.slug, { title: "Alpha" });
      await createChapter(dir, story.slug, { title: "Bravo" });

      await expect(
        reorderChapters(dir, story.slug, [ch1.id])
      ).rejects.toThrow("newOrder must be a permutation of existing chapterOrder");
    });
  });

  it("throws when newOrder contains duplicate ids", async () => {
    await withTemp(async (dir) => {
      const story = await createStory(dir, { title: "My Story" });
      const ch1 = await createChapter(dir, story.slug, { title: "Alpha" });
      await createChapter(dir, story.slug, { title: "Bravo" });

      await expect(
        reorderChapters(dir, story.slug, [ch1.id, ch1.id])
      ).rejects.toThrow("newOrder must be a permutation of existing chapterOrder");
    });
  });

  it("bumps story.json updatedAt", async () => {
    await withTemp(async (dir) => {
      const story = await createStory(dir, { title: "My Story" });
      const ch1 = await createChapter(dir, story.slug, { title: "Alpha" });
      const ch2 = await createChapter(dir, story.slug, { title: "Bravo" });
      await new Promise((r) => setTimeout(r, 10));

      await reorderChapters(dir, story.slug, [ch2.id, ch1.id]);

      const updated = await getStory(dir, story.slug);
      expect(updated!.updatedAt).not.toBe(story.updatedAt);
    });
  });
});
