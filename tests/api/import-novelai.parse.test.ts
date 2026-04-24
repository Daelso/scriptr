import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";

const FIXTURE = join(
  __dirname,
  "..",
  "..",
  "lib",
  "novelai",
  "__fixtures__",
  "sample.story"
);

function makeReq(
  url: string,
  file: Buffer | null,
  filename = "sample.story",
  type = "application/octet-stream"
): NextRequest {
  const fd = new FormData();
  if (file) {
    fd.append(
      "file",
      new Blob([new Uint8Array(file)], { type }),
      filename
    );
  }
  return new Request(url, { method: "POST", body: fd }) as unknown as NextRequest;
}

describe("POST /api/import/novelai/parse — errors", () => {
  let tmp: string;
  const originalEnv = process.env;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "scriptr-parse-"));
    process.env = { ...originalEnv, SCRIPTR_DATA_DIR: tmp };
  });
  afterEach(async () => {
    process.env = originalEnv;
    await rm(tmp, { recursive: true, force: true });
  });

  it("returns 400 when no file is attached", async () => {
    const { POST } = await import("@/app/api/import/novelai/parse/route");
    const res = await POST(makeReq("http://localhost/api/import/novelai/parse", null));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("No file uploaded.");
  });

  it("returns 400 with user-facing error on non-JSON garbage", async () => {
    const { POST } = await import("@/app/api/import/novelai/parse/route");
    const req = makeReq(
      "http://localhost/api/import/novelai/parse",
      Buffer.from("this is not json at all")
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("File is not a valid NovelAI .story file.");
  });

  it("returns 400 for unsupported version", async () => {
    const { POST } = await import("@/app/api/import/novelai/parse/route");
    const req = makeReq(
      "http://localhost/api/import/novelai/parse",
      Buffer.from(
        JSON.stringify({ storyContainerVersion: 99, metadata: {}, content: {} })
      )
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Unsupported NovelAI format version");
  });
});

describe("POST /api/import/novelai/parse — happy path", () => {
  let tmp: string;
  const originalEnv = process.env;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "scriptr-parse-"));
    process.env = { ...originalEnv, SCRIPTR_DATA_DIR: tmp };
  });
  afterEach(async () => {
    process.env = originalEnv;
    await rm(tmp, { recursive: true, force: true });
  });

  it("returns parsed/stories for the fixture (//// splits into multiple stories)", async () => {
    const file = await readFile(FIXTURE);
    const { POST } = await import("@/app/api/import/novelai/parse/route");
    const res = await POST(
      makeReq("http://localhost/api/import/novelai/parse", file)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.parsed.title).toBe("Garden at Dusk");
    expect(Array.isArray(body.data.stories)).toBe(true);
    // The fixture's //// is now a story marker → 2 stories.
    expect(body.data.stories.length).toBeGreaterThanOrEqual(2);
    // Story 1 retains the mapped bible + description from the fixture.
    const first = body.data.stories[0];
    expect(first.proposed.story.keywords).toEqual(["fixture", "test"]);
    expect(
      first.proposed.bible.characters.map((c: { name: string }) => c.name)
    ).toContain("Mira");
    // Story 2 inherits nothing (empty bible, no keywords).
    const second = body.data.stories[1];
    expect(second.proposed.story.keywords).toEqual([]);
    expect(second.proposed.bible.characters).toEqual([]);
    // Multi-story titles are suffixed "Part N".
    expect(first.proposed.story.title).toMatch(/Part 1/);
    expect(second.proposed.story.title).toMatch(/Part 2/);
  });

  it("returns a single story (no Part suffix) when there are no //// markers", async () => {
    const text = [
      "Chapter 1",
      "",
      "Opening prose.",
      "",
      "Chapter 2",
      "",
      "More prose.",
    ].join("\n");
    const { POST } = await import("@/app/api/import/novelai/parse/route");
    const res = await POST(
      makeReq(
        "http://localhost/api/import/novelai/parse",
        Buffer.from(text, "utf-8"),
        "Single (2026-04-24T14_16_27.902Z).txt",
        "text/plain"
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.stories).toHaveLength(1);
    expect(body.data.stories[0].split.splitSource).toBe("heading");
    expect(body.data.stories[0].split.chapters).toHaveLength(2);
    // Title is unadorned (no "Part 1" suffix) when there's only one story.
    expect(body.data.stories[0].proposed.story.title).toBe("Single");
  });

  it("returns multiple stories when the input has //// markers", async () => {
    const text = [
      "First story body.",
      "",
      "////",
      "",
      "Second story body.",
      "",
      "////",
      "",
      "Third story body.",
    ].join("\n");
    const { POST } = await import("@/app/api/import/novelai/parse/route");
    const res = await POST(
      makeReq(
        "http://localhost/api/import/novelai/parse",
        Buffer.from(text, "utf-8"),
        "Triple.txt",
        "text/plain"
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.stories).toHaveLength(3);
    expect(body.data.stories[0].proposed.story.title).toBe("Triple - Part 1");
    expect(body.data.stories[1].proposed.story.title).toBe("Triple - Part 2");
    expect(body.data.stories[2].proposed.story.title).toBe("Triple - Part 3");
  });

  it("accepts a .txt upload and cleans NovelAI artifacts", async () => {
    const text = [
      "Story Premise (fixed canon):",
      "User-typed canon that should be dropped.",
      "More directives.",
      "[1/2]",
      "[1/2]",
      '"Dare," I said.',
      "",
      "{ Author note that should vanish. }",
      "",
      "More of the story continues here.",
      "",
      "[2/2]",
      "Second page of prose.",
    ].join("\n");

    const buf = Buffer.from(text, "utf-8");
    const { POST } = await import("@/app/api/import/novelai/parse/route");
    const res = await POST(
      makeReq(
        "http://localhost/api/import/novelai/parse",
        buf,
        "My Story (2026-04-24T14_16_27.902Z).txt",
        "text/plain"
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // Title derived from filename (timestamp suffix stripped).
    expect(body.data.parsed.title).toBe("My Story");
    // Bible/fields empty for .txt imports.
    expect(body.data.parsed.tags).toEqual([]);
    expect(body.data.parsed.contextBlocks).toEqual([]);
    expect(body.data.parsed.lorebookEntries).toEqual([]);
    expect(body.data.parsed.description).toBe("");
    // Cleaned prose contains short dialogue and no markers/notes/premise.
    expect(body.data.parsed.prose).toContain('"Dare," I said.');
    expect(body.data.parsed.prose).toContain("More of the story continues");
    expect(body.data.parsed.prose).toContain("Second page of prose.");
    expect(body.data.parsed.prose).not.toContain("Story Premise");
    expect(body.data.parsed.prose).not.toContain("User-typed canon");
    expect(body.data.parsed.prose).not.toContain("[1/2]");
    expect(body.data.parsed.prose).not.toContain("[2/2]");
    expect(body.data.parsed.prose).not.toContain("Author note");
    expect(body.data.parsed.prose).not.toContain("{");
    expect(body.data.parsed.prose).not.toContain("}");
  });
});
