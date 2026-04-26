import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { GET, PUT } from "@/app/api/settings/route";

describe("/api/settings", () => {
  const originalEnv = process.env;
  let tmpDir: string;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    tmpDir = await mkdtemp(join(tmpdir(), "scriptr-settings-"));
    process.env.SCRIPTR_DATA_DIR = tmpDir;
    delete process.env.XAI_API_KEY;
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("GET on fresh install returns defaults, no apiKey field exposed", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.hasKey).toBe(false);
    expect(body.data.keyPreview).toBeUndefined();
    expect(body.data.defaultModel).toBe("grok-4-latest");
    expect(body.data.bindHost).toBe("127.0.0.1");
    expect(body.data.theme).toBe("system");
    expect(body.data.autoRecap).toBe(true);
    expect(body.data.includeLastChapterFullText).toBe(false);
    // Privacy: raw apiKey must never appear in the response
    expect("apiKey" in body.data).toBe(false);
    expect(JSON.stringify(body)).not.toContain("apiKey");
  });

  it("PUT then GET round-trip returns masked key, never the raw key", async () => {
    const req = new Request("http://localhost/api/settings", {
      method: "PUT",
      body: JSON.stringify({ apiKey: "xai-abc1234567890ab" }),
      headers: { "content-type": "application/json" },
    }) as unknown as NextRequest;

    const putRes = await PUT(req);
    expect(putRes.status).toBe(200);
    const putBody = await putRes.json();
    expect(putBody.ok).toBe(true);
    expect(putBody.data.hasKey).toBe(true);
    expect(putBody.data.keyPreview).toBe("xai-••••90ab");
    // Privacy: raw tail must not appear in the PUT response
    expect(JSON.stringify(putBody)).not.toContain("abc1234567890ab");

    const getRes = await GET();
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.data.hasKey).toBe(true);
    expect(getBody.data.keyPreview).toBe("xai-••••90ab");
    // Privacy: raw tail must not appear in the GET response
    expect(JSON.stringify(getBody)).not.toContain("abc1234567890ab");
    expect("apiKey" in getBody.data).toBe(false);
  });

  it("keyPreview uses exact unicode bullet format xai-••••<last4>", async () => {
    const req = new Request("http://localhost/api/settings", {
      method: "PUT",
      body: JSON.stringify({ apiKey: "xai-testkeyABCD" }),
      headers: { "content-type": "application/json" },
    }) as unknown as NextRequest;

    const putRes = await PUT(req);
    const putBody = await putRes.json();
    // Exact unicode bullet U+2022
    expect(putBody.data.keyPreview).toBe("xai-\u2022\u2022\u2022\u2022ABCD");
    // Privacy: raw tail must not appear
    expect(JSON.stringify(putBody)).not.toContain("testkeyABCD");
  });

  it("PUT with empty apiKey clears the key", async () => {
    // First set a key
    const setReq = new Request("http://localhost/api/settings", {
      method: "PUT",
      body: JSON.stringify({ apiKey: "xai-abc1234567890ab" }),
      headers: { "content-type": "application/json" },
    }) as unknown as NextRequest;
    await PUT(setReq);

    // Now clear it
    const clearReq = new Request("http://localhost/api/settings", {
      method: "PUT",
      body: JSON.stringify({ apiKey: "" }),
      headers: { "content-type": "application/json" },
    }) as unknown as NextRequest;
    const clearRes = await PUT(clearReq);
    expect(clearRes.status).toBe(200);

    const getRes = await GET();
    const getBody = await getRes.json();
    expect(getBody.data.hasKey).toBe(false);
    expect(getBody.data.keyPreview).toBeUndefined();
  });

  it("PUT strips unknown fields and non-allowed fields like bindPort", async () => {
    const req = new Request("http://localhost/api/settings", {
      method: "PUT",
      body: JSON.stringify({ apiKey: "xai-xyz987654321a", bogus: "nope", bindPort: 9999 }),
      headers: { "content-type": "application/json" },
    }) as unknown as NextRequest;

    const putRes = await PUT(req);
    expect(putRes.status).toBe(200);
    const putBody = await putRes.json();
    expect(putBody.data.hasKey).toBe(true);

    const getRes = await GET();
    const getBody = await getRes.json();
    // bindPort is not in the allowlist. It should be silently ignored.
    expect(getBody.data.hasKey).toBe(true);
    // Privacy: raw tail of the key must not appear in responses
    expect(JSON.stringify(putBody)).not.toContain("xyz987654321a");
    expect(JSON.stringify(getBody)).not.toContain("xyz987654321a");
  });

  it("PUT persists styleDefaults", async () => {
    const req = new Request("http://localhost/api/settings", {
      method: "PUT",
      body: JSON.stringify({ styleDefaults: { tense: "present", noEmDashes: false } }),
      headers: { "content-type": "application/json" },
    }) as unknown as NextRequest;

    const putRes = await PUT(req);
    const putJson = await putRes.json();
    expect(putJson.ok).toBe(true);

    const getRes = await GET();
    const getJson = await getRes.json();
    expect(getJson.data.styleDefaults).toEqual({
      tense: "present",
      noEmDashes: false,
    });
  });

  it("PUT ignores unknown top-level fields (existing allowlist behavior)", async () => {
    const req = new Request("http://localhost/api/settings", {
      method: "PUT",
      body: JSON.stringify({ unknownField: "xxx" }),
      headers: { "content-type": "application/json" },
    }) as unknown as NextRequest;

    const putRes = await PUT(req);
    const putJson = await putRes.json();
    expect(putJson.ok).toBe(true);
  });
});
