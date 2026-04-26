import type { NextRequest } from "next/server";
import { ok, fail, readJson, JsonParseError } from "@/lib/api";
import {
  getBundle,
  updateBundle,
  deleteBundle,
  BundleNotFoundError,
} from "@/lib/storage/bundles";
import { effectiveDataDir } from "@/lib/config";
import { isValidSlugSegment } from "@/lib/slug";
import type { Bundle, BundleStoryRef } from "@/lib/types";

type Ctx = { params: Promise<{ slug: string }> };

function validateStoryRefs(
  input: unknown,
): { ok: true; stories: BundleStoryRef[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) {
    return { ok: false, error: "stories must be an array" };
  }

  const stories: BundleStoryRef[] = [];
  for (let i = 0; i < input.length; i++) {
    const raw = input[i];
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return { ok: false, error: `stories[${i}] must be an object` };
    }

    const ref = raw as {
      storySlug?: unknown;
      titleOverride?: unknown;
      descriptionOverride?: unknown;
    };

    if (typeof ref.storySlug !== "string" || !isValidSlugSegment(ref.storySlug)) {
      return { ok: false, error: `stories[${i}].storySlug is invalid` };
    }
    if (ref.titleOverride !== undefined && typeof ref.titleOverride !== "string") {
      return { ok: false, error: `stories[${i}].titleOverride must be a string` };
    }
    if (
      ref.descriptionOverride !== undefined &&
      typeof ref.descriptionOverride !== "string"
    ) {
      return {
        ok: false,
        error: `stories[${i}].descriptionOverride must be a string`,
      };
    }

    stories.push({
      storySlug: ref.storySlug,
      ...(ref.titleOverride !== undefined ? { titleOverride: ref.titleOverride } : {}),
      ...(ref.descriptionOverride !== undefined
        ? { descriptionOverride: ref.descriptionOverride }
        : {}),
    });
  }

  return { ok: true, stories };
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  const bundle = await getBundle(effectiveDataDir(), slug);
  if (!bundle) return fail("bundle not found", 404);
  return ok(bundle);
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;

  let body: unknown;
  try {
    body = await readJson(req);
  } catch (err) {
    if (err instanceof JsonParseError) return fail(err.message, 400);
    throw err;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail("request body must be an object", 400);
  }
  const typedBody = body as Partial<Bundle>;

  const allowed: (keyof Bundle)[] = [
    "title",
    "authorPenName",
    "description",
    "language",
    "stories",
  ];
  const patch: Partial<Bundle> = {};
  for (const k of allowed) {
    if (!(k in typedBody)) continue;

    if (k === "stories") {
      const validated = validateStoryRefs(typedBody.stories);
      if (!validated.ok) return fail(validated.error, 400);
      patch.stories = validated.stories;
      continue;
    }

    (patch as Record<string, unknown>)[k] = typedBody[k];
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
