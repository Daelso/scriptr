import type { EpubArchive } from "@/lib/epub/unzip";
import type { ParsedOpf } from "@/lib/epub/opf";

export function sniffMime(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return "application/octet-stream";
}

export async function extractCover(
  archive: EpubArchive,
  opf: ParsedOpf
): Promise<{ mimeType: string; bytes: Uint8Array } | null> {
  if (!opf.coverManifestId) return null;
  const entry = opf.manifest.get(opf.coverManifestId);
  if (!entry) return null;
  if (!archive.has(entry.href)) return null;
  const bytes = await archive.readBytes(entry.href);
  return { mimeType: sniffMime(bytes), bytes };
}
