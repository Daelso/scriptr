import type { NextRequest } from "next/server";
import { ok, fail, readJson, JsonParseError } from "@/lib/api";
import { createBundle, listBundles } from "@/lib/storage/bundles";
import { effectiveDataDir } from "@/lib/config";

export async function GET() {
  return ok(await listBundles(effectiveDataDir()));
}

export async function POST(req: NextRequest) {
  let body: { title?: unknown };
  try {
    body = await readJson<{ title?: unknown }>(req);
  } catch (err) {
    if (err instanceof JsonParseError) return fail(err.message, 400);
    throw err;
  }
  if (typeof body.title !== "string" || body.title.trim() === "") {
    return fail("title required");
  }
  const bundle = await createBundle(effectiveDataDir(), { title: body.title.trim() });
  return ok(bundle, { status: 201 });
}
