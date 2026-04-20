import type { NextRequest } from "next/server";
import { ok, fail, readJson } from "@/lib/api";
import { getBible, saveBible } from "@/lib/storage/bible";
import { getStory } from "@/lib/storage/stories";
import { effectiveDataDir } from "@/lib/config";
import type { Bible } from "@/lib/types";

type Ctx = { params: Promise<{ slug: string }> };

const POV_VALUES = ["first", "second", "third-limited", "third-omniscient"] as const;

function validateBible(value: unknown): value is Bible {
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
