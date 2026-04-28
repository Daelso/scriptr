import { mkdir, writeFile, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";
import type { default as SharpModule } from "sharp";
import { coverPath, customEpubPath, epubPath, type EpubVersion } from "@/lib/storage/paths";
import { logger } from "@/lib/logger";

// Sharp is loaded lazily so a failure to dlopen its native binding (typical
// failure mode on Windows when the standalone build omits a libvips DLL) does
// not crash the entire EPUB export — callers get null and choose a graceful
// fallback. The cached promise is shared across calls so we only attempt the
// require once per process.
let sharpModulePromise: Promise<typeof SharpModule | null> | null = null;
function loadSharp(): Promise<typeof SharpModule | null> {
  if (!sharpModulePromise) {
    sharpModulePromise = (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require("sharp") as typeof SharpModule | { default: typeof SharpModule };
        return ("default" in mod ? mod.default : mod) as typeof SharpModule;
      } catch (err) {
        logger.error("sharp module failed to load", err instanceof Error ? err.message : String(err));
        return null;
      }
    })();
  }
  return sharpModulePromise;
}

/** True if `err` looks like the dlopen / native-binding failure mode that
 *  ships with broken sharp installs (notably Windows builds missing a
 *  libvips sibling DLL). Used by callers to surface install guidance instead
 *  of a bare 500. */
export function isSharpLoadError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ERR_DLOPEN_FAILED") return true;
  return /Could not load the "sharp" module|sharp-win32-x64\.node|libvips-\d+\.dll/i.test(err.message);
}

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

/**
 * Returns the path to a usable cover JPEG, or null if no existing cover is on
 * disk and the runtime image module (sharp / libvips) is unavailable. The
 * EPUB build accepts `cover: undefined`, so a null return cleanly degrades to
 * a coverless EPUB rather than failing the whole export.
 *
 * Historical bug: a broken sharp install (Windows standalone builds missing
 * libvips sibling DLLs) used to throw out of this function and surface as a
 * bare 500 from the export route. Now: we log + return null, the route logs
 * a warning, and the user gets a valid EPUB with no cover.
 */
export async function ensureCoverOrFallback(
  dataDir: string,
  slug: string,
  meta: { title: string; author: string }
): Promise<string | null> {
  const existing = await readCoverPath(dataDir, slug);
  if (existing) return existing;

  const sharp = await loadSharp();
  if (!sharp) return null;

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
  } catch (svgErr) {
    // Fallback: sharp binary lacks SVG support on this platform (rare, but
    // musl-based CI images sometimes ship without libvips SVG bindings).
    // Produce a solid dark-grey 1600x2560 JPEG. No title text, but a valid
    // JPEG so the EPUB build doesn't fail.
    try {
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
    } catch (createErr) {
      // Both sharp paths failed. Log both and degrade to no-cover.
      logger.error(
        "ensureCoverOrFallback: both sharp paths failed",
        svgErr instanceof Error ? svgErr.message : String(svgErr),
        createErr instanceof Error ? createErr.message : String(createErr),
      );
      return null;
    }
  }

  return writeCoverJpeg(dataDir, slug, jpeg);
}
