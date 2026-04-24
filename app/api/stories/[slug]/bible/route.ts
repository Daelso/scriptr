import type { NextRequest } from "next/server";
import { ok, fail, readJson } from "@/lib/api";
import { getBible, saveBible, validateBible } from "@/lib/storage/bible";
import { getStory } from "@/lib/storage/stories";
import { effectiveDataDir } from "@/lib/config";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  const bible = await getBible(effectiveDataDir(), slug);
  if (!bible) return fail("bible not found", 404);
  return ok(bible);
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  // Require the story to exist so PUT can't create a story via the bible endpoint.
  const story = await getStory(effectiveDataDir(), slug);
  if (!story) return fail("story not found", 404);

  const body = await readJson<unknown>(req);
  if (!validateBible(body)) return fail("invalid bible shape");

  const saved = await saveBible(effectiveDataDir(), slug, body);
  return ok(saved);
}
