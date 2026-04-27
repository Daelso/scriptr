import { mkdir, writeFile, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";
import sharp from "sharp";
import { coverPath, customEpubPath, epubPath, type EpubVersion } from "@/lib/storage/paths";

export async function writeEpub(
  dataDir: string,
  slug: string,
  version: EpubVersion,
  bytes: Uint8Array,
  opts?: { outputDir?: string },
): Promise<string> {
  const finalPath = opts?.outputDir
    ? customEpubPath(opts.outputDir, slug, version)
    : epubPath(dataDir, slug, version);
  const tempPath = `${finalPath}.tmp`;
  await mkdir(dirname(finalPath), { recursive: true });
  await writeFile(tempPath, bytes);
  await rename(tempPath, finalPath);
  return finalPath;
}

export async function writeCoverJpeg(
  dataDir: string,
  slug: string,
  jpegBytes: Buffer
): Promise<string> {
  const path = coverPath(dataDir, slug);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, jpegBytes);
  return path;
}

export async function readCoverPath(
  dataDir: string,
  slug: string
): Promise<string | null> {
  const path = coverPath(dataDir, slug);
  try {
    await stat(path);
    return path;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function ensureCoverOrFallback(
  dataDir: string,
  slug: string,
  meta: { title: string; author: string }
): Promise<string> {
  const existing = await readCoverPath(dataDir, slug);
  if (existing) return existing;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="2560" viewBox="0 0 1600 2560">
  <rect width="1600" height="2560" fill="#2a2a2a"/>
  <text x="800" y="1200" text-anchor="middle" font-family="Georgia, serif" font-size="96" fill="#f5f5f5" font-weight="600">${escapeXml(meta.title)}</text>
  <text x="800" y="1360" text-anchor="middle" font-family="Georgia, serif" font-size="56" fill="#bbbbbb" font-style="italic">${escapeXml(meta.author)}</text>
</svg>`;

  let jpeg: Buffer;
  try {
    // Happy path: sharp rasterizes the SVG via librsvg.
    jpeg = await sharp(Buffer.from(svg, "utf-8")).jpeg({ quality: 88 }).toBuffer();
  } catch {
    // Fallback: sharp binary lacks SVG support on this platform (rare, but
    // musl-based CI images sometimes ship without libvips SVG bindings).
    // Produce a solid dark-grey 1600x2560 JPEG. No title text, but a valid
    // JPEG so the EPUB build doesn't fail.
    jpeg = await sharp({
      create: {
        width: 1600,
        height: 2560,
        channels: 3,
        background: { r: 0x2a, g: 0x2a, b: 0x2a },
      },
    })
      .jpeg({ quality: 88 })
      .toBuffer();
  }

  return writeCoverJpeg(dataDir, slug, jpeg);
}
