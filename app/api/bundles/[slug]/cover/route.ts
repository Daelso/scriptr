import type { NextRequest } from "next/server";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import sharp from "sharp";
import { ok, fail } from "@/lib/api";
import { getBundle } from "@/lib/storage/bundles";
import { bundleCoverPath } from "@/lib/storage/paths";
import { effectiveDataDir } from "@/lib/config";

type Ctx = { params: Promise<{ slug: string }> };

const MAX_BYTES = 20 * 1024 * 1024;
const ACCEPTED = new Set(["image/jpeg", "image/png"]);

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  const dataDir = effectiveDataDir();

  const bundle = await getBundle(dataDir, slug);
  if (!bundle) return fail("bundle not found", 404);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("expected multipart/form-data body");
  }

  const entry = form.get("cover");
  if (!(entry instanceof File)) return fail("missing 'cover' field");
  if (!ACCEPTED.has(entry.type)) return fail(`unsupported image type: ${entry.type}`, 415);
  if (entry.size > MAX_BYTES) return fail("cover exceeds 20 MB limit", 413);

  const inputBytes = Buffer.from(await entry.arrayBuffer());
  let jpegBytes: Buffer;
  try {
    // Always decode + rotate so EXIF orientation is normalized for JPEG
    // uploads too. Corrupt bytes should be a 400, not a 500.
    jpegBytes = await sharp(inputBytes).rotate().jpeg({ quality: 92 }).toBuffer();
  } catch {
    return fail("invalid image data", 400);
  }

  const path = bundleCoverPath(dataDir, slug);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, jpegBytes);

  const warnings: string[] = [];
  try {
    const meta = await sharp(jpegBytes).metadata();
    if ((meta.width ?? 0) < 1600 || (meta.height ?? 0) < 2560) {
      warnings.push(
        `Cover is ${meta.width}x${meta.height}; KDP recommends at least 1600x2560.`,
      );
    }
  } catch {
    /* ignore metadata failures */
  }

  return ok({ path, warnings });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  const dataDir = effectiveDataDir();

  const bundle = await getBundle(dataDir, slug);
  if (!bundle) return fail("bundle not found", 404);

  await rm(bundleCoverPath(dataDir, slug), { force: true });
  return ok({ deleted: true });
}
