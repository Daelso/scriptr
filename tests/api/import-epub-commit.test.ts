import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { POST as commitPost } from "@/app/api/import/epub/commit/route";
import { POST as parsePost } from "@/app/api/import/epub/parse/route";
import { _resetCacheForTests, putCover } from "@/lib/epub/cover-cache";
import { effectiveDataDir } from "@/lib/config";
import { storyJson, bibleJson, coverPath } from "@/lib/storage/paths";

const FIXTURE_DIR = join(__dirname, "..", "..", "lib", "epub", "__fixtures__");

let dataDir: string;
let originalEnv: string | undefined;

beforeEach(async () => {
  _resetCacheForTests();
  dataDir = await mkdtemp(join(tmpdir(), "scriptr-epub-commit-"));
  originalEnv = process.env.SCRIPTR_DATA_DIR;
  process.env.SCRIPTR_DATA_DIR = dataDir;
  expect(effectiveDataDir()).toBe(dataDir);
});

afterEach(async () => {
  if (originalEnv === undefined) delete process.env.SCRIPTR_DATA_DIR;
  else process.env.SCRIPTR_DATA_DIR = originalEnv;
  await rm(dataDir, { recursive: true, force: true });
});

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/import/epub/commit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readBody<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe("POST /api/import/epub/commit — happy path", () => {
  it("creates story, bible, chapters, and cover from a parsed EPUB", async () => {
    const epubBuf = await readFile(join(FIXTURE_DIR, "sample-kdp.epub"));
    const form = new FormData();
    form.set("file", new File([new Uint8Array(epubBuf)], "book.epub", { type: "application/epub+zip" }));
    const parseRes = await parsePost(new Request("http://localhost/api/import/epub/parse", { method: "POST", body: form }) as never);
    const parseBody = await readBody<{ data: { sessionId: string; proposed: { story: { title: string; description: string; keywords: string[]; authorPenName: string }; chapters: Array<{ navTitle: string; body: string; skippedByDefault: boolean }> } } }>(parseRes);
    const proposed = parseBody.data.proposed;
    const chaptersToCommit = proposed.chapters.filter((c) => !c.skippedByDefault).map((c) => ({ title: c.navTitle, body: c.body }));

    const res = await commitPost(jsonRequest({
      sessionId: parseBody.data.sessionId,
      story: proposed.story,
      importCover: true,
      chapters: chaptersToCommit,
    }) as never);
    expect(res.status).toBe(200);
    const body = await readBody<{ ok: true; data: { slug: string; chapterIds: string[] } }>(res);
    expect(body.ok).toBe(true);
    expect(body.data.slug).toMatch(/garden/);
    expect(body.data.chapterIds).toHaveLength(3);

    const storyRaw = await readFile(storyJson(dataDir, body.data.slug), "utf-8");
    const story = JSON.parse(storyRaw) as { title: string; description: string; keywords: string[]; chapterOrder: string[] };
    expect(story.title).toBe("The Garden Wall");
    expect(story.chapterOrder).toEqual(body.data.chapterIds);

    const bible = JSON.parse(await readFile(bibleJson(dataDir, body.data.slug), "utf-8")) as { pov: string; characters: unknown[] };
    expect(bible.pov).toBe("third-limited");
    expect(bible.characters).toEqual([]);

    const coverStat = await stat(coverPath(dataDir, body.data.slug));
    expect(coverStat.size).toBeGreaterThan(0);
  });
});

describe("POST /api/import/epub/commit — cover branches", () => {
  it("importCover=true + sessionId=null → no cover written, no error", async () => {
    const res = await commitPost(jsonRequest({
      sessionId: null,
      story: { title: "X", description: "", keywords: [], authorPenName: "" },
      importCover: true,
      chapters: [{ title: "Ch1", body: "Some real prose." }],
    }) as never);
    expect(res.status).toBe(200);
    const body = await readBody<{ ok: true; data: { slug: string } }>(res);
    await expect(stat(coverPath(dataDir, body.data.slug))).rejects.toThrow();
  });

  it("importCover=false + valid sessionId → no cover written", async () => {
    const sessionId = putCover({
      mimeType: "image/jpeg",
      bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    });
    const res = await commitPost(jsonRequest({
      sessionId,
      story: { title: "Y", description: "", keywords: [], authorPenName: "" },
      importCover: false,
      chapters: [{ title: "Ch1", body: "Some real prose." }],
    }) as never);
    const body = await readBody<{ ok: true; data: { slug: string } }>(res);
    await expect(stat(coverPath(dataDir, body.data.slug))).rejects.toThrow();
  });

  it("importCover=true + bad sessionId (cache miss) → cover skipped, story still created", async () => {
    const res = await commitPost(jsonRequest({
      sessionId: "nope-not-a-real-uuid",
      story: { title: "Z", description: "", keywords: [], authorPenName: "" },
      importCover: true,
      chapters: [{ title: "Ch1", body: "Some real prose." }],
    }) as never);
    expect(res.status).toBe(200);
    const body = await readBody<{ ok: true; data: { slug: string } }>(res);
    expect(body.ok).toBe(true);
    await expect(stat(coverPath(dataDir, body.data.slug))).rejects.toThrow();
  });

  it("importCover=true + cached unknown mime → cover skipped, no error", async () => {
    const sessionId = putCover({ mimeType: "application/octet-stream", bytes: new Uint8Array([1, 2, 3]) });
    const res = await commitPost(jsonRequest({
      sessionId,
      story: { title: "W", description: "", keywords: [], authorPenName: "" },
      importCover: true,
      chapters: [{ title: "Ch1", body: "Some real prose." }],
    }) as never);
    expect(res.status).toBe(200);
    const body = await readBody<{ ok: true; data: { slug: string } }>(res);
    await expect(stat(coverPath(dataDir, body.data.slug))).rejects.toThrow();
  });
});

describe("POST /api/import/epub/commit — validation", () => {
  it("400 on empty chapters[]", async () => {
    const res = await commitPost(jsonRequest({
      sessionId: null,
      story: { title: "X", description: "", keywords: [], authorPenName: "" },
      importCover: false,
      chapters: [],
    }) as never);
    expect(res.status).toBe(400);
    const body = await readBody<{ ok: false; error: string }>(res);
    expect(body.error).toBe("Need at least one chapter to import.");
  });

  it("400 on missing title", async () => {
    const res = await commitPost(jsonRequest({
      sessionId: null,
      story: { title: "", description: "", keywords: [], authorPenName: "" },
      importCover: false,
      chapters: [{ title: "Ch1", body: "x" }],
    }) as never);
    expect(res.status).toBe(400);
  });

  it("400 on chapter with empty body", async () => {
    const res = await commitPost(jsonRequest({
      sessionId: null,
      story: { title: "X", description: "", keywords: [], authorPenName: "" },
      importCover: false,
      chapters: [{ title: "Ch1", body: "   " }],
    }) as never);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/import/epub/commit — atomicity", () => {
  it("rolls back the story dir if a chapter write throws", async () => {
    const chapters = vi.spyOn(await import("@/lib/storage/chapters"), "createImportedChapter")
      .mockImplementationOnce(async () => { throw new Error("disk full"); });
    try {
      const res = await commitPost(jsonRequest({
        sessionId: null,
        story: { title: "Rollback", description: "", keywords: [], authorPenName: "" },
        importCover: false,
        chapters: [{ title: "Ch1", body: "x" }],
      }) as never);
      expect(res.status).toBe(500);
      const { readdir } = await import("node:fs/promises");
      const storiesDir = join(dataDir, "stories");
      const dirs = await readdir(storiesDir).catch(() => []);
      expect(dirs).toEqual([]);
    } finally {
      chapters.mockRestore();
    }
  });
});
