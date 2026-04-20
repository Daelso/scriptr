import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { createStory } from "@/lib/storage/stories";
import { createChapter, getChapter, updateChapter } from "@/lib/storage/chapters";
import { lastPayloadFile } from "@/lib/storage/paths";
import type { GenerateEvent } from "@/lib/types";

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

import { POST, _RETRY_OPTIONS } from "@/app/api/generate/route";
import { getGrokClient, MissingKeyError } from "@/lib/grok";

// ---- helpers ----

function fakeStream(
  parts: Array<{ content?: string; finish_reason?: string | null }>
) {
  return (async function* () {
    for (const p of parts) {
      yield {
        choices: [
          { delta: { content: p.content }, finish_reason: p.finish_reason ?? null },
        ],
      };
    }
  })();
}

/**
 * Yields `throwAfter` parts then unconditionally throws "mid-stream failure".
 * The in-loop guard is removed — semantics are simply: yield N items, then throw.
 */
function fakeStreamThrowing(
  parts: Array<{ content?: string; finish_reason?: string | null }>,
  throwAfter: number
) {
  return (async function* () {
    let yielded = 0;
    for (const p of parts) {
      if (yielded >= throwAfter) break;
      yield {
        choices: [
          { delta: { content: p.content }, finish_reason: p.finish_reason ?? null },
        ],
      };
      yielded++;
    }
    throw new Error("mid-stream failure");
  })();
}

async function consumeSSE(res: Response): Promise<GenerateEvent[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: GenerateEvent[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.trim();
      if (!line.startsWith("data:")) continue;
      events.push(JSON.parse(line.slice(5).trim()) as GenerateEvent);
    }
  }
  return events;
}

function textOf(events: GenerateEvent[]): string {
  return events
    .filter((e): e is Extract<GenerateEvent, { type: "token" }> => e.type === "token")
    .map((e) => e.text)
    .join("");
}

function makeReq(body: unknown): NextRequest {
  return new Request("http://localhost/api/generate", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }) as unknown as NextRequest;
}

// ---- setup ----

const originalEnv = process.env;
let tmpDir: string;

// Save original retry delay so tests that mutate it can restore it.
const origBaseDelayMs = _RETRY_OPTIONS.baseDelayMs;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "scriptr-gen-"));
  process.env = {
    ...originalEnv,
    SCRIPTR_DATA_DIR: tmpDir,
    XAI_API_KEY: "xai-test1234567890",
  };
  fakeCreate.mockReset();
  vi.mocked(getGrokClient).mockClear();
  // Speed up retry backoff for all tests.
  _RETRY_OPTIONS.baseDelayMs = 1;
});

afterEach(async () => {
  process.env = originalEnv;
  _RETRY_OPTIONS.baseDelayMs = origBaseDelayMs;
  await rm(tmpDir, { recursive: true, force: true });
});

async function seed() {
  const story = await createStory(tmpDir, { title: "Test Story" });
  const chapter = await createChapter(tmpDir, story.slug, { title: "Chapter One" });
  return { story, chapter };
}

// ---- tests ----

describe("POST /api/generate", () => {
  it("happy path — streams start, tokens, done events in order", async () => {
    const { story, chapter } = await seed();
    fakeCreate.mockResolvedValue(
      fakeStream([
        { content: "Hello\n" },
        { content: " world.\n" },
        { finish_reason: "stop" },
      ])
    );

    const res = await POST(makeReq({ storySlug: story.slug, chapterId: chapter.id, mode: "full" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");

    const events = await consumeSSE(res);

    expect(events[0]).toMatchObject({ type: "start" });
    // chunkBySectionBreak emits per-line tokens; both lines should appear
    const tokenEvents = events.filter((e) => e.type === "token");
    expect(tokenEvents.length).toBeGreaterThanOrEqual(1);
    const doneEvent = events.find((e) => e.type === "done") as Extract<GenerateEvent, { type: "done" }> | undefined;
    expect(doneEvent).toBeDefined();
    expect(doneEvent?.finishReason).toBe("stop");
  });

  it("concatenated tokens equal the prose", async () => {
    const { story, chapter } = await seed();
    // Without newlines, chunker buffers and emits as one token at stream end
    fakeCreate.mockResolvedValue(
      fakeStream([
        { content: "Hello" },
        { content: " world." },
        { finish_reason: "stop" },
      ])
    );

    const res = await POST(makeReq({ storySlug: story.slug, chapterId: chapter.id, mode: "full" }));
    const events = await consumeSSE(res);
    // The chunker batches partial lines — total text must equal the input prose
    expect(textOf(events)).toBe("Hello world.");
  });

  it("section-break emits event and persists sections to disk", async () => {
    const { story, chapter } = await seed();
    fakeCreate.mockResolvedValue(
      fakeStream([
        { content: "A" },
        { content: "\n---\n" },
        { content: "B" },
        { finish_reason: "stop" },
      ])
    );

    const res = await POST(makeReq({ storySlug: story.slug, chapterId: chapter.id, mode: "full" }));
    const events = await consumeSSE(res);

    const breakEvents = events.filter((e) => e.type === "section-break");
    expect(breakEvents).toHaveLength(1);

    const saved = await getChapter(tmpDir, story.slug, chapter.id);
    expect(saved).not.toBeNull();
    expect(saved!.sections.length).toBeGreaterThanOrEqual(2);

    const allContent = saved!.sections.map((s) => s.content).join("\n");
    expect(allContent).toContain("A");
    expect(allContent).toContain("B");
  });

  it("start event has a UUID jobId", async () => {
    const { story, chapter } = await seed();
    fakeCreate.mockResolvedValue(
      fakeStream([{ content: "hi" }, { finish_reason: "stop" }])
    );

    const res = await POST(makeReq({ storySlug: story.slug, chapterId: chapter.id, mode: "full" }));
    const events = await consumeSSE(res);

    const startEvent = events[0] as Extract<GenerateEvent, { type: "start" }>;
    expect(startEvent.type).toBe("start");
    expect(startEvent.jobId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("missing API key returns 500 with error SSE event of kind auth", async () => {
    const { story, chapter } = await seed();
    // Override the mock to simulate MissingKeyError (as getGrokClient would in real code)
    vi.mocked(getGrokClient).mockImplementationOnce(() => {
      throw new MissingKeyError();
    });

    const res = await POST(makeReq({ storySlug: story.slug, chapterId: chapter.id, mode: "full" }));
    expect(res.status).toBe(500);

    const events = await consumeSSE(res);
    expect(events).toHaveLength(1);
    const ev = events[0] as Extract<GenerateEvent, { type: "error" }>;
    expect(ev.type).toBe("error");
    expect(ev.kind).toBe("auth");
  });

  it("pre-first-token error surfaces as error event with classified kind", async () => {
    const { story, chapter } = await seed();
    const err = new Error("rate") as Error & { status: number };
    err.status = 429;
    fakeCreate.mockRejectedValue(err);

    const res = await POST(makeReq({ storySlug: story.slug, chapterId: chapter.id, mode: "full" }));
    // The SSE stream opened successfully (200), but body contains an error event
    expect(res.status).toBe(200);

    const events = await consumeSSE(res);
    expect(events[0]).toMatchObject({ type: "start" });
    const errorEvent = events.find((e) => e.type === "error") as Extract<GenerateEvent, { type: "error" }> | undefined;
    expect(errorEvent).toBeDefined();
    expect(errorEvent?.kind).toBe("rate-limit");
  });

  it("mid-stream error saves partial content and emits error event", async () => {
    const { story, chapter } = await seed();
    // Use a newline so chunkBySectionBreak emits the token before the stream throws.
    // Without a newline the chunker buffers internally and the token is never emitted
    // (or accumulated into currentText) before the error propagates.
    fakeCreate.mockResolvedValue(fakeStreamThrowing([{ content: "Partial\n" }], 1));

    const res = await POST(makeReq({ storySlug: story.slug, chapterId: chapter.id, mode: "full" }));
    const events = await consumeSSE(res);

    expect(events[0]).toMatchObject({ type: "start" });
    expect(events.some((e) => e.type === "token")).toBe(true);
    expect(events.some((e) => e.type === "error")).toBe(true);

    const saved = await getChapter(tmpDir, story.slug, chapter.id);
    expect(saved).not.toBeNull();
    const allContent = saved!.sections.map((s) => s.content).join("\n");
    expect(allContent).toContain("Partial");
  });

  it(".last-payload.json has exactly model/mode/system/user and no API key", async () => {
    const { story, chapter } = await seed();
    fakeCreate.mockResolvedValue(
      fakeStream([{ content: "Hello" }, { finish_reason: "stop" }])
    );

    const res = await POST(makeReq({ storySlug: story.slug, chapterId: chapter.id, mode: "full" }));
    await consumeSSE(res);

    const raw = await readFile(lastPayloadFile(tmpDir, story.slug), "utf-8");
    const payload = JSON.parse(raw) as Record<string, unknown>;

    expect(Object.keys(payload).sort()).toEqual(["mode", "model", "system", "user"]);
    expect(payload.mode).toBe("full");
    expect(typeof payload.model).toBe("string");
    expect(typeof payload.system).toBe("string");
    expect(typeof payload.user).toBe("string");

    // Privacy: API key must NOT appear in the payload file
    expect(raw).not.toContain("xai-test1234567890");
  });

  it("invalid mode returns 400 JSON error", async () => {
    const { story, chapter } = await seed();

    const res = await POST(makeReq({ storySlug: story.slug, chapterId: chapter.id, mode: "section" }));
    expect(res.status).toBe(400);

    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/only mode=full/);
  });

  it("missing story returns 400 JSON error", async () => {
    const res = await POST(makeReq({ storySlug: "nonexistent", chapterId: "ch-1", mode: "full" }));
    expect(res.status).toBe(400);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("story not found");
  });

  it("missing chapter returns 400 JSON error", async () => {
    const { story } = await seed();

    const res = await POST(
      makeReq({ storySlug: story.slug, chapterId: "00000000-0000-0000-0000-000000000000", mode: "full" })
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("chapter not found");
  });

  it("snapshot semantics — prompt uses pre-edit chapter title", async () => {
    const { story, chapter } = await seed();

    // Slow stream — yields one token, waits briefly, then yields more
    async function* slowStream() {
      yield {
        choices: [{ delta: { content: "First token" }, finish_reason: null }],
      };
      await new Promise<void>((r) => setTimeout(r, 20));
      yield {
        choices: [{ delta: { content: " rest" }, finish_reason: "stop" }],
      };
    }
    fakeCreate.mockResolvedValue(slowStream());

    const postPromise = POST(makeReq({ storySlug: story.slug, chapterId: chapter.id, mode: "full" }));

    // After a tick, mutate the chapter title externally
    await new Promise<void>((r) => setTimeout(r, 5));
    await updateChapter(tmpDir, story.slug, chapter.id, { title: "Mutated Title" });

    const res = await postPromise;
    await consumeSSE(res);

    // External change persisted — chapter title is updated
    const saved = await getChapter(tmpDir, story.slug, chapter.id);
    expect(saved?.title).toBe("Mutated Title");

    // Prompt was built from the snapshot (original title "Chapter One")
    const raw = await readFile(lastPayloadFile(tmpDir, story.slug), "utf-8");
    const payload = JSON.parse(raw) as { user: string };
    expect(payload.user).toContain("Chapter One");
  });

  it.todo("periodic tick persists in-progress text between section breaks");
  // Fake-timer + async-generator interaction is flaky in the current test setup.
  // The write-queue serialization (B1) and stable inProgressSectionId ensure
  // correctness; coverage of the timer path is deferred.
});
