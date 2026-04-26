import type { NextRequest } from "next/server";
import { ok, fail, readJson } from "@/lib/api";
import { createBundle, listBundles } from "@/lib/storage/bundles";
import { effectiveDataDir } from "@/lib/config";

export async function GET() {
  return ok(await listBundles(effectiveDataDir()));
}

export async function POST(req: NextRequest) {
  const body = await readJson<{ title?: unknown }>(req);
  if (typeof body.title !== "string" || body.title.trim() === "") {
    return fail("title required");
  }
  const bundle = await createBundle(effectiveDataDir(), { title: body.title.trim() });
  return ok(bundle, { status: 201 });
}
