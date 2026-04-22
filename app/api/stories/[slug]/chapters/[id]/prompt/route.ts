import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api";
import { effectiveDataDir } from "@/lib/config";
import {
  assembleChapterPrompt,
  StoryNotFoundError,
  BibleNotFoundError,
  ChapterNotFoundError,
} from "@/lib/prompt-assembly";

type Ctx = { params: Promise<{ slug: string; id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  try {
    const prompt = await assembleChapterPrompt(effectiveDataDir(), slug, id);
    return ok(prompt);
  } catch (e) {
    if (e instanceof StoryNotFoundError) return fail("story not found", 404);
    if (e instanceof BibleNotFoundError) return fail("bible not found", 404);
    if (e instanceof ChapterNotFoundError) return fail("chapter not found", 404);
    throw e;
  }
}
