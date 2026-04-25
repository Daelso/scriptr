import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { createStory } from "@/lib/storage/stories";
import { storyDir } from "@/lib/storage/paths";
import type { Story } from "@/lib/types";

describe("/api/stories/[slug]", () => {
  const originalEnv = process.env;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scriptr-slug-api-"));
    process.env = { ...originalEnv, SCRIPTR_DATA_DIR: tmpDir };
    delete process.env.XAI_API_KEY;
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function seedStory(title = "Base Story"): Promise<Story> {
    return createStory(tmpDir, { title });
  }

  async function callGet(slug: string) {
    const { GET } = await import("@/app/api/stories/[slug]/route");
    const req = new Request(`http://localhost/api/stories/${slug}`) as unknown as NextRequest;
    const ctx = { params: Promise.resolve({ slug }) };
    return GET(req, ctx);
  }

  async function callPatch(slug: string, body: Record<string, unknown>) {
    const { PATCH } = await import("@/app/api/stories/[slug]/route");
    const req = new Request(`http://localhost/api/stories/${slug}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }) as unknown as NextRequest;
    const ctx = { params: Promise.resolve({ slug }) };
    return PATCH(req, ctx);
  }

  async function callDelete(slug: string) {
    const { DELETE } = await import("@/app/api/stories/[slug]/route");
    const req = new Request(`http://localhost/api/stories/${slug}`, {
      method: "DELETE",
    }) as unknown as NextRequest;
    const ctx = { params: Promise.resolve({ slug }) };
    return DELETE(req, ctx);
  }

  // 1. GET existing story returns 200 with full data
  it("GET existing story returns 200 with full data", async () => {
    const story = await seedStory("My First Story");
    const res = await callGet(story.slug);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.slug).toBe(story.slug);
    expect(body.data.title).toBe("My First Story");
    expect(body.data.createdAt).toBe(story.createdAt);
    expect(body.data.updatedAt).toBe(story.updatedAt);
    expect(body.data.chapterOrder).toEqual([]);
  });

  // 2. GET missing story returns 404
  it("GET missing story returns 404", async () => {
    const res = await callGet("does-not-exist");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("story not found");
  });

  // 3. PATCH updates allowed fields and persists to disk
  it("PATCH updates allowed fields and returns updated story", async () => {
    const story = await seedStory("Original Title");
    const res = await callPatch(story.slug, {
      title: "Updated Title",
      description: "A great story",
      authorPenName: "Jane Doe",
      keywords: ["a", "b"],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.title).toBe("Updated Title");
    expect(body.data.description).toBe("A great story");
    expect(body.data.authorPenName).toBe("Jane Doe");
    expect(body.data.keywords).toEqual(["a", "b"]);
    // updatedAt should be bumped
    expect(body.data.updatedAt > story.updatedAt).toBe(true);

    // Subsequent GET should reflect the patch (on-disk persistence)
    const getRes = await callGet(story.slug);
    const getBody = await getRes.json();
    expect(getBody.data.title).toBe("Updated Title");
    expect(getBody.data.description).toBe("A great story");
    expect(getBody.data.authorPenName).toBe("Jane Doe");
    expect(getBody.data.keywords).toEqual(["a", "b"]);
  });

  // 4. PATCH slug immutability
  it("PATCH with title change does not rename slug or folder", async () => {
    const story = await seedStory("Original");
    const originalSlug = story.slug;

    const res = await callPatch(originalSlug, {
      title: "New Title",
      slug: "attempted-override",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // Response slug is unchanged
    expect(body.data.slug).toBe(originalSlug);

    // Subsequent GET using original slug still works
    const getRes = await callGet(originalSlug);
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.data.slug).toBe(originalSlug);

    // On-disk: original folder exists
    await expect(access(storyDir(tmpDir, originalSlug))).resolves.toBeUndefined();

    // On-disk: attempted-override folder does NOT exist
    await expect(access(storyDir(tmpDir, "attempted-override"))).rejects.toThrow();
  });

  // 5. PATCH missing story returns 404
  it("PATCH missing story returns 404", async () => {
    const res = await callPatch("does-not-exist", { title: "Whatever" });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("story not found");
  });

  // 6. DELETE removes the story
  it("DELETE removes the story and subsequent GET returns 404", async () => {
    const story = await seedStory("To Be Deleted");
    const dir = storyDir(tmpDir, story.slug);

    // Confirm it exists before
    await expect(access(dir)).resolves.toBeUndefined();

    const res = await callDelete(story.slug);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toEqual({ deleted: true });

    // Subsequent GET returns 404
    const getRes = await callGet(story.slug);
    expect(getRes.status).toBe(404);

    // Folder is gone
    await expect(access(dir)).rejects.toThrow();
  });

  // 7. DELETE removes sub-artifacts (cover.jpg and .last-payload.json)
  it("DELETE removes sub-artifacts including cover.jpg and .last-payload.json", async () => {
    const story = await seedStory("Story With Artifacts");
    const dir = storyDir(tmpDir, story.slug);
    const coverPath = join(dir, "cover.jpg");
    const payloadPath = join(dir, ".last-payload.json");

    // Write fake artifacts
    await writeFile(coverPath, "fake-image-data");
    await writeFile(payloadPath, JSON.stringify({ fake: true }));

    // Confirm they exist
    await expect(access(coverPath)).resolves.toBeUndefined();
    await expect(access(payloadPath)).resolves.toBeUndefined();

    const res = await callDelete(story.slug);
    expect(res.status).toBe(200);

    // Entire folder (including artifacts) is gone
    await expect(access(dir)).rejects.toThrow();
    await expect(access(coverPath)).rejects.toThrow();
    await expect(access(payloadPath)).rejects.toThrow();
  });

  // 8. DELETE missing story returns 404
  it("DELETE missing story returns 404", async () => {
    const res = await callDelete("does-not-exist");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("story not found");
  });

  // 9. PATCH authorNote round-trips via GET
  it("PATCH accepts authorNote and round-trips it via GET", async () => {
    const story = await seedStory("Test");
    const patchRes = await callPatch(story.slug, {
      authorNote: { enabled: true, messageHtml: "<p>hi</p>" },
    });
    expect(patchRes.status).toBe(200);
    expect((await patchRes.json()).ok).toBe(true);

    const getRes = await callGet(story.slug);
    const body = await getRes.json();
    expect(body.data.authorNote).toEqual({ enabled: true, messageHtml: "<p>hi</p>" });
  });

  // 10. PATCH authorNote with enabled=false alone persists
  it("PATCH accepts authorNote.enabled=false alone and persists it", async () => {
    const story = await seedStory("Test 2");
    const res = await callPatch(story.slug, {
      authorNote: { enabled: false },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);

    const getRes = await callGet(story.slug);
    const body = await getRes.json();
    expect(body.data.authorNote).toEqual({ enabled: false });
  });
});
