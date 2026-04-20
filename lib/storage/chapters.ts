import { mkdir, writeFile, readFile, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { chaptersDir, chapterFile } from "@/lib/storage/paths";
import { getStory, updateStory } from "@/lib/storage/stories";
import type { Chapter } from "@/lib/types";

export type NewChapterInput = { title: string; summary?: string };

async function readAllChapterFiles(
  dataDir: string,
  slug: string
): Promise<{ path: string; chapter: Chapter }[]> {
  const dir = chaptersDir(dataDir, slug);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const results: { path: string; chapter: Chapter }[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const filePath = join(dir, file);
    try {
      const raw = await readFile(filePath, "utf-8");
      results.push({ path: filePath, chapter: JSON.parse(raw) as Chapter });
    } catch {
      // skip malformed files
    }
  }
  return results;
}

async function rewriteChapterFilenames(
  dataDir: string,
  slug: string,
  chapters: Chapter[]
): Promise<void> {
  const existing = await readAllChapterFiles(dataDir, slug);
  const byId = new Map(existing.map((e) => [e.chapter.id, e.path]));

  const plan: { from: string; to: string; chapter: Chapter }[] = [];
  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];
    const from = byId.get(ch.id);
    if (!from) continue;
    const to = chapterFile(dataDir, slug, i, ch.id, ch.title);
    plan.push({ from, to, chapter: ch });
  }

  // Two-pass rename to avoid collisions (e.g. 001->002 when 002 already exists).
  // Pass 1: move every file to a unique temp name.
  const tempPaths: { temp: string; to: string }[] = [];
  const dir = chaptersDir(dataDir, slug);
  for (let i = 0; i < plan.length; i++) {
    const { from } = plan[i];
    const temp = join(dir, `.rewrite-${randomUUID()}-${i}.json`);
    await rename(from, temp);
    tempPaths.push({ temp, to: plan[i].to });
  }

  // Pass 2: move from temp names to final names.
  for (const { temp, to } of tempPaths) {
    await rename(temp, to);
  }
}

export async function createChapter(
  dataDir: string,
  slug: string,
  input: NewChapterInput
): Promise<Chapter> {
  const story = await getStory(dataDir, slug);
  if (!story) throw new Error(`Story not found: ${slug}`);

  const chapter: Chapter = {
    id: randomUUID(),
    title: input.title,
    summary: input.summary ?? "",
    beats: [],
    prompt: "",
    recap: "",
    sections: [],
    wordCount: 0,
  };

  const index = story.chapterOrder.length;
  const filePath = chapterFile(dataDir, slug, index, chapter.id, chapter.title);
  await mkdir(chaptersDir(dataDir, slug), { recursive: true });
  await writeFile(filePath, JSON.stringify(chapter, null, 2), "utf-8");

  await updateStory(dataDir, slug, { chapterOrder: [...story.chapterOrder, chapter.id] });

  return chapter;
}

export type NewImportedChapterInput = {
  title: string;
  sectionContents: string[];
};

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export async function createImportedChapter(
  dataDir: string,
  slug: string,
  input: NewImportedChapterInput
): Promise<Chapter> {
  const story = await getStory(dataDir, slug);
  if (!story) throw new Error(`Story not found: ${slug}`);

  const sections = input.sectionContents.map((content) => ({
    id: randomUUID(),
    content,
  }));
  const wordCount = input.sectionContents.reduce(
    (acc, s) => acc + countWords(s),
    0
  );

  const chapter: Chapter = {
    id: randomUUID(),
    title: input.title,
    summary: "",
    beats: [],
    prompt: "",
    recap: "",
    sections,
    wordCount,
    source: "imported",
  };

  const index = story.chapterOrder.length;
  const filePath = chapterFile(dataDir, slug, index, chapter.id, chapter.title);
  await mkdir(chaptersDir(dataDir, slug), { recursive: true });
  await writeFile(filePath, JSON.stringify(chapter, null, 2), "utf-8");

  await updateStory(dataDir, slug, {
    chapterOrder: [...story.chapterOrder, chapter.id],
  });

  return chapter;
}

export async function listChapters(dataDir: string, slug: string): Promise<Chapter[]> {
  const story = await getStory(dataDir, slug);
  if (!story) return [];

  const existing = await readAllChapterFiles(dataDir, slug);
  const byId = new Map(existing.map((e) => [e.chapter.id, e.chapter]));

  const chapters: Chapter[] = [];
  for (const id of story.chapterOrder) {
    const ch = byId.get(id);
    if (ch) chapters.push(ch);
  }
  return chapters;
}

export async function getChapter(
  dataDir: string,
  slug: string,
  chapterId: string
): Promise<Chapter | null> {
  const story = await getStory(dataDir, slug);
  if (!story) return null;
  if (!story.chapterOrder.includes(chapterId)) return null;

  const existing = await readAllChapterFiles(dataDir, slug);
  const entry = existing.find((e) => e.chapter.id === chapterId);
  return entry?.chapter ?? null;
}

export async function updateChapter(
  dataDir: string,
  slug: string,
  chapterId: string,
  patch: Partial<Chapter>
): Promise<Chapter> {
  const story = await getStory(dataDir, slug);
  if (!story) throw new Error(`Story not found: ${slug}`);
  if (!story.chapterOrder.includes(chapterId)) {
    throw new Error(`Chapter not found: ${chapterId}`);
  }

  const existing = await readAllChapterFiles(dataDir, slug);
  const entry = existing.find((e) => e.chapter.id === chapterId);
  if (!entry) throw new Error(`Chapter not found: ${chapterId}`);

  const updated: Chapter = {
    ...entry.chapter,
    ...patch,
    id: entry.chapter.id,
  };

  // Write to old path first so rewriteChapterFilenames can find it.
  await writeFile(entry.path, JSON.stringify(updated, null, 2), "utf-8");

  // Rebuild full ordered chapter list with the update applied.
  const byId = new Map(existing.map((e) => [e.chapter.id, e.chapter]));
  byId.set(updated.id, updated);
  const orderedChapters = story.chapterOrder
    .map((id) => byId.get(id))
    .filter((c): c is Chapter => c !== undefined);

  await rewriteChapterFilenames(dataDir, slug, orderedChapters);
  await updateStory(dataDir, slug, {});

  return updated;
}

export async function deleteChapter(
  dataDir: string,
  slug: string,
  chapterId: string
): Promise<void> {
  const story = await getStory(dataDir, slug);
  if (!story) return;
  if (!story.chapterOrder.includes(chapterId)) return;

  // Remove from order first, then find and delete the file.
  const newOrder = story.chapterOrder.filter((id) => id !== chapterId);

  const existing = await readAllChapterFiles(dataDir, slug);
  const entry = existing.find((e) => e.chapter.id === chapterId);
  if (entry) {
    await rm(entry.path, { force: true });
  }

  const remaining = existing
    .filter((e) => e.chapter.id !== chapterId)
    .map((e) => e.chapter);

  // Re-index remaining by newOrder.
  const byId = new Map(remaining.map((c) => [c.id, c]));
  const orderedRemaining = newOrder
    .map((id) => byId.get(id))
    .filter((c): c is Chapter => c !== undefined);

  await rewriteChapterFilenames(dataDir, slug, orderedRemaining);
  await updateStory(dataDir, slug, { chapterOrder: newOrder });
}

export async function reorderChapters(
  dataDir: string,
  slug: string,
  newOrder: string[]
): Promise<void> {
  const story = await getStory(dataDir, slug);
  if (!story) throw new Error(`Story not found: ${slug}`);

  const existing = new Set(story.chapterOrder);
  const proposed = new Set(newOrder);

  if (
    newOrder.length !== story.chapterOrder.length ||
    newOrder.length !== proposed.size ||
    ![...existing].every((id) => proposed.has(id))
  ) {
    throw new Error("newOrder must be a permutation of existing chapterOrder");
  }

  const allChapters = await readAllChapterFiles(dataDir, slug);
  const byId = new Map(allChapters.map((e) => [e.chapter.id, e.chapter]));
  const orderedChapters = newOrder
    .map((id) => byId.get(id))
    .filter((c): c is Chapter => c !== undefined);

  await rewriteChapterFilenames(dataDir, slug, orderedChapters);
  await updateStory(dataDir, slug, { chapterOrder: newOrder });
}
