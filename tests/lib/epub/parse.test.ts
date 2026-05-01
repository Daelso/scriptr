import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseEpub } from "@/lib/epub/parse";

const FIXTURE_DIR = join(__dirname, "..", "..", "..", "lib", "epub", "__fixtures__");

describe("parseEpub — happy paths", () => {
  it("KDP fixture: 6 chapters, EPUB3, cover present, boilerplate flagged", async () => {
    const buf = await readFile(join(FIXTURE_DIR, "sample-kdp.epub"));
    const parsed = await parseEpub(buf);
    expect(parsed.epubVersion).toBe(3);
    expect(parsed.chapters).toHaveLength(6);
    expect(parsed.cover?.mimeType).toBe("image/png");
    const flagged = parsed.chapters.filter((c) => c.skippedByDefault);
    expect(flagged.map((c) => c.navTitle)).toEqual([
      "Copyright",
      "Title Page",
      "About the Author",
    ]);
  });

  it("Smashwords fixture: 2 chapters, EPUB2, JPEG cover", async () => {
    const buf = await readFile(join(FIXTURE_DIR, "sample-smashwords.epub"));
    const parsed = await parseEpub(buf);
    expect(parsed.epubVersion).toBe(2);
    expect(parsed.chapters).toHaveLength(2);
    expect(parsed.cover?.mimeType).toBe("image/jpeg");
  });

  it("No-Nav fixture: spine fallback, source=spine", async () => {
    const buf = await readFile(join(FIXTURE_DIR, "sample-nonav.epub"));
    const parsed = await parseEpub(buf);
    expect(parsed.chapters).toHaveLength(2);
    expect(parsed.chapters.every((c) => c.source === "spine")).toBe(true);
  });
});

describe("parseEpub — error conditions", () => {
  it("rejects oversized files", async () => {
    const buf = Buffer.alloc(50 * 1024 * 1024 + 1);
    await expect(parseEpub(buf)).rejects.toMatchObject({
      userMessage: "File too large (limit 50MB).",
    });
  });

  it("rejects empty buffer", async () => {
    await expect(parseEpub(Buffer.alloc(0))).rejects.toMatchObject({
      userMessage: "No file uploaded.",
    });
  });

  it("rejects DRM-encrypted EPUB (encryption.xml with non-font algorithm)", async () => {
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
    zip.file(
      "META-INF/container.xml",
      `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
    );
    zip.file(
      "META-INF/encryption.xml",
      `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/></EncryptedData></encryption>`
    );
    zip.file("OEBPS/content.opf", "<package version='3.0'/>");
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    await expect(parseEpub(buf)).rejects.toMatchObject({
      userMessage: "This EPUB is DRM-protected and cannot be imported.",
    });
  });

  it("ALLOWS encryption.xml for Adobe font obfuscation only", async () => {
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
    zip.file(
      "META-INF/container.xml",
      `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
    );
    zip.file(
      "META-INF/encryption.xml",
      `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData><EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/></EncryptedData></encryption>`
    );
    const realBuf = await readFile(join(FIXTURE_DIR, "sample-kdp.epub"));
    const real = await JSZip.loadAsync(realBuf);
    for (const path of Object.keys(real.files)) {
      if (path === "mimetype" || path.startsWith("META-INF/")) continue;
      const f = real.file(path);
      if (!f) continue;
      zip.file(path, await f.async("uint8array"));
    }
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    const parsed = await parseEpub(buf);
    expect(parsed.chapters.length).toBeGreaterThan(0);
  });

  it("rejects non-EPUB zip (no container.xml)", async () => {
    const zip = new JSZip();
    zip.file("hello.txt", "world");
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    await expect(parseEpub(buf)).rejects.toMatchObject({
      userMessage: "Missing container.xml — not an EPUB.",
    });
  });

  it("rejects when chapter walk produces zero entries", async () => {
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
    zip.file(
      "META-INF/container.xml",
      `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
    );
    zip.file(
      "OEBPS/content.opf",
      `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Empty</dc:title></metadata><manifest/><spine/></package>`
    );
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    await expect(parseEpub(buf)).rejects.toMatchObject({
      userMessage: "This EPUB has no readable content (empty spine).",
    });
  });

  it("rejects EPUBs with more than 200 chapters", async () => {
    const items: string[] = [];
    const itemrefs: string[] = [];
    for (let i = 0; i < 201; i++) {
      items.push(`<item id="ch${i}" href="ch${i}.xhtml" media-type="application/xhtml+xml"/>`);
      itemrefs.push(`<itemref idref="ch${i}"/>`);
    }
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
    zip.file(
      "META-INF/container.xml",
      `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
    );
    zip.file(
      "OEBPS/content.opf",
      `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Big</dc:title></metadata><manifest>${items.join("")}</manifest><spine>${itemrefs.join("")}</spine></package>`
    );
    for (let i = 0; i < 201; i++) {
      zip.file(
        `OEBPS/ch${i}.xhtml`,
        `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><p>x</p></body></html>`
      );
    }
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    await expect(parseEpub(buf)).rejects.toMatchObject({
      userMessage: "This EPUB has more than 200 chapters — please split it before importing.",
    });
  });
});
