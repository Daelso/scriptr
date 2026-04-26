import type { NextRequest } from "next/server";
import { ok, fail, readJson, JsonParseError } from "@/lib/api";
import { reorderChapters } from "@/lib/storage/chapters";
import { getStory } from "@/lib/storage/stories";
import { effectiveDataDir } from "@/lib/config";

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  const story = await getStory(effectiveDataDir(), slug);
  if (!story) return fail("story not found", 404);

  let body: { order?: unknown };
  try {
    body = await readJson<{ order?: unknown }>(req);
  } catch (err) {
    if (err instanceof JsonParseError) return fail(err.message, 400);
    throw err;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail("request body must be an object", 400);
  }
  if (!Array.isArray(body.order) || !body.order.every((x) => typeof x === "string")) {
    return fail("order must be an array of strings");
  }

  try {
    await reorderChapters(effectiveDataDir(), slug, body.order);
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid order";
    return fail(message);
  }
  return ok({ reordered: true });
}
