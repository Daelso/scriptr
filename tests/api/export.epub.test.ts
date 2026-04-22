import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { createStory } from "@/lib/storage/stories";
import { createImportedChapter } from "@/lib/storage/chapters";
import { epubPath } from "@/lib/storage/paths";

describe("/api/stories/[slug]/export/epub POST", () => {
  const originalEnv = process.env;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scriptr-export-api-"));
    process.env = { ...originalEnv, SCRIPTR_DATA_DIR: tmpDir };
  });
  afterEach(async () => {
    process.env = originalEnv;
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function callPost(slug: string, body?: unknown) {
    const { POST } = await import("@/app/api/stories/[slug]/export/epub/route");
    const req = new Request(`http://localhost/api/stories/${slug}/export/epub`, {
      method: "POST",
      ...(body !== undefined
        ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
        : {}),
    }) as unknown as NextRequest;
    const ctx = { params: Promise.resolve({ slug }) };
    return POST(req, ctx);
  }

  it("returns 404 for unknown story", async () => {
    const res = await callPost("nope");
    expect(res.status).toBe(404);
  });

  it("returns 400 when story has no chapters", async () => {
    const story = await createStory(tmpDir, { title: "Empty" });
    const res = await callPost(story.slug);
    expect(res.status).toBe(400);
  });

  it("default body returns version 3 and path ends in -epub3.epub", async () => {
    const story = await createStory(tmpDir, { title: "Book" });
    await createImportedChapter(tmpDir, story.slug, {
      title: "One",
      sectionContents: ["Hello, world."],
    });
    const res = await callPost(story.slug);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.version).toBe(3);
    expect(body.data.path).toBe(epubPath(tmpDir, story.slug, 3));
    expect(body.data.path.endsWith(`-epub3.epub`)).toBe(true);
    expect(body.data.bytes).toBeGreaterThan(500);
    expect(Array.isArray(body.data.warnings)).toBe(true);
    const s = await stat(body.data.path);
    expect(s.isFile()).toBe(true);
  });

  it("{ version: 2 } returns version 2 and path ends in -epub2.epub", async () => {
    const story = await createStory(tmpDir, { title: "Book" });
    await createImportedChapter(tmpDir, story.slug, {
      title: "One",
      sectionContents: ["Hello, world."],
    });
    const res = await callPost(story.slug, { version: 2 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.version).toBe(2);
    expect(body.data.path).toBe(epubPath(tmpDir, story.slug, 2));
    expect(body.data.path.endsWith(`-epub2.epub`)).toBe(true);
    const s = await stat(body.data.path);
    expect(s.isFile()).toBe(true);
  });

  it("back-to-back builds of different versions leave both files on disk", async () => {
    const story = await createStory(tmpDir, { title: "Book" });
    await createImportedChapter(tmpDir, story.slug, {
      title: "One",
      sectionContents: ["Hi."],
    });
    const res3 = await callPost(story.slug, { version: 3 });
    expect(res3.status).toBe(200);
    const res2 = await callPost(story.slug, { version: 2 });
    expect(res2.status).toBe(200);

    const path3 = epubPath(tmpDir, story.slug, 3);
    const path2 = epubPath(tmpDir, story.slug, 2);
    const [s3, s2] = await Promise.all([stat(path3), stat(path2)]);
    expect(s3.isFile()).toBe(true);
    expect(s2.isFile()).toBe(true);
  });

  it("invalid version (e.g. 1) returns 400", async () => {
    const story = await createStory(tmpDir, { title: "Book" });
    await createImportedChapter(tmpDir, story.slug, {
      title: "One",
      sectionContents: ["Hi."],
    });
    const res = await callPost(story.slug, { version: 1 });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/version must be 2 or 3/i);
  });

  it("is idempotent — re-running overwrites the previous .epub of the same version", async () => {
    const story = await createStory(tmpDir, { title: "Book" });
    await createImportedChapter(tmpDir, story.slug, {
      title: "One",
      sectionContents: ["Hi."],
    });
    const first = await callPost(story.slug, { version: 3 });
    expect(first.status).toBe(200);
    const second = await callPost(story.slug, { version: 3 });
    expect(second.status).toBe(200);
  });
});
