import { describe, it, expect } from "vitest";
import type { NextRequest } from "next/server";
import { registerJob } from "@/lib/generation-job";

import { POST } from "@/app/api/generate/stop/route";

function makeReq(body: unknown): NextRequest {
  return new Request("http://localhost/api/generate/stop", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }) as unknown as NextRequest;
}

describe("POST /api/generate/stop", () => {
  it("missing jobId returns 400", async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("jobId required");
  });

  it("non-string jobId returns 400", async () => {
    const res = await POST(makeReq({ jobId: 42 }));
    expect(res.status).toBe(400);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("jobId required");
  });

  it("empty string jobId returns 400", async () => {
    const res = await POST(makeReq({ jobId: "" }));
    expect(res.status).toBe(400);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("jobId required");
  });

  it("nonexistent jobId returns stopped: false", async () => {
    const res = await POST(makeReq({ jobId: "00000000-0000-0000-0000-000000000000" }));
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; data: { stopped: boolean } };
    expect(body.ok).toBe(true);
    expect(body.data.stopped).toBe(false);
  });

  it("valid jobId aborts the job and returns stopped: true", async () => {
    const abort = new AbortController();
    const jobId = registerJob({ abort, storySlug: "my-story", chapterId: "ch-1" });

    const res = await POST(makeReq({ jobId }));
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; data: { stopped: boolean } };
    expect(body.ok).toBe(true);
    expect(body.data.stopped).toBe(true);

    // AbortController signal is aborted
    expect(abort.signal.aborted).toBe(true);
  });

  it("after aborting, the jobId is no longer in the registry", async () => {
    const abort = new AbortController();
    const jobId = registerJob({ abort, storySlug: "my-story", chapterId: "ch-1" });

    await POST(makeReq({ jobId }));

    // Second call with same jobId: job is gone, returns stopped: false
    const res2 = await POST(makeReq({ jobId }));
    const body2 = await res2.json() as { ok: boolean; data: { stopped: boolean } };
    expect(body2.data.stopped).toBe(false);
  });
});
