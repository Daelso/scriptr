import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { createStory } from "@/lib/storage/stories";
import { createImportedChapter } from "@/lib/storage/chapters";
import { createBundle, updateBundle } from "@/lib/storage/bundles";

describe("GET /api/bundles/[slug]/preview", () => {
  const originalEnv = process.env;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scriptr-bundle-preview-"));
    process.env = { ...originalEnv, SCRIPTR_DATA_DIR: tmpDir };
  });
  afterEach(async () => {
    process.env = originalEnv;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("404s for missing bundle", async () => {
    const { GET } = await import("@/app/api/bundles/[slug]/preview/route");
    const req = new Request("http://localhost/api/bundles/nope/preview") as unknown as NextRequest;
    const ctx = { params: Promise.resolve({ slug: "nope" }) };
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
  });

  it("returns bundle metadata + per-story title page + chapters", async () => {
    const story = await createStory(tmpDir, { title: "Story A", authorPenName: "Pen" });
    await createImportedChapter(tmpDir, story.slug, { title: "Ch 1", sectionContents: ["Body."] });

    const b = await createBundle(tmpDir, { title: "Set" });
    await updateBundle(tmpDir, b.slug, {
      stories: [{ storySlug: story.slug }],
    });

    const { GET } = await import("@/app/api/bundles/[slug]/preview/route");
    const req = new Request(`http://localhost/api/bundles/${b.slug}/preview`) as unknown as NextRequest;
    const ctx = { params: Promise.resolve({ slug: b.slug }) };
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.bundle.title).toBe("Set");
    expect(body.data.stories).toHaveLength(1);
    expect(body.data.stories[0].storySlug).toBe(story.slug);
    expect(body.data.stories[0].displayTitle).toBe("Story A");
    expect(body.data.stories[0].titlePageHtml).toContain("story-title-page");
    expect(body.data.stories[0].titlePageHtml).toContain("Story A");
    expect(body.data.stories[0].chapters).toHaveLength(1);
    expect(body.data.stories[0].chapters[0].title).toBe("Ch 1");
    expect(body.data.stories[0].chapters[0].html).toContain("Body.");
  });

  it("uses titleOverride and descriptionOverride", async () => {
    const story = await createStory(tmpDir, { title: "Original" });
    await createImportedChapter(tmpDir, story.slug, { title: "Ch", sectionContents: ["X"] });

    const b = await createBundle(tmpDir, { title: "B" });
    await updateBundle(tmpDir, b.slug, {
      stories: [
        {
          storySlug: story.slug,
          titleOverride: "Bundle Display",
          descriptionOverride: "Bundle blurb.",
        },
      ],
    });

    const { GET } = await import("@/app/api/bundles/[slug]/preview/route");
    const req = new Request(`http://localhost/api/bundles/${b.slug}/preview`) as unknown as NextRequest;
    const ctx = { params: Promise.resolve({ slug: b.slug }) };
    const res = await GET(req, ctx);
    const body = await res.json();
    expect(body.data.stories[0].displayTitle).toBe("Bundle Display");
    expect(body.data.stories[0].titlePageHtml).toContain("Bundle Display");
    expect(body.data.stories[0].titlePageHtml).toContain("Bundle blurb.");
  });

  it("marks missing story refs", async () => {
    const b = await createBundle(tmpDir, { title: "B" });
    await updateBundle(tmpDir, b.slug, {
      stories: [{ storySlug: "ghost-story" }],
    });

    const { GET } = await import("@/app/api/bundles/[slug]/preview/route");
    const req = new Request(`http://localhost/api/bundles/${b.slug}/preview`) as unknown as NextRequest;
    const ctx = { params: Promise.resolve({ slug: b.slug }) };
    const res = await GET(req, ctx);
    const body = await res.json();
    expect(body.data.stories[0]).toEqual({ storySlug: "ghost-story", missing: true });
  });

  it("marks invalid storySlug refs as missing without filesystem traversal", async () => {
    const b = await createBundle(tmpDir, { title: "B" });
    // Intentionally bypass API validation to simulate legacy malformed data.
    await updateBundle(tmpDir, b.slug, {
      stories: [{ storySlug: "../etc" }],
    });

    const { GET } = await import("@/app/api/bundles/[slug]/preview/route");
    const req = new Request(`http://localhost/api/bundles/${b.slug}/preview`) as unknown as NextRequest;
    const ctx = { params: Promise.resolve({ slug: b.slug }) };
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.stories[0]).toEqual({ storySlug: "../etc", missing: true });
  });
});
