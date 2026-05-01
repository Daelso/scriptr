import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import JSZip from "jszip";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseEpub } from "@/lib/epub/parse";
import { walkChapters } from "@/lib/epub/walk";
import { POST as commitPost } from "@/app/api/import/epub/commit/route";

const FIXTURE_DIR = join(__dirname, "..", "..", "lib", "epub", "__fixtures__");

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/import/epub/commit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("adversarial: DRM namespace handling", () => {
  it("rejects DRM even when encryption.xml uses prefixed element names", async () => {
    const base = await readFile(join(FIXTURE_DIR, "sample-kdp.epub"));
    const zip = await JSZip.loadAsync(base);
    zip.file(
      "META-INF/encryption.xml",
      `<?xml version="1.0"?>
<enc:encryption xmlns:enc="urn:oasis:names:tc:opendocument:xmlns:container">
  <enc:EncryptedData>
    <enc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/>
  </enc:EncryptedData>
</enc:encryption>`
    );
    const buf = await zip.generateAsync({ type: "nodebuffer" });

    await expect(parseEpub(buf)).rejects.toMatchObject({
      userMessage: "This EPUB is DRM-protected and cannot be imported.",
    });
  });
});

describe("adversarial: OPF namespace prefixes", () => {
  it("accepts OPF where package/metadata/manifest/spine are prefixed", async () => {
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
    zip.file(
      "META-INF/container.xml",
      `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
    );
    zip.file(
      "OEBPS/content.opf",
      `<?xml version="1.0"?>
<opf:package xmlns:opf="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <opf:metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:prefixed-opf</dc:identifier>
    <dc:title>Prefixed OPF Title</dc:title>
    <dc:creator>Prefix Author</dc:creator>
    <dc:language>en</dc:language>
  </opf:metadata>
  <opf:manifest>
    <opf:item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
  </opf:manifest>
  <opf:spine>
    <opf:itemref idref="ch1"/>
  </opf:spine>
</opf:package>`
    );
    zip.file(
      "OEBPS/ch1.xhtml",
      `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Chapter 1</h1><p>Hello world.</p></body></html>`
    );
    const buf = await zip.generateAsync({ type: "nodebuffer" });

    const parsed = await parseEpub(buf);
    expect(parsed.metadata.title).toBe("Prefixed OPF Title");
    expect(parsed.chapters).toHaveLength(1);
  });
});

describe("adversarial: chapter walker anchor failures", () => {
  it("does not backfill from start-of-body when a TOC anchor is missing", async () => {
    const xml = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body>
    <h1 id="ch1">Chapter One</h1>
    <p>Alpha section should belong only to chapter one.</p>
    <h1 id="ch2">Chapter Two</h1>
    <p>Beta section should belong only to chapter two.</p>
  </body>
</html>`;
    const archive = {
      has: (p: string) => p === "OEBPS/book.xhtml",
      readText: async () => xml,
      readBytes: async () => new Uint8Array(),
      paths: () => ["OEBPS/book.xhtml"],
    };
    const opf = {
      epubVersion: 3 as const,
      metadata: { title: "X", creator: "", description: "", subjects: [], language: "" },
      manifest: new Map(),
      spine: [],
      coverManifestId: null,
      opfDir: "OEBPS",
    };
    const nav = [
      { title: "Broken Anchor", file: "OEBPS/book.xhtml", anchor: "missing-anchor" },
      { title: "Chapter Two", file: "OEBPS/book.xhtml", anchor: "ch2" },
    ];

    const chapters = await walkChapters(archive, opf, nav);
    expect(chapters).toHaveLength(2);
    expect(chapters[0].wordCount).toBe(0);
    expect(chapters[0].skippedByDefault).toBe(true);
  });
});

describe("adversarial: commit rollback cleanup", () => {
  let dataDir = "";
  let originalEnv: string | undefined;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "scriptr-epub-rollback-"));
    originalEnv = process.env.SCRIPTR_DATA_DIR;
    process.env.SCRIPTR_DATA_DIR = dataDir;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (originalEnv === undefined) delete process.env.SCRIPTR_DATA_DIR;
    else process.env.SCRIPTR_DATA_DIR = originalEnv;
    await rm(dataDir, { recursive: true, force: true });
  });

  it("leaves no orphan story directory when rollback delete fails", async () => {
    const chaptersMod = await import("@/lib/storage/chapters");
    const storiesMod = await import("@/lib/storage/stories");

    vi.spyOn(chaptersMod, "createImportedChapter").mockRejectedValueOnce(new Error("disk full"));
    vi.spyOn(storiesMod, "deleteStory").mockRejectedValueOnce(new Error("EACCES"));

    const res = await commitPost(
      jsonRequest({
        sessionId: null,
        story: { title: "Rollback Test", description: "", keywords: [], authorPenName: "" },
        importCover: false,
        chapters: [{ title: "Ch1", body: "Some body text." }],
      }) as never
    );
    expect(res.status).toBe(500);

    const dirs = await readdir(join(dataDir, "stories")).catch(() => []);
    expect(dirs).toEqual([]);
  });
});
