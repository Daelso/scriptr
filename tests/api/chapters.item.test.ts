import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { createStory } from "@/lib/storage/stories";
import { createChapter } from "@/lib/storage/chapters";
import { getStory } from "@/lib/storage/stories";
import type { Section } from "@/lib/types";

describe("/api/stories/[slug]/chapters/[id]", () => {
  const originalEnv = process.env;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scriptr-chapter-item-api-"));
    process.env = { ...originalEnv, SCRIPTR_DATA_DIR: tmpDir };
    delete process.env.XAI_API_KEY;
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function callGet(slug: string, id: string) {
    const { GET } = await import("@/app/api/stories/[slug]/chapters/[id]/route");
    const req = new Request(
      `http://localhost/api/stories/${slug}/chapters/${id}`
    ) as unknown as NextRequest;
    const ctx = { params: Promise.resolve({ slug, id }) };
    return GET(req, ctx);
  }

  async function callPatch(slug: string, id: string, body: Record<string, unknown>) {
    const { PATCH } = await import("@/app/api/stories/[slug]/chapters/[id]/route");
    const req = new Request(`http://localhost/api/stories/${slug}/chapters/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }) as unknown as NextRequest;
    const ctx = { params: Promise.resolve({ slug, id }) };
    return PATCH(req, ctx);
  }

  async function callDelete(slug: string, id: string) {
    const { DELETE } = await import("@/app/api/stories/[slug]/chapters/[id]/route");
    const req = new Request(`http://localhost/api/stories/${slug}/chapters/${id}`, {
      method: "DELETE",
    }) as unknown as NextRequest;
    const ctx = { params: Promise.resolve({ slug, id }) };
    return DELETE(req, ctx);
  }

  // 1. GET existing chapter returns 200 with data
  it("GET existing chapter returns 200 with data", async () => {
    const story = await createStory(tmpDir, { title: "Test Story" });
    const chapter = await createChapter(tmpDir, story.slug, { title: "Chapter One" });

    const res = await callGet(story.slug, chapter.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.id).toBe(chapter.id);
    expect(body.data.title).toBe("Chapter One");
  });

  // 2. GET missing chapter returns 404
  it("GET missing chapter returns 404", async () => {
    const story = await createStory(tmpDir, { title: "Test Story" });

    const res = await callGet(story.slug, "nonexistent-id");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("chapter not found");
  });

  // 3. GET on nonexistent story returns 404
  it("GET on nonexistent story returns 404", async () => {
    const res = await callGet("no-such-story", "any-id");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("chapter not found");
  });

  // 4. PATCH updates title; subsequent GET persists
  it("PATCH updates title and persists to disk", async () => {
    const story = await createStory(tmpDir, { title: "Test Story" });
    const chapter = await createChapter(tmpDir, story.slug, { title: "Old Title" });

    const res = await callPatch(story.slug, chapter.id, { title: "New Title" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.title).toBe("New Title");

    const getRes = await callGet(story.slug, chapter.id);
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.data.title).toBe("New Title");
  });

  // 5. PATCH updates beats and summary together (partial update)
  it("PATCH updates beats and summary together", async () => {
    const story = await createStory(tmpDir, { title: "Test Story" });
    const chapter = await createChapter(tmpDir, story.slug, { title: "Chapter One" });

    const res = await callPatch(story.slug, chapter.id, {
      beats: ["beat 1", "beat 2"],
      summary: "A great chapter",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.beats).toEqual(["beat 1", "beat 2"]);
    expect(body.data.summary).toBe("A great chapter");
    // title unchanged
    expect(body.data.title).toBe("Chapter One");
  });

  // 6. PATCH updates sections array
  it("PATCH updates sections array and persists", async () => {
    const story = await createStory(tmpDir, { title: "Test Story" });
    const chapter = await createChapter(tmpDir, story.slug, { title: "Chapter One" });

    const newSections: Section[] = [{ id: "s1", content: "hello" }];
    const res = await callPatch(story.slug, chapter.id, { sections: newSections });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.sections).toEqual(newSections);

    const getRes = await callGet(story.slug, chapter.id);
    const getBody = await getRes.json();
    expect(getBody.data.sections).toEqual(newSections);
  });

  // 7. PATCH does NOT allow id change
  it("PATCH ignores id field — id immutability", async () => {
    const story = await createStory(tmpDir, { title: "Test Story" });
    const chapter = await createChapter(tmpDir, story.slug, { title: "Chapter One" });
    const originalId = chapter.id;

    const res = await callPatch(story.slug, chapter.id, {
      title: "New Title",
      id: "impostor",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // id must remain original
    expect(body.data.id).toBe(originalId);

    // GET by original id succeeds
    const getOk = await callGet(story.slug, originalId);
    expect(getOk.status).toBe(200);

    // GET by impostor id returns 404
    const getImpostor = await callGet(story.slug, "impostor");
    expect(getImpostor.status).toBe(404);
  });

  // 8. PATCH missing chapter → 404
  it("PATCH missing chapter returns 404", async () => {
    const story = await createStory(tmpDir, { title: "Test Story" });

    const res = await callPatch(story.slug, "nonexistent-id", { title: "Whatever" });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("chapter not found");
  });

  // 9. DELETE removes chapter; other chapters unaffected
  it("DELETE removes chapter and other chapters remain", async () => {
    const story = await createStory(tmpDir, { title: "Test Story" });
    const ch1 = await createChapter(tmpDir, story.slug, { title: "Chapter One" });
    const ch2 = await createChapter(tmpDir, story.slug, { title: "Chapter Two" });

    const res = await callDelete(story.slug, ch1.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toEqual({ deleted: true });

    // Deleted chapter returns 404
    const getDeleted = await callGet(story.slug, ch1.id);
    expect(getDeleted.status).toBe(404);

    // Remaining chapter still accessible
    const getRemaining = await callGet(story.slug, ch2.id);
    expect(getRemaining.status).toBe(200);
    const getBody = await getRemaining.json();
    expect(getBody.data.title).toBe("Chapter Two");
  });

  // 10. DELETE missing chapter → 404
  it("DELETE missing chapter returns 404", async () => {
    const story = await createStory(tmpDir, { title: "Test Story" });

    const res = await callDelete(story.slug, "nonexistent-id");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("chapter not found");
  });

  // 11. PATCH bumps story.json's updatedAt
  it("PATCH bumps story updatedAt", async () => {
    const story = await createStory(tmpDir, { title: "Test Story" });
    const chapter = await createChapter(tmpDir, story.slug, { title: "Chapter One" });
    const beforeUpdatedAt = story.updatedAt;

    await new Promise((r) => setTimeout(r, 10));

    const res = await callPatch(story.slug, chapter.id, { title: "Updated Title" });
    expect(res.status).toBe(200);

    const updatedStory = await getStory(tmpDir, story.slug);
    expect(updatedStory).not.toBeNull();
    expect(updatedStory!.updatedAt > beforeUpdatedAt).toBe(true);
  });

  // 12. DELETE bumps story.json's updatedAt AND removes id from chapterOrder
  it("DELETE bumps story updatedAt and removes id from chapterOrder", async () => {
    const story = await createStory(tmpDir, { title: "Test Story" });
    const chapter = await createChapter(tmpDir, story.slug, { title: "Chapter One" });
    const beforeUpdatedAt = story.updatedAt;

    await new Promise((r) => setTimeout(r, 10));

    const res = await callDelete(story.slug, chapter.id);
    expect(res.status).toBe(200);

    const updatedStory = await getStory(tmpDir, story.slug);
    expect(updatedStory).not.toBeNull();
    expect(updatedStory!.chapterOrder).toHaveLength(0);
    expect(updatedStory!.updatedAt > beforeUpdatedAt).toBe(true);
  });
});
