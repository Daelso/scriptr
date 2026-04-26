import { NextRequest } from "next/server";
import { ok, fail, readJson, JsonParseError } from "@/lib/api";
import { createStory, listStories } from "@/lib/storage/stories";
import { effectiveDataDir } from "@/lib/config";

export async function GET() {
  return ok(await listStories(effectiveDataDir()));
}

export async function POST(req: NextRequest) {
  let body: { title?: unknown; authorPenName?: unknown };
  try {
    body = await readJson<{ title?: unknown; authorPenName?: unknown }>(req);
  } catch (err) {
    if (err instanceof JsonParseError) return fail(err.message, 400);
    throw err;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail("request body must be an object", 400);
  }
  if (!body.title || typeof body.title !== "string") return fail("title required");
  if (body.authorPenName !== undefined && typeof body.authorPenName !== "string") {
    return fail("authorPenName must be a string", 400);
  }
  const story = await createStory(effectiveDataDir(), {
    title: body.title,
    authorPenName: body.authorPenName,
  });
  return ok(story, { status: 201 });
}
