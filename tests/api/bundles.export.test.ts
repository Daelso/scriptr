import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { createStory } from "@/lib/storage/stories";
import { createImportedChapter } from "@/lib/storage/chapters";
import { createBundle, updateBundle } from "@/lib/storage/bundles";
import { bundleEpubPath } from "@/lib/storage/paths";

describe("POST /api/bundles/[slug]/export/epub", () => {
  const originalEnv = process.env;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scriptr-bundle-export-"));
    process.env = { ...originalEnv, SCRIPTR_DATA_DIR: tmpDir };
  });
  afterEach(async () => {
    process.env = originalEnv;
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function callPost(slug: string, body?: unknown) {
    const { POST } = await import("@/app/api/bundles/[slug]/export/epub/route");
    const req = new Request(`http://localhost/api/bundles/${slug}/export/epub`, {
      method: "POST",
      ...(body !== undefined
        ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
        : {}),
    }) as unknown as NextRequest;
    const ctx = { params: Promise.resolve({ slug }) };
    return POST(req, ctx);
  }

  it("404s for unknown bundle", async () => {
    const res = await callPost("nope");
    expect(res.status).toBe(404);
  });

  it("400s when bundle has no stories", async () => {
    const b = await createBundle(tmpDir, { title: "Empty" });
    const res = await callPost(b.slug);
    expect(res.status).toBe(400);
  });

  it("400s when all refs are missing on disk", async () => {
    const b = await createBundle(tmpDir, { title: "Ghost" });
    await updateBundle(tmpDir, b.slug, {
      stories: [{ storySlug: "ghost" }],
    });
    const res = await callPost(b.slug);
    expect(res.status).toBe(400);
  });

  it("default body returns version 3 and correct path", async () => {
    const story = await createStory(tmpDir, { title: "Story A", authorPenName: "Pen" });
    await createImportedChapter(tmpDir, story.slug, { title: "C1", sectionContents: ["x."] });

    const b = await createBundle(tmpDir, { title: "Set" });
    await updateBundle(tmpDir, b.slug, {
      authorPenName: "Pen",
      description: "blurb",
      stories: [{ storySlug: story.slug }],
    });

    const res = await callPost(b.slug);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.version).toBe(3);
    expect(body.data.path).toBe(bundleEpubPath(tmpDir, b.slug, 3));
    expect(body.data.path.endsWith("-epub3.epub")).toBe(true);
    expect(body.data.bytes).toBeGreaterThan(500);
    expect(Array.isArray(body.data.warnings)).toBe(true);

    const s = await stat(body.data.path);
    expect(s.size).toBe(body.data.bytes);
  });

  it("version=2 returns -epub2.epub path", async () => {
    const story = await createStory(tmpDir, { title: "Story B" });
    await createImportedChapter(tmpDir, story.slug, { title: "C1", sectionContents: ["x."] });

    const b = await createBundle(tmpDir, { title: "Set2" });
    await updateBundle(tmpDir, b.slug, { stories: [{ storySlug: story.slug }] });

    const res = await callPost(b.slug, { version: 2 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.version).toBe(2);
    expect(body.data.path.endsWith("-epub2.epub")).toBe(true);
  });

  it("emits a warning for each missing-story ref but still builds", async () => {
    const story = await createStory(tmpDir, { title: "Real" });
    await createImportedChapter(tmpDir, story.slug, { title: "C", sectionContents: ["y."] });

    const b = await createBundle(tmpDir, { title: "Mixed" });
    await updateBundle(tmpDir, b.slug, {
      stories: [{ storySlug: story.slug }, { storySlug: "ghost-1" }, { storySlug: "ghost-2" }],
    });

    const res = await callPost(b.slug);
    expect(res.status).toBe(200);
    const body = await res.json();
    const warnings = body.data.warnings as string[];
    expect(warnings.some((w) => w.includes("ghost-1"))).toBe(true);
    expect(warnings.some((w) => w.includes("ghost-2"))).toBe(true);
  });

  it("400 on invalid version value", async () => {
    const b = await createBundle(tmpDir, { title: "X" });
    const res = await callPost(b.slug, { version: 5 });
    expect(res.status).toBe(400);
  });

  it("appends author note from pen-name profile when configured", async () => {
    const { saveConfig } = await import("@/lib/config");
    await saveConfig(tmpDir, {
      penNameProfiles: {
        Pen: {
          defaultMessageHtml: "<p>Thanks for reading.</p>",
        },
      },
    });

    const story = await createStory(tmpDir, { title: "S", authorPenName: "Pen" });
    await createImportedChapter(tmpDir, story.slug, { title: "C", sectionContents: ["x."] });

    const b = await createBundle(tmpDir, { title: "B" });
    await updateBundle(tmpDir, b.slug, {
      authorPenName: "Pen",
      stories: [{ storySlug: story.slug }],
    });

    const res = await callPost(b.slug);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    const JSZip = (await import("jszip")).default;
    const fs = await import("node:fs/promises");
    const epubBytes = await fs.readFile(body.data.path);
    const zip = await JSZip.loadAsync(epubBytes);
    const names = Object.keys(zip.files).filter((n) => /^OEBPS\/.*\.xhtml$/i.test(n));
    let combined = "";
    for (const name of names) combined += await zip.file(name)!.async("string");
    expect(combined).toContain("Thanks for reading.");
  });

  it("omits author note when no profile exists for bundle.authorPenName", async () => {
    const story = await createStory(tmpDir, { title: "S2", authorPenName: "NoProfile" });
    await createImportedChapter(tmpDir, story.slug, { title: "C", sectionContents: ["y."] });

    const b = await createBundle(tmpDir, { title: "B2" });
    await updateBundle(tmpDir, b.slug, {
      authorPenName: "NoProfile",
      stories: [{ storySlug: story.slug }],
    });

    const res = await callPost(b.slug);
    expect(res.status).toBe(200);
    const body = await res.json();

    const JSZip = (await import("jszip")).default;
    const fs = await import("node:fs/promises");
    const epubBytes = await fs.readFile(body.data.path);
    const zip = await JSZip.loadAsync(epubBytes);
    const names = Object.keys(zip.files).filter((n) => /^OEBPS\/.*\.xhtml$/i.test(n));
    let combined = "";
    for (const name of names) combined += await zip.file(name)!.async("string");
    expect(combined).not.toContain("A note from the author");
  });
});
