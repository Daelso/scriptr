import type { NextRequest } from "next/server";
import { mkdir, writeFile, rename, stat } from "node:fs/promises";
import { ok, fail } from "@/lib/api";
import { getBundle } from "@/lib/storage/bundles";
import { getStory } from "@/lib/storage/stories";
import { listChapters } from "@/lib/storage/chapters";
import { isValidSlugSegment } from "@/lib/slug";
import { effectiveDataDir, loadConfig } from "@/lib/config";
import { buildBundleEpubBytes, type ResolvedStory } from "@/lib/publish/epub-bundle";
import { validateEpub } from "@/lib/publish/epub";
import { resolveBundleAuthorNote } from "@/lib/publish/author-note";
import {
  bundleCoverPath,
  bundleEpubPath,
  bundleExportsDir,
  type EpubVersion,
} from "@/lib/storage/paths";

type Ctx = { params: Promise<{ slug: string }> };

type StoryResolutionResult =
  | { kind: "invalid-slug"; storySlug: string }
  | { kind: "missing-story"; storySlug: string }
  | { kind: "no-chapters"; storySlug: string }
  | { kind: "ok"; storySlug: string; resolved: ResolvedStory };

export async function POST(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  const dataDir = effectiveDataDir();

  // Optional version body. Empty body is OK.
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

  const bundle = await getBundle(dataDir, slug);
  if (!bundle) return fail("bundle not found", 404);
  if (bundle.stories.length === 0) {
    return fail("bundle has no stories", 400);
  }

  const resolutionResults = await Promise.all(
    bundle.stories.map(async (ref): Promise<StoryResolutionResult> => {
      if (!isValidSlugSegment(ref.storySlug)) {
        return { kind: "invalid-slug", storySlug: ref.storySlug };
      }

      const story = await getStory(dataDir, ref.storySlug);
      if (!story) {
        return { kind: "missing-story", storySlug: ref.storySlug };
      }

      const chapters = await listChapters(dataDir, ref.storySlug);
      if (chapters.length === 0) {
        return { kind: "no-chapters", storySlug: ref.storySlug };
      }

      return {
        kind: "ok",
        storySlug: ref.storySlug,
        resolved: { story, chapters },
      };
    }),
  );

  const resolved = new Map<string, ResolvedStory>();
  const warnings: string[] = [];
  for (const result of resolutionResults) {
    if (result.kind === "ok") {
      resolved.set(result.storySlug, result.resolved);
      continue;
    }
    if (result.kind === "invalid-slug") {
      warnings.push(`Invalid story slug: ${result.storySlug} (omitted from build)`);
      continue;
    }
    if (result.kind === "missing-story") {
      warnings.push(`Missing story: ${result.storySlug} (omitted from build)`);
      continue;
    }
    warnings.push(`Story has no chapters: ${result.storySlug} (omitted from build)`);
  }

  if (resolved.size === 0) {
    return fail("bundle has no resolvable stories", 400);
  }

  // Cover (optional). No fallback to a member story's cover by design.
  let coverPath: string | undefined;
  try {
    const cp = bundleCoverPath(dataDir, slug);
    await stat(cp);
    coverPath = cp;
  } catch {
    coverPath = undefined;
  }

  // Author note (optional). Resolved from the pen-name profile keyed off
  // bundle.authorPenName — bundles do not have a per-bundle override field,
  // so this uses the profile's defaultMessageHtml directly.
  const cfg = await loadConfig(dataDir);
  const profile = cfg.penNameProfiles?.[bundle.authorPenName];
  const authorNote = resolveBundleAuthorNote(profile) ?? undefined;

  // Same QR-overflow guard the single-story export route uses: the qrcode
  // library throws "The amount of data is too big to be stored in a QR Code"
  // when a mailing-list URL exceeds capacity. Surface that as a 400 instead
  // of letting it 500. Other errors propagate.
  let bytes: Uint8Array;
  try {
    bytes = await buildBundleEpubBytes({
      bundle,
      stories: resolved,
      coverPath,
      version,
      authorNote,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/too big to be stored in a QR/i.test(msg)) {
      return fail("mailing list URL is too long to encode as a QR code", 400);
    }
    throw err;
  }

  const { warnings: validationWarnings } = await validateEpub(bytes);

  // Write to <bundle>/exports/<slug>-epub<v>.epub atomically.
  const finalPath = bundleEpubPath(dataDir, slug, version);
  const tempPath = `${finalPath}.tmp`;
  await mkdir(bundleExportsDir(dataDir, slug), { recursive: true });
  await writeFile(tempPath, bytes);
  await rename(tempPath, finalPath);

  return ok({
    path: finalPath,
    bytes: bytes.byteLength,
    version,
    warnings: [...warnings, ...validationWarnings],
  });
}
