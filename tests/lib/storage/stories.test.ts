import { describe, it, expect } from "vitest";
import { mkdtemp, rm, access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createStory,
  listStories,
  getStory,
  updateStory,
  deleteStory,
} from "@/lib/storage/stories";
import { storyDir } from "@/lib/storage/paths";

async function withTemp(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "scriptr-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("createStory", () => {
  it("writes story.json, bible.json, and creates chapters/ and exports/ dirs", async () => {
    await withTemp(async (dir) => {
      const story = await createStory(dir, { title: "My First Story", authorPenName: "Jane Doe" });

      // Check story.json exists and is readable
      const storyPath = join(dir, "stories", story.slug, "story.json");
      const biblePath = join(dir, "stories", story.slug, "bible.json");
      const chaptersPath = join(dir, "stories", story.slug, "chapters");
      const exportsPath = join(dir, "stories", story.slug, "exports");

      await expect(access(storyPath)).resolves.toBeUndefined();
      await expect(access(biblePath)).resolves.toBeUndefined();
      await expect(access(chaptersPath)).resolves.toBeUndefined();
      await expect(access(exportsPath)).resolves.toBeUndefined();

      // Verify story.json shape
      const storyData = JSON.parse(await readFile(storyPath, "utf-8"));
      expect(storyData.slug).toBe("my-first-story");
      expect(storyData.title).toBe("My First Story");
      expect(storyData.authorPenName).toBe("Jane Doe");
      expect(storyData.description).toBe("");
      expect(storyData.copyrightYear).toBe(new Date().getFullYear());
      expect(storyData.language).toBe("en");
      expect(storyData.bisacCategory).toBe("FIC027000");
      expect(storyData.keywords).toEqual([]);
      expect(storyData.chapterOrder).toEqual([]);
      // ISO strings
      expect(storyData.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(storyData.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      // Verify bible.json matches default
      const bibleData = JSON.parse(await readFile(biblePath, "utf-8"));
      expect(bibleData).toEqual({
        characters: [],
        setting: "",
        pov: "third-limited",
        tone: "",
        styleNotes: "",
        nsfwPreferences: "",
      });
    });
  });

  it("defaults authorPenName to empty string when not provided", async () => {
    await withTemp(async (dir) => {
      const story = await createStory(dir, { title: "No Pen Name" });
      expect(story.authorPenName).toBe("");
    });
  });

  it("slug collision: createStory with same title twice yields unique slugs", async () => {
    await withTemp(async (dir) => {
      const story1 = await createStory(dir, { title: "The Meeting" });
      const story2 = await createStory(dir, { title: "The Meeting" });
      expect(story1.slug).toBe("the-meeting");
      expect(story2.slug).toBe("the-meeting-2");
    });
  });
});

describe("listStories", () => {
  it("returns empty array when no stories exist", async () => {
    await withTemp(async (dir) => {
      const stories = await listStories(dir);
      expect(stories).toEqual([]);
    });
  });

  it("returns stories sorted by updatedAt desc (newest first)", async () => {
    await withTemp(async (dir) => {
      const story1 = await createStory(dir, { title: "Story One" });
      await new Promise((r) => setTimeout(r, 10));
      const story2 = await createStory(dir, { title: "Story Two" });

      const stories = await listStories(dir);
      expect(stories).toHaveLength(2);
      expect(stories[0].slug).toBe(story2.slug);
      expect(stories[1].slug).toBe(story1.slug);
    });
  });
});

describe("getStory", () => {
  it("returns the story for an existing slug", async () => {
    await withTemp(async (dir) => {
      const created = await createStory(dir, { title: "Findable Story" });
      const found = await getStory(dir, created.slug);
      expect(found).not.toBeNull();
      expect(found!.slug).toBe(created.slug);
      expect(found!.title).toBe("Findable Story");
    });
  });

  it("returns null for a missing slug", async () => {
    await withTemp(async (dir) => {
      const result = await getStory(dir, "nonexistent-story");
      expect(result).toBeNull();
    });
  });
});

describe("updateStory", () => {
  it("applies patch, bumps updatedAt, and preserves other fields", async () => {
    await withTemp(async (dir) => {
      const created = await createStory(dir, { title: "Original Title" });
      await new Promise((r) => setTimeout(r, 10));

      const updated = await updateStory(dir, created.slug, { title: "Updated Title", description: "New desc" });

      expect(updated.title).toBe("Updated Title");
      expect(updated.description).toBe("New desc");
      expect(updated.updatedAt).not.toBe(created.updatedAt);
      expect(updated.createdAt).toBe(created.createdAt);
    });
  });

  it("updating title does NOT change slug (slug is immutable)", async () => {
    await withTemp(async (dir) => {
      const created = await createStory(dir, { title: "My Story" });
      const updated = await updateStory(dir, created.slug, { title: "Completely Different Title", slug: "attempted-override" });

      expect(updated.slug).toBe(created.slug);
      expect(updated.slug).toBe("my-story");
    });
  });

  it("persists changes to story.json", async () => {
    await withTemp(async (dir) => {
      const created = await createStory(dir, { title: "Persist Test" });
      await updateStory(dir, created.slug, { description: "Persisted description" });

      const reloaded = await getStory(dir, created.slug);
      expect(reloaded!.description).toBe("Persisted description");
    });
  });
});

describe("deleteStory", () => {
  it("removes the entire story folder", async () => {
    await withTemp(async (dir) => {
      const story = await createStory(dir, { title: "To Be Deleted" });
      const dir2 = storyDir(dir, story.slug);

      await deleteStory(dir, story.slug);

      await expect(access(dir2)).rejects.toThrow();
    });
  });

  it("removed story no longer appears in listStories", async () => {
    await withTemp(async (dir) => {
      const story = await createStory(dir, { title: "Ephemeral" });
      await deleteStory(dir, story.slug);

      const stories = await listStories(dir);
      expect(stories).toHaveLength(0);
    });
  });
});
