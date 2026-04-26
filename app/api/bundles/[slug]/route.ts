import type { NextRequest } from "next/server";
import { ok, fail, readJson, JsonParseError } from "@/lib/api";
import {
  getBundle,
  updateBundle,
  deleteBundle,
  BundleNotFoundError,
} from "@/lib/storage/bundles";
import { effectiveDataDir } from "@/lib/config";
import type { Bundle } from "@/lib/types";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  const bundle = await getBundle(effectiveDataDir(), slug);
  if (!bundle) return fail("bundle not found", 404);
  return ok(bundle);
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;

  let body: Partial<Bundle>;
  try {
    body = await readJson<Partial<Bundle>>(req);
  } catch (err) {
    if (err instanceof JsonParseError) return fail(err.message, 400);
    throw err;
  }

  const allowed: (keyof Bundle)[] = [
    "title",
    "authorPenName",
    "description",
    "language",
    "stories",
  ];
  const patch: Partial<Bundle> = {};
  for (const k of allowed) {
    if (k in body) (patch as Record<string, unknown>)[k] = body[k];
  }

  try {
    const updated = await updateBundle(effectiveDataDir(), slug, patch);
    return ok(updated);
  } catch (err) {
    if (err instanceof BundleNotFoundError) return fail("bundle not found", 404);
    throw err;
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  const existing = await getBundle(effectiveDataDir(), slug);
  if (!existing) return fail("bundle not found", 404);
  await deleteBundle(effectiveDataDir(), slug);
  return ok({ deleted: true });
}
