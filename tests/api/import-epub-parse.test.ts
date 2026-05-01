import { describe, it, expect, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { POST } from "@/app/api/import/epub/parse/route";
import { _resetCacheForTests, getCover } from "@/lib/epub/cover-cache";

const FIXTURE_DIR = join(__dirname, "..", "..", "lib", "epub", "__fixtures__");

beforeEach(() => {
  _resetCacheForTests();
});

function makeRequest(buf: Buffer | null, filename = "book.epub"): Request {
  if (!buf) {
    return new Request("http://localhost/api/import/epub/parse", { method: "POST" });
  }
  const form = new FormData();
  form.set("file", new File([new Uint8Array(buf)], filename, { type: "application/epub+zip" }));
  return new Request("http://localhost/api/import/epub/parse", { method: "POST", body: form });
}

async function readBody<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe("POST /api/import/epub/parse — happy path (KDP fixture)", () => {
  it("returns parsed metadata, proposed write, and a sessionId", async () => {
    const buf = await readFile(join(FIXTURE_DIR, "sample-kdp.epub"));
    const res = await POST(makeRequest(buf) as never);
    expect(res.status).toBe(200);
    const body = await readBody<{ ok: true; data: { parsed: { metadata: { title: string; subjects: string[] } }; proposed: { story: { title: string; keywords: string[] }; chapters: Array<{ navTitle: string; skippedByDefault: boolean }> }; coverPreview: string | null; sessionId: string } }>(res);
    expect(body.ok).toBe(true);
    expect(body.data.parsed.metadata.title).toBe("The Garden Wall");
    expect(body.data.parsed.metadata.subjects).toEqual(["FIC027010", "romance"]);
    expect(body.data.proposed.story.title).toBe("The Garden Wall");
    expect(body.data.proposed.chapters.filter((c) => c.skippedByDefault)).toHaveLength(3);
    expect(typeof body.data.sessionId).toBe("string");
    expect(body.data.sessionId.length).toBeGreaterThan(0);
  });

  it("populates coverPreview as a data URL and stores raw bytes in cover-cache", async () => {
    const buf = await readFile(join(FIXTURE_DIR, "sample-kdp.epub"));
    const res = await POST(makeRequest(buf) as never);
    const body = await readBody<{ ok: true; data: { coverPreview: string | null; sessionId: string } }>(res);
    expect(body.data.coverPreview).toMatch(/^data:image\/jpeg;base64,/);
    const cached = getCover(body.data.sessionId);
    expect(cached).toBeDefined();
    expect(cached!.mimeType).toBe("image/png");
  });

  it("strips cover.bytes from the JSON response (replaced by hasCover flag)", async () => {
    const buf = await readFile(join(FIXTURE_DIR, "sample-kdp.epub"));
    const res = await POST(makeRequest(buf) as never);
    const json = await res.text();
    expect(json).not.toMatch(/"bytes":\[\d/);
    const body = JSON.parse(json) as { ok: true; data: { parsed: { hasCover: boolean }; proposed: { hasCover: boolean } } };
    expect(body.data.parsed.hasCover).toBe(true);
    expect(body.data.proposed.hasCover).toBe(true);
  });
});

describe("POST /api/import/epub/parse — no-cover fixture", () => {
  it("returns coverPreview: null, hasCover: false, and an empty sessionId", async () => {
    const buf = await readFile(join(FIXTURE_DIR, "sample-nonav.epub"));
    const res = await POST(makeRequest(buf) as never);
    expect(res.status).toBe(200);
    const body = await readBody<{ ok: true; data: { coverPreview: string | null; sessionId: string; parsed: { hasCover: boolean } } }>(res);
    expect(body.data.coverPreview).toBeNull();
    expect(body.data.parsed.hasCover).toBe(false);
    expect(body.data.sessionId).toBe("");
  });
});

describe("POST /api/import/epub/parse — error responses", () => {
  it("400 when no file uploaded", async () => {
    const res = await POST(makeRequest(null) as never);
    expect(res.status).toBe(400);
    const body = await readBody<{ ok: false; error: string }>(res);
    expect(body.error).toBe("No file uploaded.");
  });

  it("400 when file is not a valid EPUB", async () => {
    const res = await POST(makeRequest(Buffer.from("not a zip")) as never);
    expect(res.status).toBe(400);
    const body = await readBody<{ ok: false; error: string }>(res);
    expect(body.error).toMatch(/not a valid EPUB/);
  });

  it("400 when file exceeds 50 MB cap", async () => {
    const big = Buffer.alloc(50 * 1024 * 1024 + 1);
    const res = await POST(makeRequest(big) as never);
    expect(res.status).toBe(400);
    const body = await readBody<{ ok: false; error: string }>(res);
    expect(body.error).toBe("File too large (limit 50MB).");
  });
});
