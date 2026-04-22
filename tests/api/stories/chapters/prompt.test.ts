import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { createStory } from "@/lib/storage/stories";
import { createChapter, updateChapter } from "@/lib/storage/chapters";
import { saveBible } from "@/lib/storage/bible";
import { bibleJson } from "@/lib/storage/paths";
import type { Bible } from "@/lib/types";

const BIBLE: Bible = {
  characters: [{ name: "Alice", description: "curious cat" }],
  setting: "attic",
  pov: "third-limited",
  tone: "whimsical",
  styleNotes: "",
  nsfwPreferences: "",
};

describe("GET /api/stories/[slug]/chapters/[id]/prompt", () => {
  const originalEnv = process.env;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scriptr-prompt-route-"));
    process.env = { ...originalEnv, SCRIPTR_DATA_DIR: tmpDir };
    delete process.env.XAI_API_KEY;
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function callGet(slug: string, id: string) {
    const { GET } = await import(
      "@/app/api/stories/[slug]/chapters/[id]/prompt/route"
    );
    const req = new Request(
      `http://localhost/api/stories/${slug}/chapters/${id}/prompt`,
    ) as unknown as NextRequest;
    const ctx = { params: Promise.resolve({ slug, id }) };
    return GET(req, ctx);
  }

  it("200: happy path returns { ok, data: { system, user, meta } }", async () => {
    const story = await createStory(tmpDir, { title: "Happy Path" });
    await saveBible(tmpDir, story.slug, BIBLE);
    const chapter = await createChapter(tmpDir, story.slug, { title: "Ch1" });
    await updateChapter(tmpDir, story.slug, chapter.id, { beats: ["Alice wakes"] });

    const res = await callGet(story.slug, chapter.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.data.system).toBe("string");
    expect(body.data.system.length).toBeGreaterThan(0);
    expect(typeof body.data.user).toBe("string");
    expect(body.data.user).toContain("# Story bible");
    expect(body.data.meta.chapterIndex).toBe(1);
    expect(body.data.meta.priorRecapCount).toBe(0);
    expect(body.data.meta.includesLastChapterFullText).toBe(false);
    expect(typeof body.data.meta.model).toBe("string");
  });

  it("404: story not found", async () => {
    const res = await callGet("nonexistent-slug", "whatever-id");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "story not found" });
  });

  it("404: bible not found (story exists but bible.json deleted)", async () => {
    const story = await createStory(tmpDir, { title: "Bible-less" });
    const chapter = await createChapter(tmpDir, story.slug, { title: "Ch1" });
    // createStory auto-writes a default bible; delete it to exercise the 404 path.
    await unlink(bibleJson(tmpDir, story.slug));
    const res = await callGet(story.slug, chapter.id);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "bible not found" });
  });

  it("404: chapter not found", async () => {
    const story = await createStory(tmpDir, { title: "No-chapter Story" });
    await saveBible(tmpDir, story.slug, BIBLE);
    const res = await callGet(story.slug, "nonexistent-chapter-id");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "chapter not found" });
  });
});
