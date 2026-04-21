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

  async function callPost(slug: string) {
    const { POST } = await import("@/app/api/stories/[slug]/export/epub/route");
    const req = new Request(`http://localhost/api/stories/${slug}/export/epub`, {
      method: "POST",
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

  it("builds and writes an EPUB file, returns path + bytes + warnings", async () => {
    const story = await createStory(tmpDir, { title: "Book" });
    await createImportedChapter(tmpDir, story.slug, {
      title: "One",
      sectionContents: ["Hello, world."],
    });
    const res = await callPost(story.slug);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.path).toBe(epubPath(tmpDir, story.slug));
    expect(body.data.bytes).toBeGreaterThan(500);
    expect(Array.isArray(body.data.warnings)).toBe(true);
    const s = await stat(body.data.path);
    expect(s.isFile()).toBe(true);
  });

  it("is idempotent — re-running overwrites the previous .epub", async () => {
    const story = await createStory(tmpDir, { title: "Book" });
    await createImportedChapter(tmpDir, story.slug, {
      title: "One",
      sectionContents: ["Hi."],
    });
    const first = await callPost(story.slug);
    expect(first.status).toBe(200);
    const second = await callPost(story.slug);
    expect(second.status).toBe(200);
  });
});
