import type { NextRequest } from "next/server";
import { ok, fail, readJson, JsonParseError } from "@/lib/api";
import { listChapters, createChapter } from "@/lib/storage/chapters";
import { getStory } from "@/lib/storage/stories";
import { effectiveDataDir } from "@/lib/config";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  const story = await getStory(effectiveDataDir(), slug);
  if (!story) return fail("story not found", 404);
  const chapters = await listChapters(effectiveDataDir(), slug);
  return ok(chapters);
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  const story = await getStory(effectiveDataDir(), slug);
  if (!story) return fail("story not found", 404);

  let body: { title?: unknown; summary?: unknown };
  try {
    body = await readJson<{ title?: unknown; summary?: unknown }>(req);
  } catch (err) {
    if (err instanceof JsonParseError) return fail(err.message, 400);
    throw err;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail("request body must be an object", 400);
  }
  if (typeof body.title !== "string" || body.title.trim() === "") {
    return fail("title required");
  }
  if (body.summary !== undefined && typeof body.summary !== "string") {
    return fail("summary must be a string");
  }

  const chapter = await createChapter(effectiveDataDir(), slug, {
    title: body.title,
    summary: typeof body.summary === "string" ? body.summary : undefined,
  });
  return ok(chapter, { status: 201 });
}
