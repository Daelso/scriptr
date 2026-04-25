/**
 * Load-bearing privacy test.
 *
 * Scriptr's #1 privacy pillar: nothing leaves the user's machine except the
 * single Grok generation payload. This test exercises every API route except
 * those listed below and asserts that global.fetch was never called during
 * any of those route invocations.
 *
 * A regression here means something started phoning home. Investigate before
 * loosening the assertion.
 *
 * ─── EXEMPTED ROUTES ────────────────────────────────────────────────────────
 *
 * The following routes are NOT tested here, for the stated reasons:
 *
 *   /api/generate
 *     The one place prose leaves the machine — calls the Grok API. Exempt
 *     by design: the entire product promise is that ONLY this route is allowed
 *     to make external calls.
 *
 *   /api/generate/stop
 *     Writes a stop-signal file to local disk. No external calls, but it
 *     depends on an in-flight generation stream. Excluded to avoid coupling
 *     this test to the generate machinery.
 *
 *   /api/generate/recap
 *     Also calls the Grok API (summarises the previous chapter). Same
 *     exemption as /api/generate.
 *
 *   /api/privacy/last-payload
 *     Reads a local disk file (the last payload sent to Grok). No external
 *     calls. Excluded here because it is purely read-from-disk and has no
 *     external-egress risk. It would be safe to add, but the marginal value
 *     is low and it would require additional setup (writing a payload file).
 *
 * ─── ROUTES EXERCISED ───────────────────────────────────────────────────────
 *
 *   GET  /api/settings
 *   PUT  /api/settings
 *   GET  /api/stories
 *   POST /api/stories
 *   GET  /api/stories/[slug]
 *   PATCH /api/stories/[slug]
 *   GET  /api/stories/[slug]/bible
 *   PUT  /api/stories/[slug]/bible
 *   GET  /api/stories/[slug]/chapters
 *   POST /api/stories/[slug]/chapters   (×2, to enable reorder)
 *   POST /api/stories/[slug]/chapters/reorder
 *   GET  /api/stories/[slug]/chapters/[id]
 *   PATCH /api/stories/[slug]/chapters/[id]
 *   GET  /api/stories/[slug]/chapters/[id]/prompt
 *   DELETE /api/stories/[slug]/chapters/[id]
 *   DELETE /api/stories/[slug]
 *   POST /api/import/novelai/commit  (new-story mode)
 *   POST /api/import/novelai/parse
 *   POST /api/import/novelai/commit  (existing-story, reuses seeded slug)
 *   POST /api/stories/[slug]/export/epub  (with author-note configured —
 *     exercises the QR encoder + buildAuthorNoteHtml + epub-gen-memory path
 *     to assert the EPUB pipeline never phones home)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { createStory } from "@/lib/storage/stories";
import { createChapter, updateChapter } from "@/lib/storage/chapters";
import { saveConfig } from "@/lib/config";

// ─── Fetch recorder ──────────────────────────────────────────────────────────

type Recorded = { url: string; method: string };
let recorded: Recorded[];
let originalFetch: typeof globalThis.fetch | undefined;

function installFetchRecorder() {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    let url: string;
    let method = (init?.method ?? "GET").toUpperCase();
    if (typeof input === "string") {
      url = input;
    } else if (input instanceof URL) {
      url = input.toString();
    } else {
      // Request object
      url = (input as Request).url;
      method = (init?.method ?? (input as Request).method ?? "GET").toUpperCase();
    }
    recorded.push({ url, method });
    // Return a benign resolved Response so callers don't crash.
    return Promise.resolve(new Response(null, { status: 200 }));
  };
}

function restoreFetch() {
  if (originalFetch !== undefined) {
    globalThis.fetch = originalFetch;
  }
}

// Install/restore around every test in this file.
beforeEach(() => {
  recorded = [];
  installFetchRecorder();
});

afterEach(() => {
  restoreFetch();
});

// ─── Self-test: prove the stub actually works ─────────────────────────────────
//
// If this test fails, the recorder is broken and the main egress test proves
// nothing. Fix the recorder before trusting the egress assertion.

it("[self-test] fetch recorder captures an outbound call", async () => {
  await fetch("https://example.com/ping");
  expect(recorded).toEqual([{ url: "https://example.com/ping", method: "GET" }]);
});

it("[self-test] fetch recorder captures a POST with a URL object", async () => {
  await fetch(new URL("https://example.com/track"), { method: "POST" });
  expect(recorded).toEqual([{ url: "https://example.com/track", method: "POST" }]);
});

it("[self-test] fetch recorder captures a Request object", async () => {
  await fetch(new Request("https://example.com/req", { method: "DELETE" }));
  expect(recorded).toEqual([{ url: "https://example.com/req", method: "DELETE" }]);
});

// ─── Main privacy test ────────────────────────────────────────────────────────

describe("no external egress from API routes", () => {
  let tmpDir: string;
  // Keep original env so we can fully restore it even if a test mutates it.
  const originalEnv = process.env;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scriptr-privacy-"));
    process.env = { ...originalEnv, SCRIPTR_DATA_DIR: tmpDir };
    delete process.env.XAI_API_KEY;
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(tmpDir, { recursive: true, force: true });
  });

  // Helper: build a NextRequest-shaped Request for direct handler invocation.
  function makeReq(url: string, init?: RequestInit): NextRequest {
    return new Request(url, init) as unknown as NextRequest;
  }

  it("exercising every non-generate route records zero fetches", async () => {
    // ── Seed: create a story and two chapters directly via storage helpers ──
    // (Storage helpers are pure disk I/O — no fetch involved.)
    const story = await createStory(tmpDir, {
      title: "Privacy Test Story",
      authorPenName: "Test Author",
    });
    const slug = story.slug;

    const ch1 = await createChapter(tmpDir, slug, { title: "Chapter One" });
    const ch2 = await createChapter(tmpDir, slug, { title: "Chapter Two" });

    // Give chapter one some prose so the EPUB exporter has content to render
    // when this test exercises the export route below.
    await updateChapter(tmpDir, slug, ch1.id, {
      sections: [{ id: "egress-sec-1", content: "Once upon a time." }],
    });

    // Configure a pen-name profile so the EPUB export step below resolves a
    // non-undefined author-note. This exercises buildAuthorNoteHtml (QR
    // encoder + sanitizer + temp-file rewrite) — purely local, no fetch.
    await saveConfig(tmpDir, {
      penNameProfiles: {
        [story.authorPenName]: {
          email: "test@example.com",
          mailingListUrl: "https://list.example.com/test",
          defaultMessageHtml: "<p>Thanks for reading!</p>",
        },
      },
    });

    // Clear any recordings from the seed helpers (there shouldn't be any,
    // but be defensive).
    recorded = [];

    // ── GET /api/settings ──────────────────────────────────────────────────
    {
      const { GET } = await import("@/app/api/settings/route");
      const res = await GET();
      expect(res.status).toBe(200);
    }

    // ── PUT /api/settings ──────────────────────────────────────────────────
    {
      const { PUT } = await import("@/app/api/settings/route");
      const req = makeReq("http://localhost/api/settings", {
        method: "PUT",
        body: JSON.stringify({ theme: "dark" }),
        headers: { "content-type": "application/json" },
      });
      const res = await PUT(req);
      expect(res.status).toBe(200);
    }

    // ── GET /api/stories ───────────────────────────────────────────────────
    {
      const { GET } = await import("@/app/api/stories/route");
      const res = await GET();
      expect(res.status).toBe(200);
    }

    // ── POST /api/stories ──────────────────────────────────────────────────
    {
      const { POST } = await import("@/app/api/stories/route");
      const req = makeReq("http://localhost/api/stories", {
        method: "POST",
        body: JSON.stringify({ title: "Another Privacy Story" }),
        headers: { "content-type": "application/json" },
      });
      const res = await POST(req);
      expect(res.status).toBe(201);
    }

    // ── GET /api/stories/[slug] ────────────────────────────────────────────
    {
      const { GET } = await import("@/app/api/stories/[slug]/route");
      const req = makeReq(`http://localhost/api/stories/${slug}`);
      const ctx = { params: Promise.resolve({ slug }) };
      const res = await GET(req, ctx);
      expect(res.status).toBe(200);
    }

    // ── PATCH /api/stories/[slug] ──────────────────────────────────────────
    {
      const { PATCH } = await import("@/app/api/stories/[slug]/route");
      const req = makeReq(`http://localhost/api/stories/${slug}`, {
        method: "PATCH",
        body: JSON.stringify({ description: "Updated description" }),
        headers: { "content-type": "application/json" },
      });
      const ctx = { params: Promise.resolve({ slug }) };
      const res = await PATCH(req, ctx);
      expect(res.status).toBe(200);
    }

    // ── GET /api/stories/[slug]/bible ──────────────────────────────────────
    {
      const { GET } = await import("@/app/api/stories/[slug]/bible/route");
      const req = makeReq(`http://localhost/api/stories/${slug}/bible`);
      const ctx = { params: Promise.resolve({ slug }) };
      const res = await GET(req, ctx);
      expect(res.status).toBe(200);
    }

    // ── PUT /api/stories/[slug]/bible ──────────────────────────────────────
    {
      const { PUT } = await import("@/app/api/stories/[slug]/bible/route");
      const bible = {
        characters: [],
        setting: "A dark forest",
        pov: "third-limited" as const,
        tone: "Mysterious",
        styleNotes: "Sparse prose",
        nsfwPreferences: "none",
      };
      const req = makeReq(`http://localhost/api/stories/${slug}/bible`, {
        method: "PUT",
        body: JSON.stringify(bible),
        headers: { "content-type": "application/json" },
      });
      const ctx = { params: Promise.resolve({ slug }) };
      const res = await PUT(req, ctx);
      expect(res.status).toBe(200);
    }

    // ── GET /api/stories/[slug]/chapters ───────────────────────────────────
    {
      const { GET } = await import("@/app/api/stories/[slug]/chapters/route");
      const req = makeReq(`http://localhost/api/stories/${slug}/chapters`);
      const ctx = { params: Promise.resolve({ slug }) };
      const res = await GET(req, ctx);
      expect(res.status).toBe(200);
    }

    // ── POST /api/stories/[slug]/chapters ──────────────────────────────────
    // (Create a third chapter via the route handler, not the storage helper.)
    let ch3Id: string;
    {
      const { POST } = await import("@/app/api/stories/[slug]/chapters/route");
      const req = makeReq(`http://localhost/api/stories/${slug}/chapters`, {
        method: "POST",
        body: JSON.stringify({ title: "Chapter Three" }),
        headers: { "content-type": "application/json" },
      });
      const ctx = { params: Promise.resolve({ slug }) };
      const res = await POST(req, ctx);
      expect(res.status).toBe(201);
      const body = await res.json();
      ch3Id = body.data.id as string;
    }

    // ── POST /api/stories/[slug]/chapters/reorder ──────────────────────────
    {
      const { POST } = await import(
        "@/app/api/stories/[slug]/chapters/reorder/route"
      );
      // Reorder: ch2, ch1, ch3
      const req = makeReq(
        `http://localhost/api/stories/${slug}/chapters/reorder`,
        {
          method: "POST",
          body: JSON.stringify({ order: [ch2.id, ch1.id, ch3Id] }),
          headers: { "content-type": "application/json" },
        }
      );
      const ctx = { params: Promise.resolve({ slug }) };
      const res = await POST(req, ctx);
      expect(res.status).toBe(200);
    }

    // ── GET /api/stories/[slug]/chapters/[id] ─────────────────────────────
    {
      const { GET } = await import(
        "@/app/api/stories/[slug]/chapters/[id]/route"
      );
      const req = makeReq(
        `http://localhost/api/stories/${slug}/chapters/${ch1.id}`
      );
      const ctx = { params: Promise.resolve({ slug, id: ch1.id }) };
      const res = await GET(req, ctx);
      expect(res.status).toBe(200);
    }

    // ── PATCH /api/stories/[slug]/chapters/[id] ────────────────────────────
    {
      const { PATCH } = await import(
        "@/app/api/stories/[slug]/chapters/[id]/route"
      );
      const req = makeReq(
        `http://localhost/api/stories/${slug}/chapters/${ch1.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ summary: "Updated summary" }),
          headers: { "content-type": "application/json" },
        }
      );
      const ctx = { params: Promise.resolve({ slug, id: ch1.id }) };
      const res = await PATCH(req, ctx);
      expect(res.status).toBe(200);
    }

    // ── GET /api/stories/[slug]/chapters/[id]/prompt ──────────────────────
    {
      const { GET } = await import(
        "@/app/api/stories/[slug]/chapters/[id]/prompt/route"
      );
      const req = makeReq(
        `http://localhost/api/stories/${slug}/chapters/${ch1.id}/prompt`,
      );
      const ctx = { params: Promise.resolve({ slug, id: ch1.id }) };
      const res = await GET(req, ctx);
      expect(res.status).toBe(200);
    }

    // ── DELETE /api/stories/[slug]/chapters/[id] ───────────────────────────
    {
      const { DELETE } = await import(
        "@/app/api/stories/[slug]/chapters/[id]/route"
      );
      const req = makeReq(
        `http://localhost/api/stories/${slug}/chapters/${ch2.id}`
      );
      const ctx = { params: Promise.resolve({ slug, id: ch2.id }) };
      const res = await DELETE(req, ctx);
      expect(res.status).toBe(200);
    }

    // ── POST /api/import/novelai/commit (existing-story, reuses seed) ──────
    {
      const { POST } = await import("@/app/api/import/novelai/commit/route");
      const req = makeReq("http://localhost/api/import/novelai/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target: "existing-story",
          slug, // the seeded story from earlier in this test
          chapters: [{ title: "Via Egress Test", body: "some body" }],
        }),
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
    }

    // ── POST /api/stories/[slug]/export/epub (with author-note) ────────────
    // This exercises the full EPUB pipeline — QR encoder, buildAuthorNoteHtml,
    // epub-gen-memory, and the temp-file QR rewrite — to assert that
    // generating an EPUB with an author-note configured does NOT phone home.
    {
      const { POST } = await import(
        "@/app/api/stories/[slug]/export/epub/route"
      );
      const req = makeReq(
        `http://localhost/api/stories/${slug}/export/epub`,
        {
          method: "POST",
          body: JSON.stringify({ version: 3 }),
          headers: { "content-type": "application/json" },
        },
      );
      const ctx = { params: Promise.resolve({ slug }) };
      const res = await POST(req, ctx);
      expect(res.status).toBe(200);
    }

    // ── DELETE /api/stories/[slug] ─────────────────────────────────────────
    {
      const { DELETE } = await import("@/app/api/stories/[slug]/route");
      const req = makeReq(`http://localhost/api/stories/${slug}`);
      const ctx = { params: Promise.resolve({ slug }) };
      const res = await DELETE(req, ctx);
      expect(res.status).toBe(200);
    }

    // ── POST /api/import/novelai/commit ───────────────────────────────────
    {
      const { POST } = await import("@/app/api/import/novelai/commit/route");
      const req = makeReq("http://localhost/api/import/novelai/commit", {
        method: "POST",
        body: JSON.stringify({
          target: "new-story",
          stories: [
            {
              story: {
                title: "Egress Test Import",
                description: "",
                keywords: [],
              },
              bible: {
                characters: [],
                setting: "",
                pov: "third-limited",
                tone: "",
                styleNotes: "",
                nsfwPreferences: "",
              },
              chapters: [{ title: "Ch", body: "body" }],
            },
          ],
        }),
        headers: { "content-type": "application/json" },
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
    }

    // ── POST /api/import/novelai/parse ─────────────────────────────────────
    {
      const { POST } = await import("@/app/api/import/novelai/parse/route");
      const fixture = await readFile(
        join(__dirname, "..", "..", "lib", "novelai", "__fixtures__", "sample.story")
      );
      const fd = new FormData();
      fd.append(
        "file",
        new Blob([new Uint8Array(fixture)], { type: "application/octet-stream" }),
        "sample.story"
      );
      const req = new Request("http://localhost/api/import/novelai/parse", {
        method: "POST",
        body: fd,
      }) as unknown as NextRequest;
      const res = await POST(req);
      expect(res.status).toBe(200);
    }

    // ── The load-bearing assertion ─────────────────────────────────────────
    //
    // If any route called fetch(), it will appear in `recorded`. An empty
    // list is the only acceptable result — it means nothing phoned home.
    expect(recorded).toEqual([]);
  });
});
