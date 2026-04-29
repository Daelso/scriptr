import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import sharp from "sharp";
import { createStory } from "@/lib/storage/stories";
import { coverPath } from "@/lib/storage/paths";

describe("/api/stories/[slug]/cover PUT", () => {
  const originalEnv = process.env;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scriptr-cover-api-"));
    process.env = { ...originalEnv, SCRIPTR_DATA_DIR: tmpDir };
  });
  afterEach(async () => {
    process.env = originalEnv;
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function callPut(slug: string, file: Blob, fieldName = "cover") {
    const { PUT } = await import("@/app/api/stories/[slug]/cover/route");
    const form = new FormData();
    form.append(fieldName, file, "cover.jpg");
    const req = new Request(`http://localhost/api/stories/${slug}/cover`, {
      method: "PUT",
      body: form,
    }) as unknown as NextRequest;
    const ctx = { params: Promise.resolve({ slug }) };
    return PUT(req, ctx);
  }

  async function makeJpeg(w: number, h: number, orientation?: number): Promise<Buffer> {
    let pipeline = sharp({
      create: { width: w, height: h, channels: 3, background: { r: 80, g: 80, b: 80 } },
    });
    if (orientation !== undefined) {
      pipeline = pipeline.withMetadata({ orientation });
    }
    return pipeline.jpeg({ quality: 85 }).toBuffer();
  }

  it("returns 404 for unknown story", async () => {
    const jpg = new Blob([Buffer.from([0xff, 0xd8, 0xff])], { type: "image/jpeg" });
    const res = await callPut("nope", jpg);
    expect(res.status).toBe(404);
  });

  it("rejects non-image MIME with 415", async () => {
    const story = await createStory(tmpDir, { title: "S" });
    const txt = new Blob(["hello"], { type: "text/plain" });
    const res = await callPut(story.slug, txt);
    expect(res.status).toBe(415);
  });

  it("rejects over-20MB with 413", async () => {
    const story = await createStory(tmpDir, { title: "S" });
    const huge = new Uint8Array(21 * 1024 * 1024);
    huge[0] = 0xff; huge[1] = 0xd8; huge[2] = 0xff;
    const blob = new Blob([huge], { type: "image/jpeg" });
    const res = await callPut(story.slug, blob);
    expect(res.status).toBe(413);
  });

  it("writes cover.jpg and returns 200", async () => {
    const story = await createStory(tmpDir, { title: "S" });
    const jpg = new Blob([new Uint8Array(await makeJpeg(1600, 2560))], { type: "image/jpeg" });
    const res = await callPut(story.slug, jpg);
    expect(res.status).toBe(200);
    const statResult = await stat(coverPath(tmpDir, story.slug));
    expect(statResult.isFile()).toBe(true);
  });

  it("returns 400 for corrupt image bytes with accepted MIME", async () => {
    const story = await createStory(tmpDir, { title: "S" });
    const corrupt = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])], {
      type: "image/png",
    });
    const res = await callPut(story.slug, corrupt);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid image data");
  });

  describe("GET", () => {
    async function callGet(slug: string) {
      const { GET } = await import("@/app/api/stories/[slug]/cover/route");
      const req = new Request(`http://localhost/api/stories/${slug}/cover`) as unknown as NextRequest;
      const ctx = { params: Promise.resolve({ slug }) };
      return GET(req, ctx);
    }

    it("returns 404 for unknown story", async () => {
      const res = await callGet("nope");
      expect(res.status).toBe(404);
    });

    it("returns 404 when story exists but no cover on disk", async () => {
      const story = await createStory(tmpDir, { title: "S" });
      const res = await callGet(story.slug);
      expect(res.status).toBe(404);
    });

    it("streams the JPEG bytes with image/jpeg content-type", async () => {
      const story = await createStory(tmpDir, { title: "S" });
      const jpg = new Blob([new Uint8Array(await makeJpeg(1600, 2560))], { type: "image/jpeg" });
      await callPut(story.slug, jpg);

      const res = await callGet(story.slug);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/jpeg");
      expect(res.headers.get("cache-control")).toBe("no-store");

      const body = Buffer.from(await res.arrayBuffer());
      const onDisk = await readFile(coverPath(tmpDir, story.slug));
      expect(body.equals(onDisk)).toBe(true);
    });
  });

  it("normalizes EXIF orientation for JPEG uploads", async () => {
    const story = await createStory(tmpDir, { title: "S" });
    const oriented = new Blob([new Uint8Array(await makeJpeg(3, 2, 6))], {
      type: "image/jpeg",
    });
    const res = await callPut(story.slug, oriented);
    expect(res.status).toBe(200);

    const meta = await sharp(coverPath(tmpDir, story.slug)).metadata();
    expect(meta.width).toBe(2);
    expect(meta.height).toBe(3);
    expect(meta.orientation).not.toBe(6);
  });
});
