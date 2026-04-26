import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api";
import { getStory } from "@/lib/storage/stories";
import { listChapters } from "@/lib/storage/chapters";
import { effectiveDataDir, loadConfig } from "@/lib/config";
import { buildEpubBytes, validateEpub } from "@/lib/publish/epub";
import { resolveAuthorNote } from "@/lib/publish/author-note";
import { ensureCoverOrFallback, writeEpub } from "@/lib/publish/epub-storage";
import type { EpubVersion } from "@/lib/storage/paths";

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  const dataDir = effectiveDataDir();

  // Parse optional body { version?: 2 | 3 }. Empty body must not 400.
  let version: EpubVersion = 3;
  const rawBody = await req.text();
  if (rawBody.trim() !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return fail("invalid JSON body", 400);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return fail("request body must be an object", 400);
    }
    const body = parsed as { version?: unknown };
    if (body.version !== undefined) {
      if (body.version !== 2 && body.version !== 3) {
        return fail("version must be 2 or 3", 400);
      }
      version = body.version as EpubVersion;
    }
  }

  const story = await getStory(dataDir, slug);
  if (!story) return fail("story not found", 404);

  const chapters = await listChapters(dataDir, slug);
  if (chapters.length === 0) {
    return fail("story has no chapters to export", 400);
  }

  const coverPath = await ensureCoverOrFallback(dataDir, slug, {
    title: story.title,
    author: story.authorPenName,
  });

  const cfg = await loadConfig(dataDir);
  const profile = cfg.penNameProfiles?.[story.authorPenName];
  const authorNote = resolveAuthorNote(story, profile) ?? undefined;

  // Wrap buildEpubBytes to intercept QR-encoder overflow errors. The qrcode
  // library throws "The amount of data is too big to be stored in a QR Code"
  // when a mailing-list URL exceeds QR capacity (~2953 chars alphanumeric).
  // Surface those as a clean 400 instead of letting them 500. Other errors
  // rethrow so unrelated bugs surface normally.
  let bytes: Uint8Array;
  try {
    bytes = await buildEpubBytes({ story, chapters, coverPath, version, authorNote });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/too big to be stored in a QR/i.test(msg)) {
      return fail("mailing list URL is too long to encode as a QR code", 400);
    }
    throw err;
  }
  const { warnings: validationWarnings } = await validateEpub(bytes);
  const path = await writeEpub(dataDir, slug, version, bytes);

  return ok({ path, bytes: bytes.byteLength, version, warnings: validationWarnings });
}
