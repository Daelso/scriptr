import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { getStory } from "@/lib/storage/stories";
import { listChapters } from "@/lib/storage/chapters";

function makeJsonReq(url: string, body: unknown): NextRequest {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const EMPTY_BIBLE = {
  characters: [],
  setting: "",
  pov: "third-limited" as const,
  tone: "",
  styleNotes: "",
  nsfwPreferences: "",
};

describe("POST /api/import/novelai/commit — new-story mode (single)", () => {
  let tmp: string;
  const originalEnv = process.env;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "scriptr-commit-"));
    process.env = { ...originalEnv, SCRIPTR_DATA_DIR: tmp };
  });
  afterEach(async () => {
    process.env = originalEnv;
    await rm(tmp, { recursive: true, force: true });
  });

  it("creates a story with description, keywords, bible, and chapters", async () => {
    const { POST } = await import("@/app/api/import/novelai/commit/route");
    const res = await POST(
      makeJsonReq("http://localhost/api/import/novelai/commit", {
        target: "new-story",
        stories: [
          {
            story: {
              title: "Imported Book",
              description: "a desc",
              keywords: ["a", "b"],
            },
            bible: {
              characters: [{ name: "Alice", description: "a woman" }],
              setting: "## Town\na small town",
              pov: "third-limited",
              tone: "",
              styleNotes: "some style",
              nsfwPreferences: "",
            },
            chapters: [
              { title: "One", body: "first chapter body" },
              { title: "", body: "second chapter body" },
            ],
          },
        ],
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.slugs).toEqual(["imported-book"]);
    expect(body.data.chapterIds).toHaveLength(2);

    const story = await getStory(tmp, "imported-book");
    expect(story?.description).toBe("a desc");
    expect(story?.keywords).toEqual(["a", "b"]);

    const bibleRaw = await readFile(
      join(tmp, "stories", "imported-book", "bible.json"),
      "utf-8"
    );
    const bible = JSON.parse(bibleRaw);
    expect(bible.characters[0].name).toBe("Alice");
    expect(bible.styleNotes).toBe("some style");

    const chapters = await listChapters(tmp, "imported-book");
    expect(chapters.map((c) => c.title)).toEqual(["One", "Untitled"]);
    expect(chapters[0].sections[0].content).toBe("first chapter body");
    expect(chapters[0].source).toBe("imported");
  });

  it("returns 400 when the bible shape is invalid", async () => {
    const { POST } = await import("@/app/api/import/novelai/commit/route");
    const res = await POST(
      makeJsonReq("http://localhost/api/import/novelai/commit", {
        target: "new-story",
        stories: [
          {
            story: { title: "Bad Bible", description: "", keywords: [] },
            bible: { characters: "not-an-array" }, // malformed
            chapters: [{ title: "x", body: "y" }],
          },
        ],
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/bible/i);
  });

  it("returns 400 when the stories array is empty", async () => {
    const { POST } = await import("@/app/api/import/novelai/commit/route");
    const res = await POST(
      makeJsonReq("http://localhost/api/import/novelai/commit", {
        target: "new-story",
        stories: [],
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/at least one story/i);
  });

  it("persists authorPenName when provided", async () => {
    const { POST } = await import("@/app/api/import/novelai/commit/route");
    const res = await POST(
      makeJsonReq("http://localhost/api/import/novelai/commit", {
        target: "new-story",
        stories: [
          {
            story: {
              title: "Pen Named Book",
              description: "",
              keywords: [],
              authorPenName: "Sarah Thorne",
            },
            bible: EMPTY_BIBLE,
            chapters: [{ title: "One", body: "body" }],
          },
        ],
      })
    );
    expect(res.status).toBe(200);
    const story = await getStory(tmp, "pen-named-book");
    expect(story?.authorPenName).toBe("Sarah Thorne");
  });

  it("defaults authorPenName to empty string when omitted (backwards-compat)", async () => {
    const { POST } = await import("@/app/api/import/novelai/commit/route");
    const res = await POST(
      makeJsonReq("http://localhost/api/import/novelai/commit", {
        target: "new-story",
        stories: [
          {
            story: { title: "No Pen Name", description: "", keywords: [] },
            bible: EMPTY_BIBLE,
            chapters: [{ title: "One", body: "body" }],
          },
        ],
      })
    );
    expect(res.status).toBe(200);
    const story = await getStory(tmp, "no-pen-name");
    expect(story?.authorPenName).toBe("");
  });

  it("rejects authorPenName when not a string", async () => {
    const { POST } = await import("@/app/api/import/novelai/commit/route");
    const res = await POST(
      makeJsonReq("http://localhost/api/import/novelai/commit", {
        target: "new-story",
        stories: [
          {
            story: {
              title: "Bad Pen Name",
              description: "",
              keywords: [],
              authorPenName: 42,
            },
            bible: EMPTY_BIBLE,
            chapters: [{ title: "One", body: "body" }],
          },
        ],
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/authorPenName must be a string/);
  });

  it("auto-suffixes the slug on collision", async () => {
    const { POST } = await import("@/app/api/import/novelai/commit/route");
    const first = await POST(
      makeJsonReq("http://localhost/api/import/novelai/commit", {
        target: "new-story",
        stories: [
          {
            story: { title: "Same Title", description: "", keywords: [] },
            bible: EMPTY_BIBLE,
            chapters: [{ title: "One", body: "body" }],
          },
        ],
      })
    );
    expect((await first.json()).data.slugs).toEqual(["same-title"]);

    const second = await POST(
      makeJsonReq("http://localhost/api/import/novelai/commit", {
        target: "new-story",
        stories: [
          {
            story: { title: "Same Title", description: "", keywords: [] },
            bible: EMPTY_BIBLE,
            chapters: [{ title: "One", body: "body" }],
          },
        ],
      })
    );
    expect((await second.json()).data.slugs).toEqual(["same-title-2"]);
  });
});

describe("POST /api/import/novelai/commit — new-story mode (multi)", () => {
  let tmp: string;
  const originalEnv = process.env;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "scriptr-commit-multi-"));
    process.env = { ...originalEnv, SCRIPTR_DATA_DIR: tmp };
  });
  afterEach(async () => {
    process.env = originalEnv;
    await rm(tmp, { recursive: true, force: true });
  });

  it("creates N separate stories, each with its own bible and chapters", async () => {
    const { POST } = await import("@/app/api/import/novelai/commit/route");
    const res = await POST(
      makeJsonReq("http://localhost/api/import/novelai/commit", {
        target: "new-story",
        stories: [
          {
            story: { title: "Saga - Part 1", description: "d1", keywords: ["a"] },
            bible: EMPTY_BIBLE,
            chapters: [{ title: "Opening", body: "s1 body" }],
          },
          {
            story: { title: "Saga - Part 2", description: "", keywords: [] },
            bible: EMPTY_BIBLE,
            chapters: [
              { title: "First", body: "s2 c1" },
              { title: "Second", body: "s2 c2" },
            ],
          },
        ],
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.slugs).toEqual(["saga-part-1", "saga-part-2"]);
    // Flattened chapterIds across all stories (1 + 2 = 3).
    expect(body.data.chapterIds).toHaveLength(3);

    const s1 = await getStory(tmp, "saga-part-1");
    expect(s1?.description).toBe("d1");
    expect(s1?.keywords).toEqual(["a"]);

    const s1Chapters = await listChapters(tmp, "saga-part-1");
    expect(s1Chapters.map((c) => c.title)).toEqual(["Opening"]);
    expect(s1Chapters[0].sections[0].content).toBe("s1 body");

    const s2Chapters = await listChapters(tmp, "saga-part-2");
    expect(s2Chapters.map((c) => c.title)).toEqual(["First", "Second"]);
  });
});

describe("POST /api/import/novelai/commit — existing-story mode", () => {
  let tmp: string;
  const originalEnv = process.env;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "scriptr-commit-ex-"));
    process.env = { ...originalEnv, SCRIPTR_DATA_DIR: tmp };
  });
  afterEach(async () => {
    process.env = originalEnv;
    await rm(tmp, { recursive: true, force: true });
  });

  it("appends chapters to an existing story", async () => {
    const { createStory } = await import("@/lib/storage/stories");
    const { createChapter } = await import("@/lib/storage/chapters");
    const story = await createStory(tmp, { title: "Host" });
    await createChapter(tmp, story.slug, { title: "Existing Ch 1" });

    const { POST } = await import("@/app/api/import/novelai/commit/route");
    const res = await POST(
      makeJsonReq("http://localhost/api/import/novelai/commit", {
        target: "existing-story",
        slug: story.slug,
        chapters: [
          { title: "New A", body: "new a body" },
          { title: "New B", body: "new b body" },
        ],
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.slug).toBe(story.slug);
    expect(body.data.chapterIds).toHaveLength(2);

    const all = await listChapters(tmp, story.slug);
    expect(all.map((c) => c.title)).toEqual(["Existing Ch 1", "New A", "New B"]);
    expect(all[1].source).toBe("imported");
  });

  it("returns 404 when the story slug does not exist", async () => {
    const { POST } = await import("@/app/api/import/novelai/commit/route");
    const res = await POST(
      makeJsonReq("http://localhost/api/import/novelai/commit", {
        target: "existing-story",
        slug: "does-not-exist",
        chapters: [{ title: "x", body: "y" }],
      })
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Story not found.");
  });

  it("runs cleanPaste: scene breaks within a body split into multiple sections", async () => {
    const { createStory } = await import("@/lib/storage/stories");
    const story = await createStory(tmp, { title: "Scenes" });

    const body = [
      "Opening paragraph of scene one.",
      "",
      "Second paragraph of scene one.",
      "",
      "***",
      "",
      "Opening paragraph of scene two.",
      "",
      "Second paragraph of scene two.",
    ].join("\n");

    const { POST } = await import("@/app/api/import/novelai/commit/route");
    const res = await POST(
      makeJsonReq("http://localhost/api/import/novelai/commit", {
        target: "existing-story",
        slug: story.slug,
        chapters: [{ title: "Two Scenes", body }],
      })
    );
    expect(res.status).toBe(200);

    const all = await listChapters(tmp, story.slug);
    const ch = all[all.length - 1];
    expect(ch.sections.length).toBe(2);
    expect(ch.sections[0].content).toContain("scene one");
    expect(ch.sections[0].content).not.toContain("scene two");
    expect(ch.sections[1].content).toContain("scene two");
    expect(ch.sections[1].content).not.toContain("scene one");
  });
});
