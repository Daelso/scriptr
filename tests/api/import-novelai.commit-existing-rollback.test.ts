import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { createStory } from "@/lib/storage/stories";

vi.mock("@/lib/storage/chapters", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage/chapters")>(
    "@/lib/storage/chapters"
  );
  let call = 0;
  return {
    ...actual,
    createImportedChapter: vi.fn(async (...args: unknown[]) => {
      call++;
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

describe("commit route — existing-story rollback", () => {
  let tmp: string;
  const originalEnv = process.env;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "scriptr-commit-existing-rollback-"));
    process.env = { ...originalEnv, SCRIPTR_DATA_DIR: tmp };
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(tmp, { recursive: true, force: true });
  });

  it("removes newly imported chapters when a later chapter write fails", async () => {
    const { createChapter, listChapters } = await import("@/lib/storage/chapters");
    const host = await createStory(tmp, { title: "Existing Host Story" });
    const existing = await createChapter(tmp, host.slug, { title: "Already There" });

    const { POST } = await import("@/app/api/import/novelai/commit/route");
    const res = await POST(
      makeJsonReq("http://localhost/api/import/novelai/commit", {
        target: "existing-story",
        slug: host.slug,
        chapters: [
          { title: "Imported One", body: "first body" },
          { title: "Imported Two", body: "second body" },
        ],
      })
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain("disk full (simulated)");

    const chapters = await listChapters(tmp, host.slug);
    expect(chapters.map((c) => c.id)).toEqual([existing.id]);
    expect(chapters[0].title).toBe("Already There");
  });
});
