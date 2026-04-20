import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { createStory } from "@/lib/storage/stories";
import { createChapter, getChapter } from "@/lib/storage/chapters";
import { GrokError } from "@/lib/grok-retry";

// Hoisted mock — gives us a handle on the fake client's create() mock
const fakeCreate = vi.fn();
vi.mock("@/lib/grok", async () => {
  const actual = await vi.importActual<typeof import("@/lib/grok")>("@/lib/grok");
  return {
    ...actual,
    getGrokClient: vi.fn(() => ({
      chat: { completions: { create: fakeCreate } },
    })),
  };
});

import { POST } from "@/app/api/generate/recap/route";
import { getGrokClient, MissingKeyError } from "@/lib/grok";

// ---- helpers ----

function makeReq(body: unknown): NextRequest {
  return new Request("http://localhost/api/generate/recap", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }) as unknown as NextRequest;
}

// ---- setup ----

const originalEnv = process.env;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "scriptr-recap-"));
  process.env = {
    ...originalEnv,
    SCRIPTR_DATA_DIR: tmpDir,
    XAI_API_KEY: "xai-test1234567890",
  };
  fakeCreate.mockReset();
  vi.mocked(getGrokClient).mockClear();
});

afterEach(async () => {
  process.env = originalEnv;
  await rm(tmpDir, { recursive: true, force: true });
});

async function seed() {
  const story = await createStory(tmpDir, { title: "Recap Test Story" });
  const chapter = await createChapter(tmpDir, story.slug, { title: "Chapter One" });
  return { story, chapter };
}

// ---- tests ----

describe("POST /api/generate/recap", () => {
  it("happy path: generates recap, saves to disk, returns { ok: true, data: { recap } }", async () => {
    const { story, chapter } = await seed();
    fakeCreate.mockResolvedValue({
      choices: [{ message: { content: "Alice finds the key." } }],
    });

    const res = await POST(makeReq({ storySlug: story.slug, chapterId: chapter.id }));
    expect(res.status).toBe(200);

    const body = await res.json() as { ok: boolean; data: { recap: string } };
    expect(body.ok).toBe(true);
    expect(body.data.recap).toBe("Alice finds the key.");

    // On disk: recap saved
    const saved = await getChapter(tmpDir, story.slug, chapter.id);
    expect(saved?.recap).toBe("Alice finds the key.");
  });

  it("missing storySlug returns 400", async () => {
    const { chapter } = await seed();

    const res = await POST(makeReq({ chapterId: chapter.id }));
    expect(res.status).toBe(400);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("storySlug required");
  });

  it("missing chapterId returns 400", async () => {
    const { story } = await seed();

    const res = await POST(makeReq({ storySlug: story.slug }));
    expect(res.status).toBe(400);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("chapterId required");
  });

  it("story not found returns 404", async () => {
    const res = await POST(makeReq({ storySlug: "nonexistent", chapterId: "ch-1" }));
    expect(res.status).toBe(404);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("story not found");
  });

  it("chapter not found returns 404", async () => {
    const { story } = await seed();

    const res = await POST(
      makeReq({ storySlug: story.slug, chapterId: "00000000-0000-0000-0000-000000000000" })
    );
    expect(res.status).toBe(404);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("chapter not found");
  });

  it("Grok error returns 502 { ok: false, error } and does not save recap", async () => {
    const { story, chapter } = await seed();
    // Use a non-retryable error (auth kind is not retried) to keep the test fast.
    fakeCreate.mockRejectedValue(new GrokError("auth", "upstream exploded", 401));

    const res = await POST(makeReq({ storySlug: story.slug, chapterId: chapter.id }));
    expect(res.status).toBe(502);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("upstream exploded");

    // On disk: recap unchanged (still empty from creation)
    const saved = await getChapter(tmpDir, story.slug, chapter.id);
    expect(saved?.recap).toBe("");
  });

  it("missing API key returns 500 with XAI_API_KEY in error message", async () => {
    const { story, chapter } = await seed();
    vi.mocked(getGrokClient).mockImplementationOnce(() => {
      throw new MissingKeyError();
    });

    const res = await POST(makeReq({ storySlug: story.slug, chapterId: chapter.id }));
    expect(res.status).toBe(500);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/XAI_API_KEY/);
  });
});
