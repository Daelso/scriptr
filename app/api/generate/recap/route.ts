import type { NextRequest } from "next/server";
import { ok, fail, readJson, JsonParseError } from "@/lib/api";
import { loadConfig, effectiveDataDir } from "@/lib/config";
import { getStory } from "@/lib/storage/stories";
import { getChapter, updateChapter } from "@/lib/storage/chapters";
import { getGrokClient, MissingKeyError } from "@/lib/grok";
import { generateRecap } from "@/lib/recap";

export async function POST(req: NextRequest) {
  let body: { storySlug?: unknown; chapterId?: unknown };
  try {
    body = await readJson<{ storySlug?: unknown; chapterId?: unknown }>(req);
  } catch (err) {
    if (err instanceof JsonParseError) return fail(err.message, 400);
    throw err;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail("request body must be an object", 400);
  }
  if (typeof body.storySlug !== "string") return fail("storySlug required");
  if (typeof body.chapterId !== "string") return fail("chapterId required");

  const dataDir = effectiveDataDir();
  const config = await loadConfig(dataDir);
  const story = await getStory(dataDir, body.storySlug);
  if (!story) return fail("story not found", 404);
  const chapter = await getChapter(dataDir, body.storySlug, body.chapterId);
  if (!chapter) return fail("chapter not found", 404);

  let client;
  try {
    client = getGrokClient(config);
  } catch (err) {
    if (err instanceof MissingKeyError) return fail(err.message, 500);
    return fail(err instanceof Error ? err.message : "grok client error", 500);
  }

  const model = story.modelOverride ?? config.defaultModel;

  try {
    const recap = await generateRecap(client, model, story, chapter);
    await updateChapter(dataDir, body.storySlug, body.chapterId, { recap });
    return ok({ recap });
  } catch (err) {
    const message = err instanceof Error ? err.message : "recap failed";
    return fail(message, 502);
  }
}
