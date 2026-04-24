import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";

vi.mock("@/lib/storage/chapters", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage/chapters")>(
    "@/lib/storage/chapters"
  );
  return {
    ...actual,
    createImportedChapter: vi.fn(async () => {
      throw new Error("disk full (simulated)");
    }),
  };
});

function makeJsonReq(url: string, body: unknown): NextRequest {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe("commit route — mid-write rollback", () => {
  let tmp: string;
  const originalEnv = process.env;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "scriptr-commit-rollback-"));
    process.env = { ...originalEnv, SCRIPTR_DATA_DIR: tmp };
  });
  afterEach(async () => {
    process.env = originalEnv;
    await rm(tmp, { recursive: true, force: true });
  });

  it("unlinks the story dir when a chapter write fails mid-flight", async () => {
    const { POST } = await import("@/app/api/import/novelai/commit/route");
    const res = await POST(
      makeJsonReq("http://localhost/api/import/novelai/commit", {
        target: "new-story",
        story: { title: "Will Roll Back", description: "", keywords: [] },
        bible: {
          characters: [],
          setting: "",
          pov: "third-limited",
          tone: "",
          styleNotes: "",
          nsfwPreferences: "",
        },
        chapters: [{ title: "one", body: "body" }],
      })
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain("disk full (simulated)");

    // Rollback deleted the partially-created story dir.
    expect(existsSync(join(tmp, "stories", "will-roll-back"))).toBe(false);
  });
});
