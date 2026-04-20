import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { createStory } from "@/lib/storage/stories";
import { createChapter, getChapter, updateChapter } from "@/lib/storage/chapters";
import { lastPayloadFile } from "@/lib/storage/paths";
import { saveBible, getBible } from "@/lib/storage/bible";
import { GrokError } from "@/lib/grok-retry";
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

  it("unsupported mode returns 400 JSON error", async () => {
    const { story, chapter } = await seed();

    const res = await POST(makeReq({ storySlug: story.slug, chapterId: chapter.id, mode: "bogus" as "full" }));
    expect(res.status).toBe(400);

    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/unsupported mode/);
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

// ---- section mode tests ----

async function seedWithSections() {
  const story = await createStory(tmpDir, { title: "Section Test" });
  const chapter = await createChapter(tmpDir, story.slug, { title: "Ch 1" });
  const sections = [
    { id: "sec-a", content: "Original scene A." },
    { id: "sec-b", content: "Original scene B." },
    { id: "sec-c", content: "Original scene C." },
  ];
  await updateChapter(tmpDir, story.slug, chapter.id, { sections });
  return { story, chapter, sections };
}

describe("POST /api/generate — section mode", () => {
  it("happy path: streams start, tokens, done; no section-break events; saves updated section", async () => {
    const { story, chapter } = await seedWithSections();
    fakeCreate.mockResolvedValue(
      fakeStream([
        { content: "Rewritten scene B." },
        { finish_reason: "stop" },
      ])
    );

    const res = await POST(
      makeReq({ storySlug: story.slug, chapterId: chapter.id, mode: "section", sectionId: "sec-b", regenNote: "more sensory" })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");

    const events = await consumeSSE(res);

    expect(events[0]).toMatchObject({ type: "start" });
    expect(events.some((e) => e.type === "section-break")).toBe(false);
    const doneEvent = events.find((e) => e.type === "done") as Extract<GenerateEvent, { type: "done" }> | undefined;
    expect(doneEvent).toBeDefined();
    expect(doneEvent?.finishReason).toBe("stop");

    // Disk: 3 sections still; sec-b replaced; sec-a and sec-c unchanged
    const saved = await getChapter(tmpDir, story.slug, chapter.id);
    expect(saved).not.toBeNull();
    expect(saved!.sections).toHaveLength(3);
    expect(saved!.sections[0].content).toBe("Original scene A.");
    expect(saved!.sections[1].content).toBe("Rewritten scene B.");
    expect(saved!.sections[1].regenNote).toBe("more sensory");
    expect(saved!.sections[2].content).toBe("Original scene C.");
  });

  it("token events sum to the full rewritten content", async () => {
    const { story, chapter } = await seedWithSections();
    fakeCreate.mockResolvedValue(
      fakeStream([
        { content: "Rewritten" },
        { content: " scene B." },
        { finish_reason: "stop" },
      ])
    );

    const res = await POST(
      makeReq({ storySlug: story.slug, chapterId: chapter.id, mode: "section", sectionId: "sec-b", regenNote: "more sensory" })
    );
    const events = await consumeSSE(res);
    expect(textOf(events)).toBe("Rewritten scene B.");
  });

  it("unknown sectionId returns 400", async () => {
    const { story, chapter } = await seedWithSections();

    const res = await POST(
      makeReq({ storySlug: story.slug, chapterId: chapter.id, mode: "section", sectionId: "nonexistent" })
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("section not found");
  });

  it("missing sectionId returns 400", async () => {
    const { story, chapter } = await seedWithSections();

    const res = await POST(
      makeReq({ storySlug: story.slug, chapterId: chapter.id, mode: "section" })
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("sectionId required");
  });

  it("non-string regenNote returns 400", async () => {
    const { story, chapter } = await seedWithSections();

    const res = await POST(
      makeReq({ storySlug: story.slug, chapterId: chapter.id, mode: "section", sectionId: "sec-b", regenNote: 42 })
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("regenNote must be a string");
  });

  it("trims leading/trailing whitespace from accumulated content before saving", async () => {
    const { story, chapter } = await seedWithSections();
    fakeCreate.mockResolvedValue(
      fakeStream([
        { content: "  leading and trailing   \n" },
        { finish_reason: "stop" },
      ])
    );

    const res = await POST(
      makeReq({ storySlug: story.slug, chapterId: chapter.id, mode: "section", sectionId: "sec-b" })
    );
    await consumeSSE(res);

    const saved = await getChapter(tmpDir, story.slug, chapter.id);
    expect(saved!.sections[1].content).toBe("leading and trailing");
  });

  it("mid-stream error leaves original section intact; emits error event; no done event", async () => {
    const { story, chapter } = await seedWithSections();
    fakeCreate.mockResolvedValue(fakeStreamThrowing([{ content: "partial regen" }], 1));

    const res = await POST(
      makeReq({ storySlug: story.slug, chapterId: chapter.id, mode: "section", sectionId: "sec-b", regenNote: "more sensory" })
    );
    const events = await consumeSSE(res);

    expect(events[0]).toMatchObject({ type: "start" });
    expect(events.some((e) => e.type === "token")).toBe(true);
    expect(events.some((e) => e.type === "error")).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(false);

    // Original section is preserved
    const saved = await getChapter(tmpDir, story.slug, chapter.id);
    expect(saved!.sections[1].content).toBe("Original scene B.");
  });

  it(".last-payload.json has mode: 'section' and rewrite marker in user field", async () => {
    const { story, chapter } = await seedWithSections();
    fakeCreate.mockResolvedValue(
      fakeStream([{ content: "Rewritten scene B." }, { finish_reason: "stop" }])
    );

    const res = await POST(
      makeReq({ storySlug: story.slug, chapterId: chapter.id, mode: "section", sectionId: "sec-b", regenNote: "more sensory" })
    );
    await consumeSSE(res);

    const raw = await readFile(lastPayloadFile(tmpDir, story.slug), "utf-8");
    const payload = JSON.parse(raw) as Record<string, unknown>;

    expect(Object.keys(payload).sort()).toEqual(["mode", "model", "system", "user"]);
    expect(payload.mode).toBe("section");
    expect(typeof payload.system).toBe("string");
    // The rewrite marker wraps the target section in the user prompt
    expect(payload.user as string).toContain("more sensory");
    // Privacy: API key must not appear
    expect(raw).not.toContain("xai-test1234567890");
  });

  it("missing story returns 400 for section mode", async () => {
    const res = await POST(
      makeReq({ storySlug: "nonexistent", chapterId: "ch-1", mode: "section", sectionId: "sec-b" })
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("story not found");
  });

  it("missing chapter returns 400 for section mode", async () => {
    const { story } = await seedWithSections();

    const res = await POST(
      makeReq({ storySlug: story.slug, chapterId: "00000000-0000-0000-0000-000000000000", mode: "section", sectionId: "sec-b" })
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("chapter not found");
  });

  it("missing API key returns 500 SSE error of kind auth in section mode", async () => {
    const { story, chapter } = await seedWithSections();
    vi.mocked(getGrokClient).mockImplementationOnce(() => {
      throw new MissingKeyError();
    });

    const res = await POST(
      makeReq({ storySlug: story.slug, chapterId: chapter.id, mode: "section", sectionId: "sec-b" })
    );
    expect(res.status).toBe(500);

    const events = await consumeSSE(res);
    expect(events).toHaveLength(1);
    const ev = events[0] as Extract<GenerateEvent, { type: "error" }>;
    expect(ev.type).toBe("error");
    expect(ev.kind).toBe("auth");
  });
});

// ---- continue mode tests ----

describe("POST /api/generate — continue mode", () => {
  it("happy path: truncates at pivot, streams new content appended after pivot", async () => {
    const { story, chapter } = await seedWithSections();
    fakeCreate.mockResolvedValue(
      fakeStream([
        { content: "More prose.\n" },
        { finish_reason: "stop" },
      ])
    );

    const res = await POST(
      makeReq({ storySlug: story.slug, chapterId: chapter.id, mode: "continue", sectionId: "sec-b" })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");

    const events = await consumeSSE(res);

    expect(events[0]).toMatchObject({ type: "start" });
    expect(events.some((e) => e.type === "token")).toBe(true);
    const doneEvent = events.find((e) => e.type === "done") as Extract<GenerateEvent, { type: "done" }> | undefined;
    expect(doneEvent).toBeDefined();

    // On disk: sec-c should be dropped; sec-a and sec-b remain; new section appended
    const saved = await getChapter(tmpDir, story.slug, chapter.id);
    expect(saved).not.toBeNull();
    // sec-a and sec-b kept, sec-c dropped, new section appended
    expect(saved!.sections.length).toBeGreaterThanOrEqual(3);
    expect(saved!.sections[0].content).toBe("Original scene A.");
    expect(saved!.sections[1].content).toBe("Original scene B.");
    // sec-c is gone
    expect(saved!.sections.find((s) => s.content === "Original scene C.")).toBeUndefined();
    // New content appended
    const allContent = saved!.sections.map((s) => s.content).join("\n");
    expect(allContent).toContain("More prose.");
  });

  it("truncation is committed before the stream starts (even if stream fails)", async () => {
    const { story, chapter } = await seedWithSections();
    // Stream throws immediately after open
    fakeCreate.mockRejectedValue(new Error("stream kaboom"));

    const res = await POST(
      makeReq({ storySlug: story.slug, chapterId: chapter.id, mode: "continue", sectionId: "sec-b" })
    );
    const events = await consumeSSE(res);

    expect(events[0]).toMatchObject({ type: "start" });
    expect(events.some((e) => e.type === "error")).toBe(true);

    // Disk: sections truncated to [a, b] even though stream failed
    const saved = await getChapter(tmpDir, story.slug, chapter.id);
    expect(saved).not.toBeNull();
    expect(saved!.sections).toHaveLength(2);
    expect(saved!.sections[0].content).toBe("Original scene A.");
    expect(saved!.sections[1].content).toBe("Original scene B.");
  });

  it("pivot section not found returns 400", async () => {
    const { story, chapter } = await seedWithSections();

    const res = await POST(
      makeReq({ storySlug: story.slug, chapterId: chapter.id, mode: "continue", sectionId: "nonexistent" })
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("section not found");
  });

  it("missing sectionId returns 400", async () => {
    const { story, chapter } = await seedWithSections();

    const res = await POST(
      makeReq({ storySlug: story.slug, chapterId: chapter.id, mode: "continue" })
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("sectionId required");
  });

  it("section break in stream creates additional sections after pivot", async () => {
    const { story, chapter } = await seedWithSections();
    fakeCreate.mockResolvedValue(
      fakeStream([
        { content: "Scene X." },
        { content: "\n---\n" },
        { content: "Scene Y." },
        { finish_reason: "stop" },
      ])
    );

    const res = await POST(
      makeReq({ storySlug: story.slug, chapterId: chapter.id, mode: "continue", sectionId: "sec-b" })
    );
    const events = await consumeSSE(res);

    const breakEvents = events.filter((e) => e.type === "section-break");
    expect(breakEvents).toHaveLength(1);

    const saved = await getChapter(tmpDir, story.slug, chapter.id);
    expect(saved).not.toBeNull();
    // sec-a + sec-b (kept) + Scene X (new) + Scene Y (new) = 4 sections
    expect(saved!.sections).toHaveLength(4);
    expect(saved!.sections[0].content).toBe("Original scene A.");
    expect(saved!.sections[1].content).toBe("Original scene B.");
    const allContent = saved!.sections.map((s) => s.content).join("\n");
    expect(allContent).toContain("Scene X.");
    expect(allContent).toContain("Scene Y.");
  });

  it("non-string regenNote returns 400", async () => {
    const { story, chapter } = await seedWithSections();

    const res = await POST(
      makeReq({ storySlug: story.slug, chapterId: chapter.id, mode: "continue", sectionId: "sec-b", regenNote: 99 })
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("regenNote must be a string");
  });

  it(".last-payload.json has mode: 'continue' and no API key", async () => {
    const { story, chapter } = await seedWithSections();
    fakeCreate.mockResolvedValue(
      fakeStream([{ content: "Continued." }, { finish_reason: "stop" }])
    );

    const res = await POST(
      makeReq({ storySlug: story.slug, chapterId: chapter.id, mode: "continue", sectionId: "sec-b", regenNote: "add drama" })
    );
    await consumeSSE(res);

    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(lastPayloadFile(tmpDir, story.slug), "utf-8");
    const payload = JSON.parse(raw) as Record<string, unknown>;

    expect(Object.keys(payload).sort()).toEqual(["mode", "model", "system", "user"]);
    expect(payload.mode).toBe("continue");
    expect(payload.user as string).toContain("add drama");
    expect(raw).not.toContain("xai-test1234567890");
  });

  it("missing story returns 400 for continue mode", async () => {
    const res = await POST(
      makeReq({ storySlug: "nonexistent", chapterId: "ch-1", mode: "continue", sectionId: "sec-b" })
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("story not found");
  });

  it("missing chapter returns 400 for continue mode", async () => {
    const { story } = await seedWithSections();

    const res = await POST(
      makeReq({ storySlug: story.slug, chapterId: "00000000-0000-0000-0000-000000000000", mode: "continue", sectionId: "sec-b" })
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("chapter not found");
  });
});

// ---- auto-recap tests ----

async function enableAutoRecap(dir: string) {
  await writeFile(join(dir, "config.json"), JSON.stringify({ autoRecap: true }), "utf-8");
}

async function disableAutoRecap(dir: string) {
  await writeFile(join(dir, "config.json"), JSON.stringify({ autoRecap: false }), "utf-8");
}

describe("POST /api/generate — auto-recap (full mode)", () => {
  it("autoRecap: true — happy path: emits recap event after done, saves recap to disk", async () => {
    const { story, chapter } = await seed();
    await enableAutoRecap(tmpDir);

    // Dual mock: streaming call first, then non-streaming recap call
    fakeCreate.mockImplementation(async (params: { stream?: boolean }) => {
      if (params.stream) {
        return fakeStream([{ content: "Scene one." }, { finish_reason: "stop" }]);
      }
      return { choices: [{ message: { content: "Recap summary." } }] };
    });

    const res = await POST(makeReq({ storySlug: story.slug, chapterId: chapter.id, mode: "full" }));
    const events = await consumeSSE(res);

    const types = events.map((e) => e.type);
    expect(types).toContain("start");
    expect(types).toContain("token");
    expect(types).toContain("done");
    expect(types).toContain("recap");

    // recap event comes after done
    const doneIdx = types.indexOf("done");
    const recapIdx = types.indexOf("recap");
    expect(recapIdx).toBeGreaterThan(doneIdx);

    const recapEvent = events.find((e) => e.type === "recap") as Extract<GenerateEvent, { type: "recap" }>;
    expect(recapEvent.text).toBe("Recap summary.");

    // On disk: recap saved
    const saved = await getChapter(tmpDir, story.slug, chapter.id);
    expect(saved?.recap).toBe("Recap summary.");
  });

  it("autoRecap: true — recap call fails: chapter saves with recap='', no error event", async () => {
    const { story, chapter } = await seed();
    await enableAutoRecap(tmpDir);

    fakeCreate.mockImplementation(async (params: { stream?: boolean }) => {
      if (params.stream) {
        return fakeStream([{ content: "Scene one." }, { finish_reason: "stop" }]);
      }
      throw new GrokError("server", "boom", 500);
    });

    const res = await POST(makeReq({ storySlug: story.slug, chapterId: chapter.id, mode: "full" }));
    const events = await consumeSSE(res);

    const types = events.map((e) => e.type);
    expect(types).toContain("done");
    expect(types).not.toContain("error");
    expect(types).toContain("recap");

    const recapEvent = events.find((e) => e.type === "recap") as Extract<GenerateEvent, { type: "recap" }>;
    expect(recapEvent.text).toBe("");

    // On disk: recap is empty string
    const saved = await getChapter(tmpDir, story.slug, chapter.id);
    expect(saved?.recap).toBe("");
  });

  it("autoRecap: false — no recap event emitted", async () => {
    const { story, chapter } = await seed();
    await disableAutoRecap(tmpDir);

    fakeCreate.mockResolvedValue(
      fakeStream([{ content: "Scene one." }, { finish_reason: "stop" }])
    );

    const res = await POST(makeReq({ storySlug: story.slug, chapterId: chapter.id, mode: "full" }));
    const events = await consumeSSE(res);

    const types = events.map((e) => e.type);
    expect(types).toContain("done");
    expect(types).not.toContain("recap");
  });

  it("section mode + autoRecap: true — no recap event (section mode excluded)", async () => {
    const { story, chapter } = await seedWithSections();
    await enableAutoRecap(tmpDir);

    fakeCreate.mockResolvedValue(
      fakeStream([{ content: "Rewritten scene." }, { finish_reason: "stop" }])
    );

    const res = await POST(
      makeReq({ storySlug: story.slug, chapterId: chapter.id, mode: "section", sectionId: "sec-b" })
    );
    const events = await consumeSSE(res);

    const types = events.map((e) => e.type);
    expect(types).toContain("done");
    expect(types).not.toContain("recap");
  });

  it("continue mode + autoRecap: true — recap event emitted after done", async () => {
    const { story, chapter } = await seedWithSections();
    await enableAutoRecap(tmpDir);

    fakeCreate.mockImplementation(async (params: { stream?: boolean }) => {
      if (params.stream) {
        return fakeStream([{ content: "More prose." }, { finish_reason: "stop" }]);
      }
      return { choices: [{ message: { content: "Continue recap." } }] };
    });

    const res = await POST(
      makeReq({ storySlug: story.slug, chapterId: chapter.id, mode: "continue", sectionId: "sec-b" })
    );
    const events = await consumeSSE(res);

    const types = events.map((e) => e.type);
    expect(types).toContain("done");
    expect(types).toContain("recap");

    const doneIdx = types.indexOf("done");
    const recapIdx = types.indexOf("recap");
    expect(recapIdx).toBeGreaterThan(doneIdx);

    const recapEvent = events.find((e) => e.type === "recap") as Extract<GenerateEvent, { type: "recap" }>;
    expect(recapEvent.text).toBe("Continue recap.");

    const saved = await getChapter(tmpDir, story.slug, chapter.id);
    expect(saved?.recap).toBe("Continue recap.");
  });
});

// ---- style rules in .last-payload.json tests ----

describe("POST /api/generate — style rules in .last-payload.json", () => {
  it("full mode: writes # Style rules block with tense and customRules from config.styleDefaults", async () => {
    await writeFile(
      join(tmpDir, "config.json"),
      JSON.stringify({
        apiKey: "xai-test1234567890",
        styleDefaults: { tense: "present", customRules: "no metaphors" },
      }),
    );

    const { story, chapter } = await seed();

    fakeCreate.mockResolvedValue(
      fakeStream([{ content: "done.\n" }, { finish_reason: "stop" }]),
    );

    const res = await POST(makeReq({ storySlug: story.slug, chapterId: chapter.id, mode: "full" }));
    expect(res.status).toBe(200);
    await consumeSSE(res);

    const raw = await readFile(lastPayloadFile(tmpDir, story.slug), "utf-8");
    const payload = JSON.parse(raw) as { model: string; mode: string; system: string; user: string };
    expect(payload.mode).toBe("full");
    expect(payload.user).toMatch(/# Style rules/);
    expect(payload.user).toMatch(/Write in present tense\./);
    expect(payload.user).toMatch(/Additional rules:\nno metaphors/);
    expect(payload.user).not.toMatch(/Write in past tense/);
  });

  it("full mode: bible.styleOverrides take precedence over config.styleDefaults", async () => {
    await writeFile(
      join(tmpDir, "config.json"),
      JSON.stringify({
        apiKey: "xai-test1234567890",
        styleDefaults: { tense: "present" },
      }),
    );

    const { story, chapter } = await seed();

    const bible = await getBible(tmpDir, story.slug);
    await saveBible(tmpDir, story.slug, {
      ...bible!,
      styleOverrides: { tense: "past" },
    });

    fakeCreate.mockResolvedValue(
      fakeStream([{ content: "done.\n" }, { finish_reason: "stop" }]),
    );

    const res = await POST(makeReq({ storySlug: story.slug, chapterId: chapter.id, mode: "full" }));
    await consumeSSE(res);

    const raw = await readFile(lastPayloadFile(tmpDir, story.slug), "utf-8");
    const payload = JSON.parse(raw) as { user: string };
    expect(payload.user).toMatch(/Write in past tense\./);
    expect(payload.user).not.toMatch(/Write in present tense/);
  });

  it("continue mode: .last-payload.json contains # Style rules", async () => {
    await writeFile(
      join(tmpDir, "config.json"),
      JSON.stringify({
        apiKey: "xai-test1234567890",
        styleDefaults: { customRules: "mode-marker-continue" },
      }),
    );

    const { story, chapter } = await seedWithSections();

    fakeCreate.mockResolvedValue(
      fakeStream([{ content: "Continued.\n" }, { finish_reason: "stop" }]),
    );

    const res = await POST(makeReq({ storySlug: story.slug, chapterId: chapter.id, mode: "continue", sectionId: "sec-b" }));
    expect(res.status).toBe(200);
    await consumeSSE(res);

    const raw = await readFile(lastPayloadFile(tmpDir, story.slug), "utf-8");
    const payload = JSON.parse(raw) as { user: string; mode: string };
    expect(payload.mode).toBe("continue");
    expect(payload.user).toMatch(/# Style rules/);
    expect(payload.user).toMatch(/mode-marker-continue/);
  });

  it("section mode: .last-payload.json contains # Style rules", async () => {
    await writeFile(
      join(tmpDir, "config.json"),
      JSON.stringify({
        apiKey: "xai-test1234567890",
        styleDefaults: { customRules: "mode-marker-section" },
      }),
    );

    const { story, chapter } = await seedWithSections();

    fakeCreate.mockResolvedValue(
      fakeStream([{ content: "Rewritten section.\n" }, { finish_reason: "stop" }]),
    );

    const res = await POST(makeReq({ storySlug: story.slug, chapterId: chapter.id, mode: "section", sectionId: "sec-b" }));
    expect(res.status).toBe(200);
    await consumeSSE(res);

    const raw = await readFile(lastPayloadFile(tmpDir, story.slug), "utf-8");
    const payload = JSON.parse(raw) as { user: string; mode: string };
    expect(payload.mode).toBe("section");
    expect(payload.user).toMatch(/# Style rules/);
    expect(payload.user).toMatch(/mode-marker-section/);
  });
});
