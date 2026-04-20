import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { GET } from "@/app/api/privacy/last-payload/route";
import { createStory } from "@/lib/storage/stories";
import { lastPayloadFile } from "@/lib/storage/paths";

function makeReq(url: string): NextRequest {
  return new Request(url) as unknown as NextRequest;
}

describe("/api/privacy/last-payload", () => {
  const originalEnv = process.env;
  let tmpDir: string;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    tmpDir = await mkdtemp(join(tmpdir(), "scriptr-privacy-"));
    process.env.SCRIPTR_DATA_DIR = tmpDir;
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns 400 when slug query param is missing", async () => {
    const res = await GET(makeReq("http://localhost/api/privacy/last-payload"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/slug/i);
  });

  it("returns 404 when story does not exist", async () => {
    const res = await GET(
      makeReq("http://localhost/api/privacy/last-payload?slug=nonexistent")
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it("returns { ok: true, data: null } when story exists but .last-payload.json is absent", async () => {
    const story = await createStory(tmpDir, { title: "Test Story" });
    const res = await GET(
      makeReq(`http://localhost/api/privacy/last-payload?slug=${story.slug}`)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toBeNull();
  });

  it("returns the exact JSON payload when .last-payload.json exists", async () => {
    const story = await createStory(tmpDir, { title: "Test Story" });
    const payload = {
      model: "grok-4-latest",
      mode: "full",
      system: "You are a writer.",
      user: "Write chapter 1.",
    };
    await writeFile(lastPayloadFile(tmpDir, story.slug), JSON.stringify(payload), "utf-8");

    const res = await GET(
      makeReq(`http://localhost/api/privacy/last-payload?slug=${story.slug}`)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toEqual(payload);
  });

  it("payload response body does not contain an API key (route is a thin pass-through with no key injection)", async () => {
    const story = await createStory(tmpDir, { title: "Test Story" });
    // Synthetic payload matching the exact contract: model/mode/system/user only
    const payload = {
      model: "grok-4-latest",
      mode: "full",
      system: "System prompt here.",
      user: "User prompt here.",
    };
    await writeFile(lastPayloadFile(tmpDir, story.slug), JSON.stringify(payload), "utf-8");

    const res = await GET(
      makeReq(`http://localhost/api/privacy/last-payload?slug=${story.slug}`)
    );
    const body = await res.json();
    const bodyStr = JSON.stringify(body);

    // Confirm the payload shape is exactly the contract (no extra keys, especially no apiKey)
    expect(Object.keys(body.data).sort()).toEqual(["mode", "model", "system", "user"]);
    // Privacy assertion: no API key patterns appear in the response
    expect(bodyStr).not.toMatch(/xai-[a-zA-Z0-9]/);
    expect(bodyStr).not.toContain("apiKey");
    expect(bodyStr).not.toContain("api_key");
  });

  it("route passes through the payload unmodified (no key filtering or rewriting)", async () => {
    const story = await createStory(tmpDir, { title: "Test Story" });
    const payload = {
      model: "grok-4-latest",
      mode: "section",
      system: "System: write erotica.",
      user: "Continue from here.",
    };
    await writeFile(lastPayloadFile(tmpDir, story.slug), JSON.stringify(payload), "utf-8");

    const res = await GET(
      makeReq(`http://localhost/api/privacy/last-payload?slug=${story.slug}`)
    );
    const body = await res.json();
    // Full round-trip equality — route is a pure pass-through
    expect(body.data).toStrictEqual(payload);
  });
});
