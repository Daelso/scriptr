import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import type { NextRequest } from "next/server";
import { createStory, updateStory } from "@/lib/storage/stories";
import { createImportedChapter } from "@/lib/storage/chapters";
import { epubPath } from "@/lib/storage/paths";
import { saveConfig } from "@/lib/config";
import * as epubModule from "@/lib/publish/epub";
import * as epubStorage from "@/lib/publish/epub-storage";

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

  it("writes to body.outputDir when provided", async () => {
    const out = await mkdtemp(join(tmpdir(), "scriptr-out-"));
    try {
      const story = await createStory(tmpDir, { title: "Book" });
      await createImportedChapter(tmpDir, story.slug, {
        title: "One",
        sectionContents: ["Hello, world."],
      });
      const res = await callPost(story.slug, { version: 3, outputDir: out });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.data.path).toBe(join(out, `${story.slug}-epub3.epub`));
      const s = await stat(body.data.path);
      expect(s.isFile()).toBe(true);
      // Default location must NOT have been written.
      await expect(stat(epubPath(tmpDir, story.slug, 3))).rejects.toThrow();
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });

  it("falls back to config.defaultExportDir when body.outputDir absent", async () => {
    const out = await mkdtemp(join(tmpdir(), "scriptr-out-"));
    try {
      await saveConfig(tmpDir, { defaultExportDir: out });
      const story = await createStory(tmpDir, { title: "Book" });
      await createImportedChapter(tmpDir, story.slug, {
        title: "One",
        sectionContents: ["Hello, world."],
      });
      const res = await callPost(story.slug, { version: 3 });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.path).toBe(join(out, `${story.slug}-epub3.epub`));
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });

  it("body.outputDir takes precedence over config.defaultExportDir", async () => {
    const cfgOut = await mkdtemp(join(tmpdir(), "scriptr-cfg-"));
    const bodyOut = await mkdtemp(join(tmpdir(), "scriptr-body-"));
    try {
      await saveConfig(tmpDir, { defaultExportDir: cfgOut });
      const story = await createStory(tmpDir, { title: "Book" });
      await createImportedChapter(tmpDir, story.slug, {
        title: "One",
        sectionContents: ["Hi"],
      });
      const res = await callPost(story.slug, { version: 3, outputDir: bodyOut });
      const body = await res.json();
      expect(body.data.path).toBe(join(bodyOut, `${story.slug}-epub3.epub`));
      await expect(stat(join(cfgOut, `${story.slug}-epub3.epub`))).rejects.toThrow();
    } finally {
      await rm(cfgOut, { recursive: true, force: true });
      await rm(bodyOut, { recursive: true, force: true });
    }
  });

  it("returns 400 when body.outputDir is invalid", async () => {
    const story = await createStory(tmpDir, { title: "Book" });
    await createImportedChapter(tmpDir, story.slug, {
      title: "One",
      sectionContents: ["Hi"],
    });
    const res = await callPost(story.slug, { version: 3, outputDir: "./nope" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/absolute/i);
  });

  it("with no outputDir set anywhere, falls back to data-dir/exports/ (regression)", async () => {
    const story = await createStory(tmpDir, { title: "Book" });
    await createImportedChapter(tmpDir, story.slug, {
      title: "One",
      sectionContents: ["Hi"],
    });
    const res = await callPost(story.slug, { version: 3 });
    const body = await res.json();
    expect(body.data.path).toBe(epubPath(tmpDir, story.slug, 3));
  });

  // ── Diagnostic surfacing ──────────────────────────────────────────────────
  // Pre-fix: any unhandled exception out of buildEpubBytes / validateEpub /
  // writeEpub became a bare HTML 500, which the export UI surfaces as
  // "Build failed (500): <slice of HTML>". These tests pin the JSON shape so
  // the user (and we) get an actionable message in the field.

  describe("error surfacing", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("returns JSON 500 with the underlying message when buildEpubBytes throws", async () => {
      const story = await createStory(tmpDir, { title: "Book" });
      await createImportedChapter(tmpDir, story.slug, {
        title: "One",
        sectionContents: ["Hi."],
      });
      vi.spyOn(epubModule, "buildEpubBytes").mockRejectedValueOnce(
        new Error("synthetic failure: jszip blew up"),
      );
      const res = await callPost(story.slug, { version: 3 });
      expect(res.status).toBe(500);
      expect(res.headers.get("content-type")).toMatch(/application\/json/);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.error).toMatch(/EPUB export failed/i);
      expect(body.error).toMatch(/synthetic failure/);
      // Outer try/catch references the on-disk log path so the user can
      // share the full stack in a bug report.
      expect(body.error).toMatch(/api-errors\.log/);
    });

    it("returns JSON 500 with the underlying message when getStory throws (pre-build path)", async () => {
      // getStory failing used to escape the inner try/catch and become a
      // bare HTML 500 ("Internal Server Error") in v0.6.1. The outer
      // try/catch now catches it.
      const story = await createStory(tmpDir, { title: "Book" });
      await createImportedChapter(tmpDir, story.slug, {
        title: "One",
        sectionContents: ["Hi."],
      });
      const storiesMod = await import("@/lib/storage/stories");
      vi.spyOn(storiesMod, "getStory").mockRejectedValueOnce(
        new Error("synthetic getStory failure: EBUSY on story.json"),
      );
      const res = await callPost(story.slug, { version: 3 });
      expect(res.status).toBe(500);
      expect(res.headers.get("content-type")).toMatch(/application\/json/);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.error).toMatch(/EPUB export failed/i);
      expect(body.error).toMatch(/synthetic getStory failure/);
    });

    it("writes a paper-trail entry to api-errors.log on failure", async () => {
      const story = await createStory(tmpDir, { title: "Book" });
      await createImportedChapter(tmpDir, story.slug, {
        title: "One",
        sectionContents: ["Hi."],
      });
      vi.spyOn(epubModule, "buildEpubBytes").mockRejectedValueOnce(
        new Error("synthetic failure: file logger check"),
      );
      const res = await callPost(story.slug, { version: 3 });
      expect(res.status).toBe(500);
      const logPath = join(tmpDir, "logs", "api-errors.log");
      const log = await readFile(logPath, "utf-8");
      const lines = log.trim().split("\n");
      const entry = JSON.parse(lines[lines.length - 1]);
      expect(entry.route).toBe("POST /api/stories/[slug]/export/epub");
      expect(entry.error.message).toMatch(/file logger check/);
      expect(typeof entry.error.stack).toBe("string");
      expect(entry.context).toMatchObject({ slug: story.slug, version: 3 });
    });

    it("returns sharp-specific guidance when buildEpubBytes throws ERR_DLOPEN_FAILED", async () => {
      const story = await createStory(tmpDir, { title: "Book" });
      await createImportedChapter(tmpDir, story.slug, {
        title: "One",
        sectionContents: ["Hi."],
      });
      const dlopenErr = new Error(
        "The specified module could not be found. \\\\?\\C:\\path\\sharp-win32-x64.node",
      ) as NodeJS.ErrnoException;
      dlopenErr.code = "ERR_DLOPEN_FAILED";
      vi.spyOn(epubModule, "buildEpubBytes").mockRejectedValueOnce(dlopenErr);
      const res = await callPost(story.slug, { version: 3 });
      expect(res.status).toBe(500);
      expect(res.headers.get("content-type")).toMatch(/application\/json/);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.error).toMatch(/Image processing module .*sharp.* failed to load/i);
      expect(body.error).toMatch(/Windows packaging bug/i);
    });

    it("a null cover (sharp unavailable) still produces a valid EPUB", async () => {
      const story = await createStory(tmpDir, { title: "Book" });
      await createImportedChapter(tmpDir, story.slug, {
        title: "One",
        sectionContents: ["Hi."],
      });
      vi.spyOn(epubStorage, "ensureCoverOrFallback").mockResolvedValueOnce(null);
      const res = await callPost(story.slug, { version: 3 });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      const bytes = await readFile(body.data.path);
      const zip = await JSZip.loadAsync(bytes);
      // No cover.* file in the archive (epub-gen-memory writes cover.<ext>
      // only when options.cover is provided).
      const coverEntries = Object.keys(zip.files).filter((p) => /(^|\/)cover\.[a-z0-9]+$/i.test(p));
      expect(coverEntries).toEqual([]);
    });
  });
});
