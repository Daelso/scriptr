import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { createStory } from "@/lib/storage/stories";
import { createImportedChapter } from "@/lib/storage/chapters";
import { paperbackInteriorPath } from "@/lib/storage/paths";
import { saveConfig } from "@/lib/config";

describe("/api/stories/[slug]/export/paperback POST", () => {
  const originalEnv = process.env;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scriptr-paperback-api-"));
    process.env = { ...originalEnv, SCRIPTR_DATA_DIR: tmpDir };
  });
  afterEach(async () => {
    process.env = originalEnv;
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function callPost(slug: string, body?: unknown) {
    const { POST } = await import("@/app/api/stories/[slug]/export/paperback/route");
    const req = new Request(`http://localhost/api/stories/${slug}/export/paperback`, {
      method: "POST",
      ...(body !== undefined
        ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
        : {}),
    }) as unknown as NextRequest;
    return POST(req, { params: Promise.resolve({ slug }) });
  }

  it("returns 404 for unknown story", async () => {
    const res = await callPost("missing");
    expect(res.status).toBe(404);
  });

  it("returns 400 when story has no chapters", async () => {
    const story = await createStory(tmpDir, { title: "Empty" });
    const res = await callPost(story.slug);
    expect(res.status).toBe(400);
  });

  it("writes paperback interior and cover spec to the story exports folder", async () => {
    const story = await createStory(tmpDir, { title: "Book", authorPenName: "Jane Doe" });
    await createImportedChapter(tmpDir, story.slug, {
      title: "One",
      sectionContents: ["Hello, paperback."],
    });

    const res = await callPost(story.slug, {
      options: { trimSizeId: "6x9", paperType: "cream", pageCountOverride: 100 },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.path).toBe(paperbackInteriorPath(tmpDir, story.slug));
    expect(body.data.coverSpecPath.endsWith("-paperback-cover-spec.json")).toBe(true);
    expect(body.data.coverSpec.paperType).toBe("cream");
    expect(body.data.coverSpec.pageCount).toBe(100);
    expect((await stat(body.data.path)).isFile()).toBe(true);
    const html = await readFile(body.data.path, "utf-8");
    expect(html).toContain("Hello, paperback.");
  });

  it("falls back to config.defaultExportDir when body.outputDir is absent", async () => {
    const out = await mkdtemp(join(tmpdir(), "scriptr-paperback-out-"));
    try {
      await saveConfig(tmpDir, { defaultExportDir: out });
      const story = await createStory(tmpDir, { title: "Book" });
      await createImportedChapter(tmpDir, story.slug, {
        title: "One",
        sectionContents: ["Hi"],
      });
      const res = await callPost(story.slug, { options: { pageCountOverride: 24 } });
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.data.path).toBe(join(out, `${story.slug}-paperback-interior.html`));
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });

  it("returns 400 when body.outputDir is invalid", async () => {
    const story = await createStory(tmpDir, { title: "Book" });
    await createImportedChapter(tmpDir, story.slug, {
      title: "One",
      sectionContents: ["Hi"],
    });
    const res = await callPost(story.slug, { outputDir: "./nope" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/absolute/i);
  });
});
