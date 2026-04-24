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
  filename = "sample.story"
): NextRequest {
  const fd = new FormData();
  if (file) {
    fd.append(
      "file",
      new Blob([new Uint8Array(file)], { type: "application/octet-stream" }),
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

  it("returns parsed/split/proposed for the fixture", async () => {
    const file = await readFile(FIXTURE);
    const { POST } = await import("@/app/api/import/novelai/parse/route");
    const res = await POST(
      makeReq("http://localhost/api/import/novelai/parse", file)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.parsed.title).toBe("Garden at Dusk");
    expect(body.data.split.splitSource).toBe("marker");
    expect(body.data.split.chapters.length).toBeGreaterThanOrEqual(2);
    expect(body.data.proposed.story.keywords).toEqual(["fixture", "test"]);
    expect(body.data.proposed.bible.characters.map((c: { name: string }) => c.name))
      .toContain("Mira");
  });
});
