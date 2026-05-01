import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { openEpubArchive } from "@/lib/epub/unzip";
import { findOpfPath, parseOpf } from "@/lib/epub/opf";
import { parseNav } from "@/lib/epub/nav";

const FIXTURE_DIR = join(__dirname, "..", "..", "..", "lib", "epub", "__fixtures__");

async function loadParsed(fixture: string) {
  const buf = await readFile(join(FIXTURE_DIR, fixture));
  const archive = await openEpubArchive(buf);
  const opfPath = await findOpfPath(archive);
  const opf = parseOpf(await archive.readText(opfPath), opfPath);
  return { archive, opf };
}

describe("parseNav — EPUB3 nav.xhtml (KDP fixture)", () => {
  it("returns flat list of nav entries in document order", async () => {
    const { archive, opf } = await loadParsed("sample-kdp.epub");
    const entries = await parseNav(archive, opf);
    expect(entries).toHaveLength(6);
    expect(entries[0]).toMatchObject({ title: "Copyright", file: "OEBPS/copyright.xhtml" });
    expect(entries[2]).toMatchObject({ title: "Chapter 1: Arrival", file: "OEBPS/ch1.xhtml" });
    expect(entries[5]).toMatchObject({ title: "About the Author", file: "OEBPS/aboutauthor.xhtml" });
  });

  it("does not set anchor when href has no fragment", async () => {
    const { archive, opf } = await loadParsed("sample-kdp.epub");
    const entries = await parseNav(archive, opf);
    for (const e of entries) expect(e.anchor).toBeUndefined();
  });
});

describe("parseNav — EPUB3 anchors (Pattern Z fixture)", () => {
  it("splits href on '#' into file + anchor", async () => {
    const { archive, opf } = await loadParsed("sample-anchors.epub");
    const entries = await parseNav(archive, opf);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({ title: "Chapter One", file: "OEBPS/book.xhtml", anchor: "ch1" });
    expect(entries[1]).toEqual({ title: "Chapter Two", file: "OEBPS/book.xhtml", anchor: "ch2" });
    expect(entries[2]).toEqual({ title: "Chapter Three", file: "OEBPS/book.xhtml", anchor: "ch3" });
  });
});

describe("parseNav — EPUB2 toc.ncx (Smashwords fixture)", () => {
  it("returns nav entries from navMap", async () => {
    const { archive, opf } = await loadParsed("sample-smashwords.epub");
    const entries = await parseNav(archive, opf);
    expect(entries).toEqual([
      { title: "The First Letter", file: "OEBPS/ch1.xhtml" },
      { title: "The Second Letter", file: "OEBPS/ch2.xhtml" },
    ]);
  });
});

describe("parseNav — missing nav (No-Nav fixture)", () => {
  it("returns empty array when nav file is missing", async () => {
    const { archive, opf } = await loadParsed("sample-nonav.epub");
    const entries = await parseNav(archive, opf);
    expect(entries).toEqual([]);
  });
});

describe("parseNav — flattens nested <ol>", () => {
  it("treats nested nav items as a flat list in document order", async () => {
    const navXhtml = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body><nav epub:type="toc"><ol>
  <li><a href="part1.xhtml">Part One</a><ol>
    <li><a href="ch1.xhtml">Chapter 1</a></li>
    <li><a href="ch2.xhtml">Chapter 2</a></li>
  </ol></li>
  <li><a href="part2.xhtml">Part Two</a></li>
</ol></nav></body></html>`;
    const archive = {
      has: (p: string) => p === "OEBPS/nav.xhtml",
      readText: async () => navXhtml,
      readBytes: async () => new Uint8Array(),
      paths: () => ["OEBPS/nav.xhtml"],
    };
    const opf = {
      epubVersion: 3 as const,
      metadata: { title: "X", creator: "", description: "", subjects: [], language: "" },
      manifest: new Map([
        ["nav", { id: "nav", href: "OEBPS/nav.xhtml", mediaType: "application/xhtml+xml", properties: "nav" }],
      ]),
      spine: [],
      coverManifestId: null,
      opfDir: "OEBPS",
    };
    const entries = await parseNav(archive, opf);
    expect(entries.map((e) => e.title)).toEqual(["Part One", "Chapter 1", "Chapter 2", "Part Two"]);
    expect(entries[0].file).toBe("OEBPS/part1.xhtml");
    expect(entries[2].file).toBe("OEBPS/ch2.xhtml");
  });
});
