import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";

describe("/api/bundles", () => {
  const originalEnv = process.env;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scriptr-api-bundles-"));
    process.env = { ...originalEnv, SCRIPTR_DATA_DIR: tmpDir };
    delete process.env.XAI_API_KEY;
  });
  afterEach(async () => {
    process.env = originalEnv;
    await rm(tmpDir, { recursive: true, force: true });
  });

  function makeReq(url: string, init?: RequestInit): NextRequest {
    return new Request(url, init) as unknown as NextRequest;
  }

  it("GET returns empty array on fresh install", async () => {
    const { GET } = await import("@/app/api/bundles/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toEqual([]);
  });

  it("POST creates bundle, returns 201 with summary fields", async () => {
    const { POST } = await import("@/app/api/bundles/route");
    const req = makeReq("http://localhost/api/bundles", {
      method: "POST",
      body: JSON.stringify({ title: "Big Box Set" }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.slug).toBe("big-box-set");
    expect(body.data.title).toBe("Big Box Set");
    expect(body.data.stories).toEqual([]);
  });

  it("POST without title returns 400", async () => {
    const { POST } = await import("@/app/api/bundles/route");
    const res = await POST(
      makeReq("http://localhost/api/bundles", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
      })
    );
    expect(res.status).toBe(400);
  });

  it("POST with malformed JSON returns 400", async () => {
    const { POST } = await import("@/app/api/bundles/route");
    const res = await POST(
      makeReq("http://localhost/api/bundles", {
        method: "POST",
        body: "not-json",
        headers: { "content-type": "application/json" },
      })
    );
    expect(res.status).toBe(400);
  });

  it("POST then GET returns the new bundle", async () => {
    const { POST, GET } = await import("@/app/api/bundles/route");
    await POST(
      makeReq("http://localhost/api/bundles", {
        method: "POST",
        body: JSON.stringify({ title: "Alpha" }),
        headers: { "content-type": "application/json" },
      })
    );
    const res = await GET();
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].title).toBe("Alpha");
  });
});
