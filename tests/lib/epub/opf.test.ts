import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { openEpubArchive } from "@/lib/epub/unzip";
import { findOpfPath, parseOpf } from "@/lib/epub/opf";
import { EpubParseError } from "@/lib/epub/types";

const FIXTURE_DIR = join(__dirname, "..", "..", "..", "lib", "epub", "__fixtures__");

async function loadOpf(fixture: string) {
  const buf = await readFile(join(FIXTURE_DIR, fixture));
  const archive = await openEpubArchive(buf);
  const opfPath = await findOpfPath(archive);
  const opfXml = await archive.readText(opfPath);
  return { archive, opfPath, opf: parseOpf(opfXml, opfPath) };
}

describe("findOpfPath", () => {
  it("reads container.xml and returns the rootfile full-path", async () => {
    const buf = await readFile(join(FIXTURE_DIR, "sample-kdp.epub"));
    const archive = await openEpubArchive(buf);
    expect(await findOpfPath(archive)).toBe("OEBPS/content.opf");
  });

  it("throws if container.xml is missing", async () => {
    const archive = {
      has: () => false,
      readText: async () => "",
      readBytes: async () => new Uint8Array(),
      paths: () => [],
    };
    await expect(findOpfPath(archive)).rejects.toMatchObject({
      userMessage: "Missing container.xml — not an EPUB.",
    });
  });
});

describe("parseOpf — metadata (EPUB3, KDP fixture)", () => {
  it("extracts title, creator, description, language", async () => {
    const { opf } = await loadOpf("sample-kdp.epub");
    expect(opf.metadata.title).toBe("The Garden Wall");
    expect(opf.metadata.creator).toBe("Jane Author");
    expect(opf.metadata.description).toBe("A short synthetic EPUB3 for tests.");
    expect(opf.metadata.language).toBe("en");
  });

  it("collects multiple dc:subject entries into subjects[]", async () => {
    const { opf } = await loadOpf("sample-kdp.epub");
    expect(opf.metadata.subjects).toEqual(["FIC027010", "romance"]);
  });

  it("reports epubVersion=3", async () => {
    const { opf } = await loadOpf("sample-kdp.epub");
    expect(opf.epubVersion).toBe(3);
  });
});

describe("parseOpf — manifest + spine", () => {
  it("returns manifest as a map with hrefs resolved relative to OPF dir", async () => {
    const { opf } = await loadOpf("sample-kdp.epub");
    expect(opf.manifest.get("ch1")?.href).toBe("OEBPS/ch1.xhtml");
    expect(opf.manifest.get("ch1")?.mediaType).toBe("application/xhtml+xml");
    expect(opf.manifest.get("nav")?.properties).toContain("nav");
  });

  it("returns spine as ordered idref array", async () => {
    const { opf } = await loadOpf("sample-kdp.epub");
    expect(opf.spine).toEqual(["copyright", "title", "ch1", "ch2", "ch3", "aboutauthor"]);
  });
});

describe("parseOpf — cover lookup (EPUB3 properties=cover-image)", () => {
  it("finds cover via manifest item with properties=cover-image", async () => {
    const { opf } = await loadOpf("sample-kdp.epub");
    expect(opf.coverManifestId).toBe("cover");
  });
});

describe("parseOpf — EPUB2 fixture (toc.ncx + meta cover)", () => {
  it("reports epubVersion=2", async () => {
    const { opf } = await loadOpf("sample-smashwords.epub");
    expect(opf.epubVersion).toBe(2);
  });

  it("finds cover via <meta name=cover content=ID/>", async () => {
    const { opf } = await loadOpf("sample-smashwords.epub");
    expect(opf.coverManifestId).toBe("cover-img");
  });

  it("strips opf:role from creator", async () => {
    const { opf } = await loadOpf("sample-smashwords.epub");
    expect(opf.metadata.creator).toBe("J. K. Author");
  });
});

describe("parseOpf — error conditions", () => {
  it("throws on unsupported version", () => {
    const xml = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="1.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>X</dc:title></metadata>
  <manifest/><spine/>
</package>`;
    expect(() => parseOpf(xml, "OEBPS/content.opf")).toThrow(EpubParseError);
    expect(() => parseOpf(xml, "OEBPS/content.opf")).toThrow(/Unsupported EPUB version/);
  });

  it("throws on missing title", () => {
    const xml = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"></metadata>
  <manifest/><spine/>
</package>`;
    expect(() => parseOpf(xml, "OEBPS/content.opf")).toThrow(/no title/i);
  });
});
