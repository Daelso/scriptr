import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { createBundle } from "@/lib/storage/bundles";

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

describe("/api/bundles/[slug]", () => {
  const originalEnv = process.env;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scriptr-api-bundles-slug-"));
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

  it("GET returns bundle for existing slug", async () => {
    const created = await createBundle(process.env.SCRIPTR_DATA_DIR!, { title: "Findable" });
    const { GET } = await import("@/app/api/bundles/[slug]/route");
    const req = makeReq(`http://localhost/api/bundles/${created.slug}`);
    const ctx = { params: Promise.resolve({ slug: created.slug }) };
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.slug).toBe(created.slug);
  });

  it("GET returns 404 for missing slug", async () => {
    const { GET } = await import("@/app/api/bundles/[slug]/route");
    const req = makeReq("http://localhost/api/bundles/nope");
    const ctx = { params: Promise.resolve({ slug: "nope" }) };
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
  });

  it("PATCH updates allowed fields", async () => {
    const created = await createBundle(process.env.SCRIPTR_DATA_DIR!, { title: "Pat" });
    const { PATCH } = await import("@/app/api/bundles/[slug]/route");
    const req = makeReq(`http://localhost/api/bundles/${created.slug}`, {
      method: "PATCH",
      body: JSON.stringify({
        title: "Renamed",
        authorPenName: "Pen",
        description: "Blurb",
        language: "en",
        stories: [{ storySlug: "story-a", titleOverride: "Book One" }],
      }),
      headers: { "content-type": "application/json" },
    });
    const ctx = { params: Promise.resolve({ slug: created.slug }) };
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.title).toBe("Renamed");
    expect(body.data.authorPenName).toBe("Pen");
    expect(body.data.stories[0].titleOverride).toBe("Book One");
  });

  it("PATCH ignores unknown fields", async () => {
    const created = await createBundle(process.env.SCRIPTR_DATA_DIR!, { title: "Filter" });
    const { PATCH } = await import("@/app/api/bundles/[slug]/route");
    const req = makeReq(`http://localhost/api/bundles/${created.slug}`, {
      method: "PATCH",
      body: JSON.stringify({ slug: "hack", createdAt: "1999", junk: "ignored" }),
      headers: { "content-type": "application/json" },
    });
    const ctx = { params: Promise.resolve({ slug: created.slug }) };
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.slug).toBe(created.slug);
    expect(body.data.createdAt).toBe(created.createdAt);
  });

  it("PATCH on missing slug returns 404", async () => {
    const { PATCH } = await import("@/app/api/bundles/[slug]/route");
    const req = makeReq("http://localhost/api/bundles/nope", {
      method: "PATCH",
      body: JSON.stringify({ title: "x" }),
      headers: { "content-type": "application/json" },
    });
    const ctx = { params: Promise.resolve({ slug: "nope" }) };
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(404);
  });

  it("PATCH with malformed JSON returns 400", async () => {
    const created = await createBundle(process.env.SCRIPTR_DATA_DIR!, { title: "BadBody" });
    const { PATCH } = await import("@/app/api/bundles/[slug]/route");
    const req = makeReq(`http://localhost/api/bundles/${created.slug}`, {
      method: "PATCH",
      body: "not-json",
      headers: { "content-type": "application/json" },
    });
    const ctx = { params: Promise.resolve({ slug: created.slug }) };
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(400);
  });

  it("DELETE removes the bundle", async () => {
    const created = await createBundle(process.env.SCRIPTR_DATA_DIR!, { title: "Doomed" });
    const { DELETE } = await import("@/app/api/bundles/[slug]/route");
    const req = makeReq(`http://localhost/api/bundles/${created.slug}`);
    const ctx = { params: Promise.resolve({ slug: created.slug }) };
    const res = await DELETE(req, ctx);
    expect(res.status).toBe(200);

    const { GET } = await import("@/app/api/bundles/[slug]/route");
    const after = await GET(
      makeReq(`http://localhost/api/bundles/${created.slug}`),
      ctx
    );
    expect(after.status).toBe(404);
  });

  it("DELETE on missing slug returns 404", async () => {
    const { DELETE } = await import("@/app/api/bundles/[slug]/route");
    const req = makeReq("http://localhost/api/bundles/nope");
    const ctx = { params: Promise.resolve({ slug: "nope" }) };
    const res = await DELETE(req, ctx);
    expect(res.status).toBe(404);
  });
});
