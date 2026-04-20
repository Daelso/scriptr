import { readFile, writeFile } from "node:fs/promises";
import { bibleJson } from "@/lib/storage/paths";
import { updateStory } from "@/lib/storage/stories";
import type { Bible } from "@/lib/types";

export async function getBible(dataDir: string, slug: string): Promise<Bible | null> {
  try {
    const raw = await readFile(bibleJson(dataDir, slug), "utf-8");
    return JSON.parse(raw) as Bible;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function saveBible(dataDir: string, slug: string, bible: Bible): Promise<Bible> {
  await writeFile(bibleJson(dataDir, slug), JSON.stringify(bible, null, 2), "utf-8");
  await updateStory(dataDir, slug, {});
  return bible;
}
