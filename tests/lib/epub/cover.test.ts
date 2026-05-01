import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { openEpubArchive } from "@/lib/epub/unzip";
import { findOpfPath, parseOpf } from "@/lib/epub/opf";
import { extractCover, sniffMime } from "@/lib/epub/cover";

const FIXTURE_DIR = join(__dirname, "..", "..", "..", "lib", "epub", "__fixtures__");

describe("sniffMime", () => {
  it("identifies JPEG via FF D8 FF", () => {
    expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe("image/jpeg");
  });

  it("identifies PNG via 89 50 4E 47", () => {
    expect(sniffMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe("image/png");
  });

  it("identifies WebP via RIFF....WEBP", () => {
    const bytes = new Uint8Array(12);
    bytes.set([0x52, 0x49, 0x46, 0x46], 0);
    bytes.set([0x57, 0x45, 0x42, 0x50], 8);
    expect(sniffMime(bytes)).toBe("image/webp");
  });

  it("returns octet-stream for unknown bytes", () => {
    expect(sniffMime(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBe("application/octet-stream");
  });

  it("returns octet-stream for too-short input", () => {
    expect(sniffMime(new Uint8Array([0xff, 0xd8]))).toBe("application/octet-stream");
  });
});

describe("extractCover", () => {
  async function loadOpf(fixture: string) {
    const buf = await readFile(join(FIXTURE_DIR, fixture));
    const archive = await openEpubArchive(buf);
    const opfPath = await findOpfPath(archive);
    const opf = parseOpf(await archive.readText(opfPath), opfPath);
    return { archive, opf };
  }

  it("returns PNG cover from KDP fixture (cover-image property)", async () => {
    const { archive, opf } = await loadOpf("sample-kdp.epub");
    const cover = await extractCover(archive, opf);
    expect(cover).not.toBeNull();
    expect(cover!.mimeType).toBe("image/png");
    expect(cover!.bytes.byteLength).toBeGreaterThan(0);
  });

  it("returns JPEG cover from Smashwords fixture (<meta name=cover>)", async () => {
    const { archive, opf } = await loadOpf("sample-smashwords.epub");
    const cover = await extractCover(archive, opf);
    expect(cover).not.toBeNull();
    expect(cover!.mimeType).toBe("image/jpeg");
  });

  it("returns null when coverManifestId is null", async () => {
    const { archive, opf } = await loadOpf("sample-nonav.epub");
    expect(opf.coverManifestId).toBeNull();
    const cover = await extractCover(archive, opf);
    expect(cover).toBeNull();
  });

  it("returns null when manifest entry exists but file is missing", async () => {
    const { opf } = await loadOpf("sample-kdp.epub");
    const fakeArchive = {
      has: () => false,
      readText: async () => "",
      readBytes: async () => new Uint8Array(),
      paths: () => [],
    };
    const cover = await extractCover(fakeArchive, opf);
    expect(cover).toBeNull();
  });
});
