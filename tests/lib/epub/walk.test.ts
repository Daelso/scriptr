import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { openEpubArchive } from "@/lib/epub/unzip";
import { findOpfPath, parseOpf } from "@/lib/epub/opf";
import { parseNav } from "@/lib/epub/nav";
import { walkChapters } from "@/lib/epub/walk";

const FIXTURE_DIR = join(__dirname, "..", "..", "..", "lib", "epub", "__fixtures__");

async function loadAll(fixture: string) {
  const buf = await readFile(join(FIXTURE_DIR, fixture));
  const archive = await openEpubArchive(buf);
  const opfPath = await findOpfPath(archive);
  const opf = parseOpf(await archive.readText(opfPath), opfPath);
  const nav = await parseNav(archive, opf);
  return { archive, opf, nav };
}

describe("walkChapters — Pattern X (KDP fixture, 1 file per chapter)", () => {
  it("produces one ChapterDraft per nav entry, source='nav'", async () => {
    const { archive, opf, nav } = await loadAll("sample-kdp.epub");
    const chapters = await walkChapters(archive, opf, nav);
    expect(chapters).toHaveLength(6);
    expect(chapters[0].source).toBe("nav");
  });

  it("preserves nav titles and uses sourceHref for the file", async () => {
    const { archive, opf, nav } = await loadAll("sample-kdp.epub");
    const chapters = await walkChapters(archive, opf, nav);
    expect(chapters[2].navTitle).toBe("Chapter 1: Arrival");
    expect(chapters[2].sourceHref).toBe("OEBPS/ch1.xhtml");
  });

  it("body is markdown with paragraphs separated by blank lines", async () => {
    const { archive, opf, nav } = await loadAll("sample-kdp.epub");
    const chapters = await walkChapters(archive, opf, nav);
    const ch1 = chapters[2];
    expect(ch1.body).toContain("Mira stepped through the gate");
    expect(ch1.body).toContain("\n\n");
    expect(ch1.body).toContain("Chapter 1: Arrival");
  });

  it("populates wordCount", async () => {
    const { archive, opf, nav } = await loadAll("sample-kdp.epub");
    const chapters = await walkChapters(archive, opf, nav);
    expect(chapters[2].wordCount).toBeGreaterThan(0);
  });
});

describe("walkChapters — Pattern Z (anchors fixture)", () => {
  it("slices content between consecutive anchors in the same file", async () => {
    const { archive, opf, nav } = await loadAll("sample-anchors.epub");
    const chapters = await walkChapters(archive, opf, nav);
    expect(chapters).toHaveLength(3);
    expect(chapters[0].body).toContain("first chapter is brief");
    expect(chapters[0].body).not.toContain("second chapter introduces");
    expect(chapters[1].body).toContain("second chapter introduces");
    expect(chapters[1].body).not.toContain("third chapter resolves");
    expect(chapters[2].body).toContain("third chapter resolves");
  });
});

describe("walkChapters — spine fallback (No-Nav fixture)", () => {
  it("returns one chapter per spine item when nav is empty", async () => {
    const { archive, opf, nav } = await loadAll("sample-nonav.epub");
    expect(nav).toEqual([]);
    const chapters = await walkChapters(archive, opf, nav);
    expect(chapters).toHaveLength(2);
    expect(chapters[0].source).toBe("spine");
  });

  it("titles chapters from the first <h1> in spine fallback", async () => {
    const { archive, opf, nav } = await loadAll("sample-nonav.epub");
    const chapters = await walkChapters(archive, opf, nav);
    expect(chapters[0].navTitle).toBe("Opening");
    expect(chapters[1].navTitle).toBe("Closing");
  });
});

describe("walkChapters — missing nav-target file", () => {
  it("skips entries whose file is not in the archive", async () => {
    const { archive, opf } = await loadAll("sample-kdp.epub");
    const fakeNav = [
      { title: "Real", file: "OEBPS/ch1.xhtml" },
      { title: "Ghost", file: "OEBPS/does-not-exist.xhtml" },
      { title: "Real 2", file: "OEBPS/ch2.xhtml" },
    ];
    const chapters = await walkChapters(archive, opf, fakeNav);
    expect(chapters).toHaveLength(2);
    expect(chapters.map((c) => c.navTitle)).toEqual(["Real", "Real 2"]);
  });
});

describe("walkChapters — cross-file boundary", () => {
  it("when next nav entry is in a DIFFERENT file, slice runs to end-of-body of current file", async () => {
    const { archive, opf } = await loadAll("sample-anchors.epub");
    const nav = [
      { title: "Anchored", file: "OEBPS/book.xhtml", anchor: "ch2" },
      { title: "Elsewhere", file: "OEBPS/nav.xhtml" },
    ];
    const chapters = await walkChapters(archive, opf, nav);
    expect(chapters).toHaveLength(2);
    expect(chapters[0].body).toContain("second chapter introduces");
    expect(chapters[0].body).toContain("third chapter resolves");
  });
});

describe("walkChapters — empty body", () => {
  it("flags empty chapters as skippedByDefault with reason 'Empty chapter'", async () => {
    const xml = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><img src="x.png"/></body></html>`;
    const archive = {
      has: (p: string) => p === "OEBPS/empty.xhtml",
      readText: async () => xml,
      readBytes: async () => new Uint8Array(),
      paths: () => ["OEBPS/empty.xhtml"],
    };
    const opf = {
      epubVersion: 3 as const,
      metadata: { title: "X", creator: "", description: "", subjects: [], language: "" },
      manifest: new Map(),
      spine: [],
      coverManifestId: null,
      opfDir: "OEBPS",
    };
    const nav = [{ title: "Empty", file: "OEBPS/empty.xhtml" }];
    const chapters = await walkChapters(archive, opf, nav);
    expect(chapters).toHaveLength(1);
    expect(chapters[0].skippedByDefault).toBe(true);
    expect(chapters[0].skipReason).toBe("Empty chapter");
  });
});
