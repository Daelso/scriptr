import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { openEpubArchive } from "@/lib/epub/unzip";
import { EpubParseError } from "@/lib/epub/types";

const FIXTURE_DIR = join(__dirname, "..", "..", "..", "lib", "epub", "__fixtures__");

describe("openEpubArchive", () => {
  it("rejects non-zip input", async () => {
    const buf = Buffer.from("this is not a zip file at all");
    await expect(openEpubArchive(buf)).rejects.toBeInstanceOf(EpubParseError);
    await expect(openEpubArchive(buf)).rejects.toMatchObject({
      userMessage: "File is not a valid EPUB (could not unzip).",
    });
  });

  it("returns an archive with readText/readBytes/has methods", async () => {
    const buf = await readFile(join(FIXTURE_DIR, "sample-kdp.epub"));
    const archive = await openEpubArchive(buf);
    expect(typeof archive.readText).toBe("function");
    expect(typeof archive.readBytes).toBe("function");
    expect(typeof archive.has).toBe("function");
  });

  it("reads the mimetype file as text", async () => {
    const buf = await readFile(join(FIXTURE_DIR, "sample-kdp.epub"));
    const archive = await openEpubArchive(buf);
    const mimetype = await archive.readText("mimetype");
    expect(mimetype.trim()).toBe("application/epub+zip");
  });

  it("reads container.xml as text", async () => {
    const buf = await readFile(join(FIXTURE_DIR, "sample-kdp.epub"));
    const archive = await openEpubArchive(buf);
    const xml = await archive.readText("META-INF/container.xml");
    expect(xml).toContain("OEBPS/content.opf");
  });

  it("reads cover image as bytes", async () => {
    const buf = await readFile(join(FIXTURE_DIR, "sample-kdp.epub"));
    const archive = await openEpubArchive(buf);
    const bytes = await archive.readBytes("OEBPS/cover.png");
    expect(bytes.byteLength).toBeGreaterThan(0);
    // PNG magic: 89 50 4E 47
    expect(bytes[0]).toBe(0x89);
    expect(bytes[1]).toBe(0x50);
  });

  it("has() returns true for present paths and false for absent", async () => {
    const buf = await readFile(join(FIXTURE_DIR, "sample-kdp.epub"));
    const archive = await openEpubArchive(buf);
    expect(archive.has("mimetype")).toBe(true);
    expect(archive.has("nope/nonexistent.xhtml")).toBe(false);
  });

  it("readText throws if the path is missing", async () => {
    const buf = await readFile(join(FIXTURE_DIR, "sample-kdp.epub"));
    const archive = await openEpubArchive(buf);
    await expect(archive.readText("nope.xhtml")).rejects.toThrow(/not found/i);
  });
});
