import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import type { NextRequest } from "next/server";
import { createStory, updateStory } from "@/lib/storage/stories";
import { createImportedChapter } from "@/lib/storage/chapters";
import { epubPath } from "@/lib/storage/paths";
import { saveConfig } from "@/lib/config";

async function unzipXhtmls(bytes: Buffer | Uint8Array): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(bytes);
  const out: Record<string, string> = {};
  await Promise.all(
    Object.keys(zip.files)
      .filter((p) => p.endsWith(".xhtml"))
      .map(async (p) => {
        out[p] = await zip.file(p)!.async("string");
      }),
  );
  return out;
}

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

  async function callPost(slug: string, body?: unknown) {
    const { POST } = await import("@/app/api/stories/[slug]/export/epub/route");
    const req = new Request(`http://localhost/api/stories/${slug}/export/epub`, {
      method: "POST",
      ...(body !== undefined
        ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
        : {}),
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

  it("default body returns version 3 and path ends in -epub3.epub", async () => {
    const story = await createStory(tmpDir, { title: "Book" });
    await createImportedChapter(tmpDir, story.slug, {
      title: "One",
      sectionContents: ["Hello, world."],
    });
    const res = await callPost(story.slug);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.version).toBe(3);
    expect(body.data.path).toBe(epubPath(tmpDir, story.slug, 3));
    expect(body.data.path.endsWith(`-epub3.epub`)).toBe(true);
    expect(body.data.bytes).toBeGreaterThan(500);
    expect(Array.isArray(body.data.warnings)).toBe(true);
    const s = await stat(body.data.path);
    expect(s.isFile()).toBe(true);
  });

  it("{ version: 2 } returns version 2 and path ends in -epub2.epub", async () => {
    const story = await createStory(tmpDir, { title: "Book" });
    await createImportedChapter(tmpDir, story.slug, {
      title: "One",
      sectionContents: ["Hello, world."],
    });
    const res = await callPost(story.slug, { version: 2 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.version).toBe(2);
    expect(body.data.path).toBe(epubPath(tmpDir, story.slug, 2));
    expect(body.data.path.endsWith(`-epub2.epub`)).toBe(true);
    const s = await stat(body.data.path);
    expect(s.isFile()).toBe(true);
  });

  it("back-to-back builds of different versions leave both files on disk", async () => {
    const story = await createStory(tmpDir, { title: "Book" });
    await createImportedChapter(tmpDir, story.slug, {
      title: "One",
      sectionContents: ["Hi."],
    });
    const res3 = await callPost(story.slug, { version: 3 });
    expect(res3.status).toBe(200);
    const res2 = await callPost(story.slug, { version: 2 });
    expect(res2.status).toBe(200);

    const path3 = epubPath(tmpDir, story.slug, 3);
    const path2 = epubPath(tmpDir, story.slug, 2);
    const [s3, s2] = await Promise.all([stat(path3), stat(path2)]);
    expect(s3.isFile()).toBe(true);
    expect(s2.isFile()).toBe(true);
  });

  it("invalid version (e.g. 1) returns 400", async () => {
    const story = await createStory(tmpDir, { title: "Book" });
    await createImportedChapter(tmpDir, story.slug, {
      title: "One",
      sectionContents: ["Hi."],
    });
    const res = await callPost(story.slug, { version: 1 });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/version must be 2 or 3/i);
  });

  it("is idempotent — re-running overwrites the previous .epub of the same version", async () => {
    const story = await createStory(tmpDir, { title: "Book" });
    await createImportedChapter(tmpDir, story.slug, {
      title: "One",
      sectionContents: ["Hi."],
    });
    const first = await callPost(story.slug, { version: 3 });
    expect(first.status).toBe(200);
    const second = await callPost(story.slug, { version: 3 });
    expect(second.status).toBe(200);
  });

  it("includes the author note when story's pen-name has a profile and authorNote is enabled", async () => {
    const story = await createStory(tmpDir, { title: "T", authorPenName: "Jane Doe" });
    await createImportedChapter(tmpDir, story.slug, {
      title: "One",
      sectionContents: ["Hello, world."],
    });
    await saveConfig(tmpDir, {
      penNameProfiles: {
        "Jane Doe": {
          email: "jane@example.com",
          mailingListUrl: "https://list.example.com/jane",
          defaultMessageHtml: "<p>Thanks!</p>",
        },
      },
    });
    const res = await callPost(story.slug);
    const body = await res.json();
    expect(body.ok).toBe(true);
    const bytes = await readFile(body.data.path);
    const xhtmls = await unzipXhtmls(bytes);
    const noteEntry = Object.entries(xhtmls).find(([, html]) =>
      html.includes('class="author-note"'),
    );
    expect(noteEntry, "expected an XHTML containing the author-note div").toBeDefined();
    const [, noteHtml] = noteEntry!;
    expect(noteHtml).toContain("A note from the author");
    expect(noteHtml).toContain("mailto:jane@example.com");
  });

  it("omits the author note when no profile exists", async () => {
    const story = await createStory(tmpDir, { title: "T", authorPenName: "Nobody" });
    await createImportedChapter(tmpDir, story.slug, {
      title: "One",
      sectionContents: ["Hello, world."],
    });
    // No saveConfig — no penNameProfiles for "Nobody".
    const res = await callPost(story.slug);
    const body = await res.json();
    expect(body.ok).toBe(true);
    const bytes = await readFile(body.data.path);
    const xhtmls = await unzipXhtmls(bytes);
    for (const text of Object.values(xhtmls)) {
      expect(text).not.toContain("A note from the author");
    }
  });

  it("omits the author note when authorNote.enabled === false", async () => {
    const story = await createStory(tmpDir, { title: "T", authorPenName: "Jane Doe" });
    await createImportedChapter(tmpDir, story.slug, {
      title: "One",
      sectionContents: ["Hello, world."],
    });
    await saveConfig(tmpDir, {
      penNameProfiles: {
        "Jane Doe": {
          email: "jane@example.com",
          defaultMessageHtml: "<p>Thanks!</p>",
        },
      },
    });
    await updateStory(tmpDir, story.slug, { authorNote: { enabled: false } });
    const res = await callPost(story.slug);
    const body = await res.json();
    expect(body.ok).toBe(true);
    const bytes = await readFile(body.data.path);
    const xhtmls = await unzipXhtmls(bytes);
    for (const text of Object.values(xhtmls)) {
      expect(text).not.toContain("A note from the author");
    }
  });

  it("returns 400 when mailing list URL is too long for a QR code", async () => {
    const story = await createStory(tmpDir, { title: "T", authorPenName: "Jane Doe" });
    await createImportedChapter(tmpDir, story.slug, {
      title: "One",
      sectionContents: ["Hello, world."],
    });
    const huge = "https://example.com/" + "x".repeat(5000);
    await saveConfig(tmpDir, {
      penNameProfiles: {
        "Jane Doe": {
          email: "jane@example.com",
          mailingListUrl: huge,
          defaultMessageHtml: "<p>Thanks!</p>",
        },
      },
    });
    const res = await callPost(story.slug);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/mailing list URL is too long/i);
  });
});
