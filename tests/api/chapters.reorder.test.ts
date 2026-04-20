import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { createStory, getStory } from "@/lib/storage/stories";
import { createChapter, listChapters } from "@/lib/storage/chapters";
import { chaptersDir } from "@/lib/storage/paths";

describe("/api/stories/[slug]/chapters/reorder", () => {
  const originalEnv = process.env;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scriptr-chapters-reorder-api-"));
    process.env = { ...originalEnv, SCRIPTR_DATA_DIR: tmpDir };
    delete process.env.XAI_API_KEY;
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function callPost(slug: string, body: unknown) {
    const { POST } = await import(
      "@/app/api/stories/[slug]/chapters/reorder/route"
    );
    const req = new Request(
      `http://localhost/api/stories/${slug}/chapters/reorder`,
      {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      }
    ) as unknown as NextRequest;
    const ctx = { params: Promise.resolve({ slug }) };
    return POST(req, ctx);
  }

  async function seed(tmp: string) {
    const story = await createStory(tmp, { title: "My Story" });
    const a = await createChapter(tmp, story.slug, { title: "Alpha" });
    const b = await createChapter(tmp, story.slug, { title: "Bravo" });
    const c = await createChapter(tmp, story.slug, { title: "Charlie" });
    return { story, a, b, c };
  }

  // 1. POST with valid reverse order succeeds
  it("POST with valid reverse order succeeds and updates chapterOrder", async () => {
    const { story, a, b, c } = await seed(tmpDir);

    const res = await callPost(story.slug, { order: [c.id, b.id, a.id] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toEqual({ reordered: true });

    const updated = await getStory(tmpDir, story.slug);
    expect(updated!.chapterOrder).toEqual([c.id, b.id, a.id]);

    const chapters = await listChapters(tmpDir, story.slug);
    expect(chapters.map((ch) => ch.id)).toEqual([c.id, b.id, a.id]);
  });

  // 2. POST with wrong-length order → 400
  it("POST with wrong-length order returns 400", async () => {
    const { story, a, b } = await seed(tmpDir);

    const res = await callPost(story.slug, { order: [a.id, b.id] });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe(
      "newOrder must be a permutation of existing chapterOrder"
    );
  });

  // 3. POST with duplicate ids → 400
  it("POST with duplicate ids returns 400", async () => {
    const { story, a, b } = await seed(tmpDir);

    const res = await callPost(story.slug, { order: [a.id, a.id, b.id] });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe(
      "newOrder must be a permutation of existing chapterOrder"
    );
  });

  // 4. POST with unknown id → 400
  it("POST with unknown id returns 400", async () => {
    const { story, a, b } = await seed(tmpDir);

    const res = await callPost(story.slug, {
      order: [a.id, b.id, "unknown-id"],
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe(
      "newOrder must be a permutation of existing chapterOrder"
    );
  });

  // 5. POST with non-array order → 400
  it("POST with non-array order returns 400", async () => {
    const { story } = await seed(tmpDir);

    const res = await callPost(story.slug, { order: "not-an-array" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("order must be an array of strings");
  });

  // 6. POST with array of non-strings → 400
  it("POST with array of non-strings returns 400", async () => {
    const { story } = await seed(tmpDir);

    const res = await callPost(story.slug, { order: [1, 2, 3] });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("order must be an array of strings");
  });

  // 7. POST with missing order field → 400
  it("POST with missing order field returns 400", async () => {
    const { story } = await seed(tmpDir);

    const res = await callPost(story.slug, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("order must be an array of strings");
  });

  // 8. POST on nonexistent story → 404
  it("POST on nonexistent story returns 404", async () => {
    const res = await callPost("no-such-story", { order: [] });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("story not found");
  });

  // 9. POST succeeds and on-disk filenames are rewritten with correct prefixes
  it("POST rewrites on-disk filenames with correct numeric prefixes", async () => {
    const { story, a, b, c } = await seed(tmpDir);

    const res = await callPost(story.slug, { order: [c.id, b.id, a.id] });
    expect(res.status).toBe(200);

    const dir = chaptersDir(tmpDir, story.slug);
    const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
    expect(files).toHaveLength(3);
    expect(files[0]).toMatch(/^001-/);
    expect(files[1]).toMatch(/^002-/);
    expect(files[2]).toMatch(/^003-/);

    // Verify the prefix order matches the new chapter order by checking titles
    // 001 should be Charlie (c), 002 should be Bravo (b), 003 should be Alpha (a)
    expect(files[0]).toMatch(/charlie/i);
    expect(files[1]).toMatch(/bravo/i);
    expect(files[2]).toMatch(/alpha/i);
  });

  // 10. POST bumps story.json's updatedAt
  it("POST bumps story.json updatedAt", async () => {
    const { story } = await seed(tmpDir);
    const beforeUpdatedAt = story.updatedAt;

    await new Promise((r) => setTimeout(r, 10));

    const { a, b, c } = await (async () => {
      const s = await getStory(tmpDir, story.slug);
      const [aId, bId, cId] = s!.chapterOrder;
      return { a: { id: aId }, b: { id: bId }, c: { id: cId } };
    })();

    const res = await callPost(story.slug, { order: [c.id, b.id, a.id] });
    expect(res.status).toBe(200);

    const updated = await getStory(tmpDir, story.slug);
    expect(updated).not.toBeNull();
    expect(updated!.updatedAt > beforeUpdatedAt).toBe(true);
  });
});
