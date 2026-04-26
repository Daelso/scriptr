import { mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { storyDir, storyJson, bibleJson, chaptersDir, exportsDir } from "@/lib/storage/paths";
import { toSlug, uniqueSlug } from "@/lib/slug";
import type { Story, Bible } from "@/lib/types";
import { withPathLock, writeJsonAtomic } from "@/lib/fs-atomic";

export type NewStoryInput = { title: string; authorPenName?: string };

export class StoryNotFoundError extends Error {
  constructor(slug: string) {
    super(`Story not found: ${slug}`);
    this.name = "StoryNotFoundError";
  }
}

const defaultBible: Bible = {
  characters: [],
  setting: "",
  pov: "third-limited",
  tone: "",
  styleNotes: "",
  nsfwPreferences: "",
};

export async function createStory(dataDir: string, input: NewStoryInput): Promise<Story> {
  const existing = await listStories(dataDir);
  const existingSlugs = existing.map((s) => s.slug);
  const base = toSlug(input.title);
  const slug = uniqueSlug(base, existingSlugs);

  const now = new Date().toISOString();

  const story: Story = {
    slug,
    title: input.title,
    authorPenName: input.authorPenName ?? "",
    description: "",
    copyrightYear: new Date().getFullYear(),
    language: "en",
    bisacCategory: "FIC027000",
    keywords: [],
    createdAt: now,
    updatedAt: now,
    chapterOrder: [],
  };

  const dir = storyDir(dataDir, slug);
  await mkdir(dir, { recursive: true });
  await writeFile(storyJson(dataDir, slug), JSON.stringify(story, null, 2), "utf-8");
  await writeFile(bibleJson(dataDir, slug), JSON.stringify(defaultBible, null, 2), "utf-8");
  await mkdir(chaptersDir(dataDir, slug), { recursive: true });
  await mkdir(exportsDir(dataDir, slug), { recursive: true });

  return story;
}

export async function listStories(dataDir: string): Promise<Story[]> {
  const storiesRoot = join(dataDir, "stories");
  let entries: string[];
  try {
    entries = await readdir(storiesRoot);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const stories: Story[] = [];
  for (const entry of entries) {
    const jsonPath = storyJson(dataDir, entry);
    try {
      const raw = await readFile(jsonPath, "utf-8");
      stories.push(JSON.parse(raw) as Story);
    } catch {
      // skip malformed or non-story entries
    }
  }

  return stories.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getStory(dataDir: string, slug: string): Promise<Story | null> {
  try {
    const raw = await readFile(storyJson(dataDir, slug), "utf-8");
    return JSON.parse(raw) as Story;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function updateStory(
  dataDir: string,
  slug: string,
  patch: Partial<Story>
): Promise<Story> {
  const jsonPath = storyJson(dataDir, slug);
  return withPathLock(jsonPath, async () => {
    const existing = await getStory(dataDir, slug);
    if (!existing) throw new StoryNotFoundError(slug);

    const updated: Story = {
      ...existing,
      ...patch,
      // immutable fields
      slug: existing.slug,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };

    await writeJsonAtomic(jsonPath, updated);
    return updated;
  });
}

export async function deleteStory(dataDir: string, slug: string): Promise<void> {
  await rm(storyDir(dataDir, slug), { recursive: true, force: true });
}
