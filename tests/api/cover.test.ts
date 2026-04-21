import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
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

  it("rejects over-10MB with 413", async () => {
    const story = await createStory(tmpDir, { title: "S" });
    const huge = new Uint8Array(11 * 1024 * 1024);
    huge[0] = 0xff; huge[1] = 0xd8; huge[2] = 0xff;
    const blob = new Blob([huge], { type: "image/jpeg" });
    const res = await callPut(story.slug, blob);
    expect(res.status).toBe(413);
  });

  it("writes cover.jpg and returns 200", async () => {
    const story = await createStory(tmpDir, { title: "S" });
    const jpg = new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])], {
      type: "image/jpeg",
    });
    const res = await callPut(story.slug, jpg);
    expect(res.status).toBe(200);
    const statResult = await stat(coverPath(tmpDir, story.slug));
    expect(statResult.isFile()).toBe(true);
  });
});
