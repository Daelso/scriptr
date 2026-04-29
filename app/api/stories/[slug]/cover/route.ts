import type { NextRequest } from "next/server";
import { readFile } from "node:fs/promises";
import { ok, fail } from "@/lib/api";
import { getStory } from "@/lib/storage/stories";
import { effectiveDataDir } from "@/lib/config";
import { coverPath } from "@/lib/storage/paths";
import { writeCoverJpeg } from "@/lib/publish/epub-storage";
import sharp from "sharp";

type Ctx = { params: Promise<{ slug: string }> };

const MAX_BYTES = 20 * 1024 * 1024;
const ACCEPTED = new Set(["image/jpeg", "image/png"]);

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  const dataDir = effectiveDataDir();

  const story = await getStory(dataDir, slug);
  if (!story) return fail("story not found", 404);

  let bytes: Buffer;
  try {
    bytes = await readFile(coverPath(dataDir, slug));
  } catch {
    return fail("cover not found", 404);
  }

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": "image/jpeg",
      "cache-control": "no-store",
    },
  });
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  const dataDir = effectiveDataDir();

  const story = await getStory(dataDir, slug);
  if (!story) return fail("story not found", 404);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("expected multipart/form-data body");
  }

  const entry = form.get("cover");
  if (!(entry instanceof File)) {
    return fail("missing 'cover' field");
  }
  if (!ACCEPTED.has(entry.type)) {
    return fail(`unsupported image type: ${entry.type}`, 415);
  }
  if (entry.size > MAX_BYTES) {
    return fail("cover exceeds 20 MB limit", 413);
  }

  const inputBytes = Buffer.from(await entry.arrayBuffer());
  let jpegBytes: Buffer;
  try {
    // Always run through sharp so JPEG uploads also get EXIF orientation
    // normalized into pixel data.
    jpegBytes = await sharp(inputBytes).rotate().jpeg({ quality: 92 }).toBuffer();
  } catch {
    return fail("invalid image data", 400);
  }

  const path = await writeCoverJpeg(dataDir, slug, jpegBytes);

  const warnings: string[] = [];
  try {
    const meta = await sharp(jpegBytes).metadata();
    if ((meta.width ?? 0) < 1600 || (meta.height ?? 0) < 2560) {
      warnings.push(
        `Cover is ${meta.width}x${meta.height}; KDP recommends at least 1600x2560.`
      );
    }
  } catch {
    /* ignore metadata failures */
  }

  return ok({ path, warnings });
}
