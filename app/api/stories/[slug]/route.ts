import type { NextRequest } from "next/server";
import { ok, fail, readJson, JsonParseError } from "@/lib/api";
import { getStory, updateStory, deleteStory } from "@/lib/storage/stories";
import { effectiveDataDir } from "@/lib/config";
import type { Story } from "@/lib/types";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  const story = await getStory(effectiveDataDir(), slug);
  if (!story) return fail("story not found", 404);
  return ok(story);
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  let body: Partial<Story>;
  try {
    body = await readJson<Partial<Story>>(req);
  } catch (err) {
    if (err instanceof JsonParseError) return fail(err.message, 400);
    throw err;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail("request body must be an object", 400);
  }
  const allowed: (keyof Story)[] = [
    "title", "authorPenName", "subtitle", "description",
    "copyrightYear", "language", "bisacCategory", "keywords",
    "isbn", "modelOverride",
  ];
  const patch: Partial<Story> = {};
  for (const k of allowed) if (k in body) (patch as Record<string, unknown>)[k] = body[k];
  try {
    const updated = await updateStory(effectiveDataDir(), slug, patch);
    return ok(updated);
  } catch {
    return fail("story not found", 404);
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  const existing = await getStory(effectiveDataDir(), slug);
  if (!existing) return fail("story not found", 404);
  await deleteStory(effectiveDataDir(), slug);
  return ok({ deleted: true });
}
