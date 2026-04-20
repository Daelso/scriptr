import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStory, getStory } from "@/lib/storage/stories";
import { getBible, saveBible } from "@/lib/storage/bible";

async function withTemp(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "scriptr-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("getBible", () => {
  it("returns the default bible written at story creation", async () => {
    await withTemp(async (dir) => {
      const story = await createStory(dir, { title: "My Story" });
      const bible = await getBible(dir, story.slug);

      expect(bible).toEqual({
        characters: [],
        setting: "",
        pov: "third-limited",
        tone: "",
        styleNotes: "",
        nsfwPreferences: "",
      });
    });
  });

  it("returns null for a nonexistent story", async () => {
    await withTemp(async (dir) => {
      const result = await getBible(dir, "nonexistent-story");
      expect(result).toBeNull();
    });
  });
});

describe("saveBible", () => {
  it("persists the bible: subsequent getBible returns the saved content", async () => {
    await withTemp(async (dir) => {
      const story = await createStory(dir, { title: "Save Test" });

      const newBible = {
        characters: [{ name: "Alice", description: "Protagonist", traits: "bold" }],
        setting: "Victorian London",
        pov: "first" as const,
        tone: "dark",
        styleNotes: "Terse prose",
        nsfwPreferences: "fade to black",
      };

      await saveBible(dir, story.slug, newBible);
      const loaded = await getBible(dir, story.slug);

      expect(loaded).toEqual(newBible);
    });
  });

  it("returns the saved bible", async () => {
    await withTemp(async (dir) => {
      const story = await createStory(dir, { title: "Return Test" });

      const newBible = {
        characters: [],
        setting: "Space station",
        pov: "second" as const,
        tone: "playful",
        styleNotes: "",
        nsfwPreferences: "",
      };

      const returned = await saveBible(dir, story.slug, newBible);
      expect(returned).toEqual(newBible);
    });
  });

  it("bumps story.json updatedAt", async () => {
    await withTemp(async (dir) => {
      const story = await createStory(dir, { title: "Bump Test" });
      const originalUpdatedAt = story.updatedAt;

      await new Promise((r) => setTimeout(r, 10));

      await saveBible(dir, story.slug, {
        characters: [],
        setting: "",
        pov: "third-limited",
        tone: "",
        styleNotes: "",
        nsfwPreferences: "",
      });

      const reloaded = await getStory(dir, story.slug);
      expect(reloaded!.updatedAt).not.toBe(originalUpdatedAt);
    });
  });

  it("round-trips Bible.styleOverrides", async () => {
    await withTemp(async (dir) => {
      const story = await createStory(dir, { title: "Style Overrides Test" });
      const bible = {
        characters: [],
        setting: "",
        pov: "third-limited" as const,
        tone: "",
        styleNotes: "",
        nsfwPreferences: "",
        styleOverrides: { tense: "present", customRules: "no metaphors" },
      };
      await saveBible(dir, story.slug, bible);
      const loaded = await getBible(dir, story.slug);
      expect(loaded?.styleOverrides).toEqual({
        tense: "present",
        customRules: "no metaphors",
      });
    });
  });
});
