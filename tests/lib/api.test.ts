import { describe, it, expect } from "vitest";
import { ok, fail, readJson } from "@/lib/api";

describe("api helpers", () => {
  it("ok wraps data", async () => {
    const r = ok({ x: 1 });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, data: { x: 1 } });
  });

  it("fail wraps error with status", async () => {
    const r = fail("bad", 400);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ ok: false, error: "bad" });
  });

  it("readJson parses a Request body", async () => {
    const req = new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ a: 1 }),
      headers: { "content-type": "application/json" },
    });
    expect(await readJson(req)).toEqual({ a: 1 });
  });
});
