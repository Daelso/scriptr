import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { createStory } from "@/lib/storage/stories";
import { getStory } from "@/lib/storage/stories";

describe("/api/stories/[slug]/chapters", () => {
  const originalEnv = process.env;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scriptr-chapters-api-"));
    process.env = { ...originalEnv, SCRIPTR_DATA_DIR: tmpDir };
    delete process.env.XAI_API_KEY;
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function callGet(slug: string) {
    const { GET } = await import("@/app/api/stories/[slug]/chapters/route");
    const req = new Request(
      `http://localhost/api/stories/${slug}/chapters`
    ) as unknown as NextRequest;
    const ctx = { params: Promise.resolve({ slug }) };
    return GET(req, ctx);
  }

  async function callPost(slug: string, body: unknown) {
    const { POST } = await import("@/app/api/stories/[slug]/chapters/route");
    const req = new Request(`http://localhost/api/stories/${slug}/chapters`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }) as unknown as NextRequest;
    const ctx = { params: Promise.resolve({ slug }) };
    return POST(req, ctx);
  }

  // 1. GET on story with no chapters returns empty array
  it("GET on story with no chapters returns empty array", async () => {
    const story = await createStory(tmpDir, { title: "Empty Story" });
    const res = await callGet(story.slug);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toEqual([]);
  });

  // 2. GET on nonexistent story returns 404
  it("GET on nonexistent story returns 404", async () => {
    const res = await callGet("does-not-exist");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("story not found");
  });

  // 3. POST creates chapter, returns 201
  it("POST creates chapter and returns 201", async () => {
    const story = await createStory(tmpDir, { title: "New Story" });
    const res = await callPost(story.slug, { title: "Chapter One" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toMatchObject({
      title: "Chapter One",
      summary: "",
      beats: [],
      prompt: "",
      recap: "",
      sections: [],
      wordCount: 0,
    });
    expect(typeof body.data.id).toBe("string");
    expect(body.data.id.length).toBeGreaterThan(0);
  });

  // 4. POST then GET round-trip: 3 chapters in creation order
  it("POST then GET returns chapters in creation order", async () => {
    const story = await createStory(tmpDir, { title: "Multi Chapter Story" });
    const titles = ["First Chapter", "Second Chapter", "Third Chapter"];
    for (const title of titles) {
      const res = await callPost(story.slug, { title });
      expect(res.status).toBe(201);
    }

    const res = await callGet(story.slug);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toHaveLength(3);
    expect(body.data[0].title).toBe("First Chapter");
    expect(body.data[1].title).toBe("Second Chapter");
    expect(body.data[2].title).toBe("Third Chapter");
  });

  // 5. POST without title → 400
  it("POST without title returns 400 (missing key)", async () => {
    const story = await createStory(tmpDir, { title: "Validate Story" });
    const res = await callPost(story.slug, { summary: "no title here" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("title required");
  });

  it("POST with null title returns 400", async () => {
    const story = await createStory(tmpDir, { title: "Validate Story 2" });
    const res = await callPost(story.slug, { title: null });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("title required");
  });

  it("POST with empty string title returns 400", async () => {
    const story = await createStory(tmpDir, { title: "Validate Story 3" });
    const res = await callPost(story.slug, { title: "" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("title required");
  });

  it("POST with non-string title returns 400", async () => {
    const story = await createStory(tmpDir, { title: "Validate Story 4" });
    const res = await callPost(story.slug, { title: 42 });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("title required");
  });

  // 6. POST with invalid summary type → 400
  it("POST with non-string summary returns 400", async () => {
    const story = await createStory(tmpDir, { title: "Summary Test" });
    const res = await callPost(story.slug, { title: "Good Title", summary: 99 });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("summary must be a string");
  });

  // 7. POST on nonexistent story → 404
  it("POST on nonexistent story returns 404", async () => {
    const res = await callPost("no-such-story", { title: "Ghost Chapter" });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("story not found");
  });

  // 8. POST then GET: story's chapterOrder is bumped
  it("POST bumps story chapterOrder", async () => {
    const story = await createStory(tmpDir, { title: "Order Test Story" });
    expect(story.chapterOrder).toHaveLength(0);

    const res = await callPost(story.slug, { title: "Solo Chapter" });
    expect(res.status).toBe(201);
    const postBody = await res.json();
    const newChapterId = postBody.data.id as string;

    const updated = await getStory(tmpDir, story.slug);
    expect(updated).not.toBeNull();
    expect(updated!.chapterOrder).toHaveLength(1);
    expect(updated!.chapterOrder[0]).toBe(newChapterId);
  });
});
