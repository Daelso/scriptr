import { readFile, writeFile } from "node:fs/promises";
import { bibleJson } from "@/lib/storage/paths";
import { updateStory } from "@/lib/storage/stories";
import type { Bible } from "@/lib/types";

const POV_VALUES = ["first", "second", "third-limited", "third-omniscient"] as const;

export function validateBible(value: unknown): value is Bible {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.characters)) return false;
  for (const c of v.characters) {
    if (!c || typeof c !== "object") return false;
    const ch = c as Record<string, unknown>;
    if (typeof ch.name !== "string") return false;
    if (typeof ch.description !== "string") return false;
    if (ch.traits !== undefined && typeof ch.traits !== "string") return false;
  }
  if (typeof v.setting !== "string") return false;
  if (!POV_VALUES.includes(v.pov as (typeof POV_VALUES)[number])) return false;
  if (typeof v.tone !== "string") return false;
  if (typeof v.styleNotes !== "string") return false;
  if (typeof v.nsfwPreferences !== "string") return false;
  return true;
}

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
