import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api";
import { effectiveDataDir, loadConfig } from "@/lib/config";
import { parseEpub } from "@/lib/epub/parse";
import { mapToProposedWrite } from "@/lib/epub/map";
import { putCover } from "@/lib/epub/cover-cache";
import { EpubParseError } from "@/lib/epub/types";
import { logger } from "@/lib/logger";
import sharp from "sharp";

const PREVIEW_MAX_WIDTH = 300;

async function makeCoverPreview(bytes: Uint8Array): Promise<string | null> {
  try {
    const jpegBuf = await sharp(Buffer.from(bytes))
      .rotate()
      .resize({ width: PREVIEW_MAX_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toBuffer();
    return `data:image/jpeg;base64,${jpegBuf.toString("base64")}`;
  } catch (err) {
    logger.warn("[epub/parse] cover preview encode failed", err instanceof Error ? err.message : String(err));
    return null;
  }
}

// Note: req.formData() buffers the entire upload into memory before parseEpub's
// 50MB cap can reject it. We accept this for a single-user local app — a
// malicious 5GB upload would OOM, but there is no untrusted client here.

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("No file uploaded.", 400);
  }

  const fileEntry = form.get("file");
  if (
    fileEntry === null ||
    typeof fileEntry !== "object" ||
    typeof (fileEntry as { arrayBuffer?: unknown }).arrayBuffer !== "function"
  ) {
    return fail("No file uploaded.", 400);
  }
  const fileLike = fileEntry as { arrayBuffer(): Promise<ArrayBuffer> };
  const buf = Buffer.from(await fileLike.arrayBuffer());

  let parsed;
  try {
    parsed = await parseEpub(buf);
  } catch (err) {
    if (err instanceof EpubParseError) return fail(err.userMessage, 400);
    logger.error("[epub/parse] unexpected error", err instanceof Error ? err.message : String(err));
    return fail("Could not read this EPUB.", 400);
  }

  const config = await loadConfig(effectiveDataDir()).catch(() => null);
  const profiles = config?.penNameProfiles ?? {};
  const proposed = mapToProposedWrite(parsed, profiles);

  let sessionId = "";
  let coverPreview: string | null = null;
  if (parsed.cover) {
    sessionId = putCover(parsed.cover);
    coverPreview = await makeCoverPreview(parsed.cover.bytes);
  }

  const parsedLite = {
    metadata: parsed.metadata,
    chapters: parsed.chapters,
    epubVersion: parsed.epubVersion,
    hasCover: parsed.cover !== null,
  };
  const proposedLite = {
    story: proposed.story,
    bible: proposed.bible,
    chapters: proposed.chapters,
    penNameMatch: proposed.penNameMatch,
    hasCover: proposed.cover !== null,
  };

  return ok({ parsed: parsedLite, proposed: proposedLite, coverPreview, sessionId });
}
