// @vitest-environment node
import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  it("returns { ok: true } with status 200", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("does not import any storage or generation helpers", async () => {
    // The whole point of the import-surface invariant: this route's module
    // graph must stay trivial so it can never accidentally trip a code path
    // that touches disk or network. We verify by reading the source — a
    // tighter check than a runtime mock — and asserting no forbidden imports.
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(
      new URL("../../app/api/health/route.ts", import.meta.url),
      "utf8",
    );
    const forbidden = [
      "@/lib/storage",
      "@/lib/grok",
      "@/lib/recap",
      "@/lib/config",
      "@/lib/prompts",
    ];
    for (const f of forbidden) {
      expect(src).not.toContain(f);
    }
  });
});
