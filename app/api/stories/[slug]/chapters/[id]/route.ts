import type { NextRequest } from "next/server";
import { ok, fail, readJson } from "@/lib/api";
import { getChapter, updateChapter, deleteChapter } from "@/lib/storage/chapters";
import { effectiveDataDir } from "@/lib/config";
import type { Chapter } from "@/lib/types";

type Ctx = { params: Promise<{ slug: string; id: string }> };

const ALLOWED: (keyof Chapter)[] = [
  "title", "summary", "beats", "prompt", "recap", "sections", "targetWords",
];

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const chapter = await getChapter(effectiveDataDir(), slug, id);
  if (!chapter) return fail("chapter not found", 404);
  return ok(chapter);
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const body = await readJson<Partial<Chapter>>(req);
  const patch: Partial<Chapter> = {};
  for (const k of ALLOWED) if (k in body) (patch as Record<string, unknown>)[k] = body[k];
  try {
    const updated = await updateChapter(effectiveDataDir(), slug, id, patch);
    return ok(updated);
  } catch {
    return fail("chapter not found", 404);
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const existing = await getChapter(effectiveDataDir(), slug, id);
  if (!existing) return fail("chapter not found", 404);
  await deleteChapter(effectiveDataDir(), slug, id);
  return ok({ deleted: true });
}
