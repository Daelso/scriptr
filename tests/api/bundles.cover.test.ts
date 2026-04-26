import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import sharp from "sharp";
import { createBundle } from "@/lib/storage/bundles";
import { bundleCoverPath } from "@/lib/storage/paths";

async function makeJpeg(w: number, h: number): Promise<Buffer> {
  return sharp({
    create: { width: w, height: h, channels: 3, background: { r: 80, g: 80, b: 80 } },
  })
    .jpeg({ quality: 85 })
    .toBuffer();
}

describe("/api/bundles/[slug]/cover", () => {
  const originalEnv = process.env;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scriptr-bundle-cover-"));
    process.env = { ...originalEnv, SCRIPTR_DATA_DIR: tmpDir };
  });
  afterEach(async () => {
    process.env = originalEnv;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("PUT 404s for missing bundle", async () => {
    const { PUT } = await import("@/app/api/bundles/[slug]/cover/route");
    const fd = new FormData();
    fd.append("cover", new Blob([new Uint8Array(await makeJpeg(1600, 2560))], { type: "image/jpeg" }), "c.jpg");
    const req = new Request("http://localhost/api/bundles/nope/cover", {
      method: "PUT",
      body: fd,
    }) as unknown as NextRequest;
    const ctx = { params: Promise.resolve({ slug: "nope" }) };
    const res = await PUT(req, ctx);
    expect(res.status).toBe(404);
  });

  it("PUT writes cover.jpg and warns on small dimensions", async () => {
    const b = await createBundle(tmpDir, { title: "Cov" });
    const { PUT } = await import("@/app/api/bundles/[slug]/cover/route");
    const fd = new FormData();
    fd.append("cover", new Blob([new Uint8Array(await makeJpeg(800, 1280))], { type: "image/jpeg" }), "c.jpg");
    const req = new Request(`http://localhost/api/bundles/${b.slug}/cover`, {
      method: "PUT",
      body: fd,
    }) as unknown as NextRequest;
    const ctx = { params: Promise.resolve({ slug: b.slug }) };
    const res = await PUT(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.warnings.length).toBeGreaterThan(0);

    await expect(access(bundleCoverPath(tmpDir, b.slug))).resolves.toBeUndefined();
  });

  it("PUT rejects unsupported types", async () => {
    const b = await createBundle(tmpDir, { title: "Bad" });
    const { PUT } = await import("@/app/api/bundles/[slug]/cover/route");
    const fd = new FormData();
    fd.append("cover", new Blob([new Uint8Array([0x47, 0x49, 0x46])], { type: "image/gif" }), "c.gif");
    const req = new Request(`http://localhost/api/bundles/${b.slug}/cover`, {
      method: "PUT",
      body: fd,
    }) as unknown as NextRequest;
    const ctx = { params: Promise.resolve({ slug: b.slug }) };
    const res = await PUT(req, ctx);
    expect(res.status).toBe(415);
  });

  it("DELETE removes cover.jpg if present, succeeds idempotently if absent", async () => {
    const b = await createBundle(tmpDir, { title: "Cov2" });
    const { PUT, DELETE } = await import("@/app/api/bundles/[slug]/cover/route");

    const fd = new FormData();
    fd.append("cover", new Blob([new Uint8Array(await makeJpeg(1600, 2560))], { type: "image/jpeg" }), "c.jpg");
    const putReq = new Request(`http://localhost/api/bundles/${b.slug}/cover`, {
      method: "PUT",
      body: fd,
    }) as unknown as NextRequest;
    const ctx = { params: Promise.resolve({ slug: b.slug }) };
    await PUT(putReq, ctx);

    const delReq = new Request(`http://localhost/api/bundles/${b.slug}/cover`, {
      method: "DELETE",
    }) as unknown as NextRequest;
    const res1 = await DELETE(delReq, ctx);
    expect(res1.status).toBe(200);

    const res2 = await DELETE(delReq, ctx);
    expect(res2.status).toBe(200);
  });
});
