import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { GET, PUT } from "@/app/api/settings/route";

describe("settings API — updates field", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "scriptr-settings-"));
    process.env.SCRIPTR_DATA_DIR = dir;
  });
  afterEach(async () => {
    delete process.env.SCRIPTR_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  });

  it("GET returns updates defaults", async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.updates?.checkOnLaunch).toBe(true);
  });

  it("GET includes isElectron flag", async () => {
    const res = await GET();
    const body = await res.json();
    expect(typeof body.data.isElectron).toBe("boolean");
  });

  it("PUT persists updates.checkOnLaunch=false", async () => {
    const req = new Request("http://127.0.0.1/api/settings", {
      method: "PUT",
      body: JSON.stringify({ updates: { checkOnLaunch: false } }),
    }) as unknown as NextRequest;
    const res = await PUT(req);
    const body = await res.json();
    expect(body.ok).toBe(true);
    const after = await GET();
    const afterBody = await after.json();
    expect(afterBody.data.updates.checkOnLaunch).toBe(false);
  });
});
