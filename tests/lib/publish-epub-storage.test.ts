import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStory } from "@/lib/storage/stories";
import {
  writeEpub,
  readCoverPath,
  writeCoverJpeg,
  ensureCoverOrFallback,
} from "@/lib/publish/epub-storage";

describe("epub-storage", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "scriptr-epub-storage-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writeEpub writes atomically to exports/<slug>-epub3.epub", async () => {
    const story = await createStory(dir, { title: "Book" });
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
    const path = await writeEpub(dir, story.slug, 3, bytes);
    expect(path.endsWith(`/exports/${story.slug}-epub3.epub`)).toBe(true);
    const stats = await stat(path);
    expect(stats.size).toBe(bytes.length);
  });

  it("writeEpub with version 2 writes to exports/<slug>-epub2.epub", async () => {
    const story = await createStory(dir, { title: "Book" });
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
    const path = await writeEpub(dir, story.slug, 2, bytes);
    expect(path.endsWith(`/exports/${story.slug}-epub2.epub`)).toBe(true);
    const stats = await stat(path);
    expect(stats.size).toBe(bytes.length);
  });

  it("writeEpub epub2 and epub3 coexist on disk without clobbering each other", async () => {
    const story = await createStory(dir, { title: "Book" });
    const bytes2 = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 2]);
    const bytes3 = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 3]);
    const path2 = await writeEpub(dir, story.slug, 2, bytes2);
    const path3 = await writeEpub(dir, story.slug, 3, bytes3);
    expect(path2).not.toBe(path3);
    const stats2 = await stat(path2);
    const stats3 = await stat(path3);
    expect(stats2.size).toBe(bytes2.length);
    expect(stats3.size).toBe(bytes3.length);
  });

  it("writeCoverJpeg writes a JPEG file", async () => {
    const story = await createStory(dir, { title: "B" });
    const tinyJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const path = await writeCoverJpeg(dir, story.slug, tinyJpeg);
    expect(path.endsWith("/cover.jpg")).toBe(true);
    const written = await readFile(path);
    expect(written.length).toBeGreaterThan(0);
  });

  it("readCoverPath returns null when no cover on disk", async () => {
    const story = await createStory(dir, { title: "B" });
    const path = await readCoverPath(dir, story.slug);
    expect(path).toBeNull();
  });

  it("readCoverPath returns the path when a cover exists", async () => {
    const story = await createStory(dir, { title: "B" });
    await writeCoverJpeg(dir, story.slug, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]));
    const path = await readCoverPath(dir, story.slug);
    expect(path).not.toBeNull();
    expect(path!.endsWith("/cover.jpg")).toBe(true);
  });

  it("ensureCoverOrFallback generates a JPEG when none exists", async () => {
    const story = await createStory(dir, { title: "Test Book" });
    const path = await ensureCoverOrFallback(dir, story.slug, {
      title: "Test Book",
      author: "J. Doe",
    });
    expect(path.endsWith("/cover.jpg")).toBe(true);
    const bytes = await readFile(path);
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
  });

  it("ensureCoverOrFallback returns the existing cover if present", async () => {
    const story = await createStory(dir, { title: "T" });
    const existing = await writeCoverJpeg(
      dir,
      story.slug,
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])
    );
    const returned = await ensureCoverOrFallback(dir, story.slug, {
      title: "T",
      author: "A",
    });
    expect(returned).toBe(existing);
  });

  it("writeEpub with opts.outputDir writes to the override dir, not exports/", async () => {
    const story = await createStory(dir, { title: "Book" });
    const overrideDir = await mkdtemp(join(tmpdir(), "scriptr-override-"));
    try {
      const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
      const path = await writeEpub(dir, story.slug, 3, bytes, { outputDir: overrideDir });
      expect(path).toBe(join(overrideDir, `${story.slug}-epub3.epub`));
      const stats = await stat(path);
      expect(stats.size).toBe(bytes.length);
      // The default exports/ dir must NOT have a stray file.
      const defaultPath = join(dir, "stories", story.slug, "exports", `${story.slug}-epub3.epub`);
      await expect(stat(defaultPath)).rejects.toThrow();
    } finally {
      await rm(overrideDir, { recursive: true, force: true });
    }
  });

  it("writeEpub with opts.outputDir creates the dir if it doesn't exist yet", async () => {
    const story = await createStory(dir, { title: "Book" });
    const overrideRoot = await mkdtemp(join(tmpdir(), "scriptr-override-"));
    const nested = join(overrideRoot, "nested", "subdir");
    try {
      const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9]);
      const path = await writeEpub(dir, story.slug, 2, bytes, { outputDir: nested });
      expect(path).toBe(join(nested, `${story.slug}-epub2.epub`));
      const stats = await stat(path);
      expect(stats.size).toBe(bytes.length);
    } finally {
      await rm(overrideRoot, { recursive: true, force: true });
    }
  });

  it("writeEpub without opts.outputDir writes to exports/ as today (regression)", async () => {
    const story = await createStory(dir, { title: "Book" });
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1]);
    const path = await writeEpub(dir, story.slug, 3, bytes);
    expect(path.endsWith(`/exports/${story.slug}-epub3.epub`)).toBe(true);
  });
});
