import type { NextRequest } from "next/server";
import { ok, fail, readJson, JsonParseError } from "@/lib/api";
import { effectiveDataDir } from "@/lib/config";
import { createStory, updateStory, deleteStory } from "@/lib/storage/stories";
import { createImportedChapter } from "@/lib/storage/chapters";
import { saveBible } from "@/lib/storage/bible";
import { writeCoverJpeg } from "@/lib/publish/epub-storage";
import { getCover, deleteCover } from "@/lib/epub/cover-cache";
import { EMPTY_BIBLE } from "@/lib/epub/map";
import { logger } from "@/lib/logger";
import sharp from "sharp";

type CommitRequest = {
  sessionId: string | null;
  story: { title: string; description: string; keywords: string[]; authorPenName: string };
  importCover: boolean;
  chapters: Array<{ title: string; body: string }>;
};

function isCommitRequest(v: unknown): v is CommitRequest {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (o.sessionId !== null && typeof o.sessionId !== "string") return false;
  if (typeof o.importCover !== "boolean") return false;
  if (!Array.isArray(o.chapters)) return false;
  if (!o.story || typeof o.story !== "object") return false;
  const s = o.story as Record<string, unknown>;
  if (typeof s.title !== "string") return false;
  if (typeof s.description !== "string") return false;
  if (!Array.isArray(s.keywords)) return false;
  if (typeof s.authorPenName !== "string") return false;
  return true;
}

async function transcodeIfNeeded(
  mimeType: string,
  bytes: Uint8Array
): Promise<Buffer | null> {
  if (mimeType === "image/jpeg") return Buffer.from(bytes);
  if (mimeType === "image/png" || mimeType === "image/webp") {
    try {
      return await sharp(Buffer.from(bytes)).rotate().jpeg({ quality: 92 }).toBuffer();
    } catch (err) {
      logger.warn(
        "[epub/commit] cover transcode failed, skipping cover",
        err instanceof Error ? err.message : String(err)
      );
      return null;
    }
  }
  logger.warn(`[epub/commit] cover mime ${mimeType} not supported, skipping cover`);
  return null;
}

export async function POST(req: NextRequest) {
  let parsed: unknown;
  try {
    parsed = await readJson<unknown>(req);
  } catch (err) {
    if (err instanceof JsonParseError) return fail(err.message, 400);
    throw err;
  }
  if (!isCommitRequest(parsed)) return fail("invalid request body", 400);
  const body = parsed;

  const title = body.story.title.trim();
  if (!title) return fail("title required", 400);
  if (body.chapters.length === 0) return fail("Need at least one chapter to import.", 400);
  for (let i = 0; i < body.chapters.length; i++) {
    const ch = body.chapters[i];
    if (typeof ch?.body !== "string" || ch.body.trim().length === 0) {
      return fail(`chapter ${i + 1} has empty body`, 400);
    }
    if (typeof ch.title !== "string") return fail(`chapter ${i + 1} title must be a string`, 400);
  }

  const dataDir = effectiveDataDir();
  const cacheKey = body.sessionId && body.sessionId.length > 0 ? body.sessionId : null;
  let createdSlug: string | null = null;

  try {
    const story = await createStory(dataDir, {
      title,
      authorPenName: body.story.authorPenName,
    });
    createdSlug = story.slug;

    await updateStory(dataDir, story.slug, {
      description: body.story.description,
      keywords: body.story.keywords,
    });

    await saveBible(dataDir, story.slug, EMPTY_BIBLE);

    if (body.importCover && cacheKey) {
      const cached = getCover(cacheKey);
      if (!cached) {
        logger.warn(`[epub/commit] cover-cache miss for sessionId ${cacheKey}`);
      } else {
        const jpeg = await transcodeIfNeeded(cached.mimeType, cached.bytes);
        if (jpeg) await writeCoverJpeg(dataDir, story.slug, jpeg);
      }
    }

    const chapterIds: string[] = [];
    for (const ch of body.chapters) {
      const created = await createImportedChapter(dataDir, story.slug, {
        title: (ch.title || "Untitled").trim() || "Untitled",
        sectionContents: [ch.body.trim()],
      });
      chapterIds.push(created.id);
    }

    return ok({ slug: story.slug, chapterIds });
  } catch (err) {
    let rollbackError: string | null = null;
    if (createdSlug) {
      try {
        await deleteStory(dataDir, createdSlug);
      } catch (delErr) {
        rollbackError = delErr instanceof Error ? delErr.message : String(delErr);
        logger.error(
          `[epub/commit] deleteStory rollback failed for "${createdSlug}", trying direct rm`,
          rollbackError
        );
        // Fallback: direct filesystem cleanup so a faulty storage helper
        // doesn't leave orphan dirs.
        try {
          const { rm } = await import("node:fs/promises");
          const { storyDir } = await import("@/lib/storage/paths");
          await rm(storyDir(dataDir, createdSlug), { recursive: true, force: true });
          rollbackError = null; // direct cleanup succeeded
        } catch (rmErr) {
          const rmMsg = rmErr instanceof Error ? rmErr.message : String(rmErr);
          logger.error(`[epub/commit] direct rm also failed for "${createdSlug}"`, rmMsg);
        }
      }
    }
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[epub/commit] failed", msg);
    if (rollbackError) {
      return fail(
        `Failed to write story files: ${msg}. Cleanup also failed (${rollbackError}); orphan story dir remains at "${createdSlug}" — please delete it manually before retrying.`,
        500
      );
    }
    return fail(`Failed to write story files: ${msg}`, 500);
  } finally {
    if (cacheKey) deleteCover(cacheKey);
  }
}
