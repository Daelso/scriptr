import { NextRequest } from "next/server";
import { ok, fail, readJson } from "@/lib/api";
import { createStory, listStories } from "@/lib/storage/stories";
import { effectiveDataDir } from "@/lib/config";

export async function GET() {
  return ok(await listStories(effectiveDataDir()));
}

export async function POST(req: NextRequest) {
  const body = await readJson<{ title?: string; authorPenName?: string }>(req);
  if (!body.title || typeof body.title !== "string") return fail("title required");
  const story = await createStory(effectiveDataDir(), { title: body.title, authorPenName: body.authorPenName });
  return ok(story, { status: 201 });
}
