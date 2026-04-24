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
  let call = 0;
  return {
    ...actual,
    createImportedChapter: vi.fn(async (...args: unknown[]) => {
      call++;
      // Fail on the 2nd call so that, in multi-story mode, the first story
      // has already been fully written before the failure. This exercises
      // the "roll back ALL created slugs" path.
      if (call === 2) {
        throw new Error("disk full (simulated)");
      }
      return (
        actual.createImportedChapter as unknown as (
          ...a: unknown[]
        ) => Promise<unknown>
      )(...args);
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

const EMPTY_BIBLE = {
  characters: [],
  setting: "",
  pov: "third-limited" as const,
  tone: "",
  styleNotes: "",
  nsfwPreferences: "",
};

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

  it("unlinks ALL story dirs created so far when a later write fails mid-flight", async () => {
    const { POST } = await import("@/app/api/import/novelai/commit/route");
    const res = await POST(
      makeJsonReq("http://localhost/api/import/novelai/commit", {
        target: "new-story",
        stories: [
          {
            story: { title: "First Created", description: "", keywords: [] },
            bible: EMPTY_BIBLE,
            chapters: [{ title: "one", body: "body" }],
          },
          {
            story: { title: "Will Fail", description: "", keywords: [] },
            bible: EMPTY_BIBLE,
            // This triggers the 2nd createImportedChapter call, which the
            // mock throws on. The first story already has one chapter
            // (created on call #1) so it's fully written — rollback must
            // delete it too.
            chapters: [{ title: "two", body: "body" }],
          },
        ],
      })
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain("disk full (simulated)");

    // Both partially-created stories should have been removed.
    expect(existsSync(join(tmp, "stories", "first-created"))).toBe(false);
    expect(existsSync(join(tmp, "stories", "will-fail"))).toBe(false);
  });
});
