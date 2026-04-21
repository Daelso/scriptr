import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { createStory } from "@/lib/storage/stories";
import { listChapters } from "@/lib/storage/chapters";

describe("/api/stories/[slug]/chapters/import", () => {
  const originalEnv = process.env;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scriptr-import-api-"));
    process.env = { ...originalEnv, SCRIPTR_DATA_DIR: tmpDir };
    delete process.env.XAI_API_KEY;
  });
  afterEach(async () => {
    process.env = originalEnv;
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function callPost(slug: string, body: unknown) {
    const { POST } = await import(
      "@/app/api/stories/[slug]/chapters/import/route"
    );
    const req = new Request(`http://localhost/api/stories/${slug}/chapters/import`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }) as unknown as NextRequest;
    const ctx = { params: Promise.resolve({ slug }) };
    return POST(req, ctx);
  }

  it("rejects empty paste with 400", async () => {
    const story = await createStory(tmpDir, { title: "S" });
    const res = await callPost(story.slug, { raw: "   " });
    expect(res.status).toBe(400);
  });

  it("rejects paste over 1 MB with 413", async () => {
    const story = await createStory(tmpDir, { title: "S" });
    const huge = "x".repeat(1_100_000);
    const res = await callPost(story.slug, { raw: huge });
    expect(res.status).toBe(413);
  });

  it("returns 404 for unknown story", async () => {
    const res = await callPost("nope", { raw: "some prose" });
    expect(res.status).toBe(404);
  });

  it("creates a chapter with source=imported and returns { chapter, warnings }", async () => {
    const story = await createStory(tmpDir, { title: "S" });
    const raw = [
      "Chapter 1: Opening",
      "",
      "She walked in.",
      "",
      "* * *",
      "",
      "He waited.",
    ].join("\n");
    const res = await callPost(story.slug, { raw, title: "Opening" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.chapter.source).toBe("imported");
    expect(body.data.chapter.title).toBe("Opening");
    expect(body.data.chapter.sections.length).toBe(2);
    expect(Array.isArray(body.data.warnings)).toBe(true);

    const chapters = await listChapters(tmpDir, story.slug);
    expect(chapters).toHaveLength(1);
  });

  it("does NOT leak the raw paste to any non-chapter file", async () => {
    const story = await createStory(tmpDir, { title: "S" });
    const uniqueMarker = "UNIQUE_CANARY_STRING_9f3b";
    const raw = `${uniqueMarker} prose after the canary.`;
    const res = await callPost(story.slug, { raw });
    expect(res.status).toBe(201);

    async function walk(dir: string): Promise<string[]> {
      const entries = await readdir(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) files.push(...(await walk(p)));
        else files.push(p);
      }
      return files;
    }
    const files = await walk(tmpDir);
    for (const f of files) {
      const content = await readFile(f, "utf-8").catch(() => "");
      // Canary may appear in the saved chapter prose — that's expected.
      // Failure condition: canary appearing in a non-chapter file would
      // indicate the route is logging the raw body somewhere.
      if (content.includes(uniqueMarker) && !f.includes("/chapters/")) {
        throw new Error(`raw paste leaked to non-chapter file: ${f}`);
      }
    }
  });

  it("emits cleanup warnings when input has preamble or scene breaks", async () => {
    const story = await createStory(tmpDir, { title: "S" });
    const raw = "Sure, here's the chapter:\n\nScene one.\n\n* * *\n\nScene two.";
    const res = await callPost(story.slug, { raw });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.warnings.length).toBeGreaterThan(0);
  });
});
