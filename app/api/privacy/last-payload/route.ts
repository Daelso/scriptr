import type { NextRequest } from "next/server";
import { readFile } from "node:fs/promises";
import { ok, fail } from "@/lib/api";
import { effectiveDataDir } from "@/lib/config";
import { getStory } from "@/lib/storage/stories";
import { lastPayloadFile } from "@/lib/storage/paths";

export async function GET(req: NextRequest) {
  const slug = new URL(req.url).searchParams.get("slug");
  if (!slug) return fail("slug required");

  const dataDir = effectiveDataDir();
  const story = await getStory(dataDir, slug);
  if (!story) return fail("story not found", 404);

  try {
    const raw = await readFile(lastPayloadFile(dataDir, slug), "utf-8");
    const payload = JSON.parse(raw) as unknown;
    return ok(payload);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return ok(null);
    }
    throw err;
  }
}
