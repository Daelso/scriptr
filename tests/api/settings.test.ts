import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { GET, PUT } from "@/app/api/settings/route";
import { loadConfig } from "@/lib/config";

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

  it("PUT accepts penNameProfiles and GET returns them", async () => {
    const profile = {
      "Jane Doe": {
        email: "jane@example.com",
        mailingListUrl: "https://list.example.com/jane",
        defaultMessageHtml: "<p>Default</p>",
      },
    };
    const req = new Request("http://localhost/api/settings", {
      method: "PUT",
      body: JSON.stringify({ penNameProfiles: profile }),
      headers: { "content-type": "application/json" },
    }) as unknown as NextRequest;

    const putRes = await PUT(req);
    expect(putRes.status).toBe(200);
    expect((await putRes.json()).ok).toBe(true);

    const getRes = await GET();
    const body = await getRes.json();
    expect(body.ok).toBe(true);
    expect(body.data.penNameProfiles).toEqual(profile);
  });

  it("PUT ignores unknown fields not in the allowlist (penNameProfiles round-trip)", async () => {
    const profile = {
      "Pen One": { email: "one@example.com" },
    };
    const req = new Request("http://localhost/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        penNameProfiles: profile,
        somethingElse: "should be dropped",
      }),
      headers: { "content-type": "application/json" },
    }) as unknown as NextRequest;

    const putRes = await PUT(req);
    expect(putRes.status).toBe(200);
    expect((await putRes.json()).ok).toBe(true);

    // Inspect persisted config directly to ensure unknown field never reached disk.
    const cfg = await loadConfig(tmpDir);
    expect(cfg.penNameProfiles).toEqual(profile);
    expect((cfg as Record<string, unknown>).somethingElse).toBeUndefined();
  });

  it("PUT rejects penNameProfiles: null and preserves existing profiles", async () => {
    const baseline = {
      "Pen One": { email: "one@example.com" },
    };
    const setReq = new Request("http://localhost/api/settings", {
      method: "PUT",
      body: JSON.stringify({ penNameProfiles: baseline }),
      headers: { "content-type": "application/json" },
    }) as unknown as NextRequest;
    expect((await PUT(setReq)).status).toBe(200);

    const badReq = new Request("http://localhost/api/settings", {
      method: "PUT",
      body: JSON.stringify({ penNameProfiles: null }),
      headers: { "content-type": "application/json" },
    }) as unknown as NextRequest;
    const badRes = await PUT(badReq);
    expect(badRes.status).toBe(400);

    const cfg = await loadConfig(tmpDir);
    expect(cfg.penNameProfiles).toEqual(baseline);
  });

  it("PUT rejects penNameProfiles with non-string inner fields", async () => {
    const req = new Request("http://localhost/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        penNameProfiles: {
          "Bad Pen": { email: 12345 },
        },
      }),
      headers: { "content-type": "application/json" },
    }) as unknown as NextRequest;

    const res = await PUT(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/email must be a string/i);
  });

  it("PUT rejects reserved penNameProfiles keys that could poison object prototypes", async () => {
    const req = new Request("http://localhost/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        penNameProfiles: {
          constructor: { email: "x@example.com" },
        },
      }),
      headers: { "content-type": "application/json" },
    }) as unknown as NextRequest;
    const res = await PUT(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/reserved key/i);
  });

  it("PUT { defaultExportDir: <valid abs writable dir> } persists, GET returns it", async () => {
    const out = await mkdtemp(join(tmpdir(), "scriptr-out-"));
    try {
      const putRes = await PUT(new Request("http://localhost/api/settings", {
        method: "PUT",
        body: JSON.stringify({ defaultExportDir: out }),
        headers: { "content-type": "application/json" },
      }) as unknown as NextRequest);
      expect(putRes.status).toBe(200);
      const putBody = await putRes.json();
      expect(putBody.ok).toBe(true);
      expect(putBody.data.defaultExportDir).toBe(out);

      const getRes = await GET();
      const getBody = await getRes.json();
      expect(getBody.data.defaultExportDir).toBe(out);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });

  it("PUT { defaultExportDir: null } clears the setting", async () => {
    const out = await mkdtemp(join(tmpdir(), "scriptr-out-"));
    try {
      // First, set it.
      await PUT(new Request("http://localhost/api/settings", {
        method: "PUT",
        body: JSON.stringify({ defaultExportDir: out }),
        headers: { "content-type": "application/json" },
      }) as unknown as NextRequest);
      // Then clear.
      const clearRes = await PUT(new Request("http://localhost/api/settings", {
        method: "PUT",
        body: JSON.stringify({ defaultExportDir: null }),
        headers: { "content-type": "application/json" },
      }) as unknown as NextRequest);
      expect(clearRes.status).toBe(200);
      const clearBody = await clearRes.json();
      expect(clearBody.data.defaultExportDir).toBeNull();

      const getRes = await GET();
      const getBody = await getRes.json();
      expect(getBody.data.defaultExportDir).toBeUndefined();
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });

  it("PUT rejects relative paths with 400", async () => {
    const res = await PUT(new Request("http://localhost/api/settings", {
      method: "PUT",
      body: JSON.stringify({ defaultExportDir: "./relative" }),
      headers: { "content-type": "application/json" },
    }) as unknown as NextRequest);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/absolute/i);
  });

  it("PUT rejects nonexistent paths with 400", async () => {
    const res = await PUT(new Request("http://localhost/api/settings", {
      method: "PUT",
      body: JSON.stringify({ defaultExportDir: join(tmpDir, "does-not-exist") }),
      headers: { "content-type": "application/json" },
    }) as unknown as NextRequest);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/not exist|not found|enoent/i);
  });

  it("PUT rejects non-directory paths (file) with 400", async () => {
    const f = join(tmpDir, "regular-file");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(f, "x");
    const res = await PUT(new Request("http://localhost/api/settings", {
      method: "PUT",
      body: JSON.stringify({ defaultExportDir: f }),
      headers: { "content-type": "application/json" },
    }) as unknown as NextRequest);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/directory/i);
  });

  it("PUT rejects non-string non-null with 400", async () => {
    const res = await PUT(new Request("http://localhost/api/settings", {
      method: "PUT",
      body: JSON.stringify({ defaultExportDir: 42 }),
      headers: { "content-type": "application/json" },
    }) as unknown as NextRequest);
    expect(res.status).toBe(400);
  });

  it("GET on fresh install returns defaultExportDir as undefined", async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.data.defaultExportDir).toBeUndefined();
  });
});
