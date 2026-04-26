import type { NextRequest } from "next/server";
import { ok, fail, readJson } from "@/lib/api";
import {
  getStory,
  updateStory,
  deleteStory,
  StoryNotFoundError,
} from "@/lib/storage/stories";
import { effectiveDataDir } from "@/lib/config";
import type { Story } from "@/lib/types";

type Ctx = { params: Promise<{ slug: string }> };

function hasOwn<T extends object, K extends PropertyKey>(
  obj: T,
  key: K,
): obj is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseAuthorNote(
  value: unknown,
): { ok: true; value: Story["authorNote"] } | { ok: false; error: string } {
  if (value === null) return { ok: true, value: undefined };
  if (!isPlainObject(value)) {
    return { ok: false, error: "authorNote must be an object" };
  }
  if (!hasOwn(value, "enabled") || typeof value.enabled !== "boolean") {
    return { ok: false, error: "authorNote.enabled must be a boolean" };
  }
  const out: NonNullable<Story["authorNote"]> = { enabled: value.enabled };
  if (hasOwn(value, "messageHtml")) {
    if (value.messageHtml === null || value.messageHtml === undefined) {
      // explicit null/undefined clears message override
    } else if (typeof value.messageHtml === "string") {
      out.messageHtml = value.messageHtml;
    } else {
      return { ok: false, error: "authorNote.messageHtml must be a string" };
    }
  }
  return { ok: true, value: out };
}

function parseStoryPatch(
  value: unknown,
): { ok: true; patch: Partial<Story> } | { ok: false; error: string } {
  if (!isPlainObject(value)) {
    return { ok: false, error: "invalid story patch payload" };
  }
  const patch: Partial<Story> = {};
  const body = value;

  type RequiredStringStoryKey =
    | "title"
    | "authorPenName"
    | "description"
    | "language"
    | "bisacCategory";
  const requiredStrings: RequiredStringStoryKey[] = [
    "title",
    "authorPenName",
    "description",
    "language",
    "bisacCategory",
  ];
  for (const key of requiredStrings) {
    if (!hasOwn(body, key)) continue;
    if (typeof body[key] !== "string") {
      return { ok: false, error: `${String(key)} must be a string` };
    }
    patch[key] = body[key];
  }

  type OptionalStringStoryKey = "subtitle" | "isbn" | "modelOverride";
  const optionalStrings: OptionalStringStoryKey[] = ["subtitle", "isbn", "modelOverride"];
  for (const key of optionalStrings) {
    if (!hasOwn(body, key)) continue;
    if (body[key] === null || body[key] === undefined) {
      patch[key] = undefined;
      continue;
    }
    if (typeof body[key] !== "string") {
      return { ok: false, error: `${String(key)} must be a string` };
    }
    patch[key] = body[key];
  }

  if (hasOwn(body, "copyrightYear")) {
    if (
      typeof body.copyrightYear !== "number"
      || !Number.isInteger(body.copyrightYear)
      || body.copyrightYear <= 0
    ) {
      return { ok: false, error: "copyrightYear must be a positive integer" };
    }
    patch.copyrightYear = body.copyrightYear;
  }

  if (hasOwn(body, "keywords")) {
    if (
      !Array.isArray(body.keywords)
      || !body.keywords.every((k) => typeof k === "string")
    ) {
      return { ok: false, error: "keywords must be an array of strings" };
    }
    patch.keywords = body.keywords;
  }

  if (hasOwn(body, "authorNote")) {
    const parsed = parseAuthorNote(body.authorNote);
    if (!parsed.ok) return parsed;
    patch.authorNote = parsed.value;
  }

  return { ok: true, patch };
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  const story = await getStory(effectiveDataDir(), slug);
  if (!story) return fail("story not found", 404);
  return ok(story);
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  const body = await readJson<unknown>(req);
  const parsed = parseStoryPatch(body);
  if (!parsed.ok) return fail(parsed.error, 400);
  try {
    const updated = await updateStory(effectiveDataDir(), slug, parsed.patch);
    return ok(updated);
  } catch (err) {
    if (err instanceof StoryNotFoundError) {
      return fail("story not found", 404);
    }
    throw err;
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  const existing = await getStory(effectiveDataDir(), slug);
  if (!existing) return fail("story not found", 404);
  await deleteStory(effectiveDataDir(), slug);
  return ok({ deleted: true });
}
