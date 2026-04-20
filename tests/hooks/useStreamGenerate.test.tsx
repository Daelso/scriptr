// @vitest-environment jsdom
/**
 * Tests for the useStreamGenerate hook (SSE client for /api/generate).
 *
 * Uses vitest's per-file jsdom environment override so React hooks can render.
 * renderHook is built manually since @testing-library/react is not installed.
 *
 * Strategy:
 *   - Stub global fetch so `/api/generate` returns a Response whose body is a
 *     ReadableStream<Uint8Array> yielding pre-composed SSE frames.
 *   - Drive the stream manually from the test (enqueue, close) so we can
 *     observe hook state between frames via act().
 *   - The `/api/generate/stop` call uses the same fetch stub; we assert on the
 *     recorded calls.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { useStreamGenerate } from "@/hooks/useStreamGenerate";
import type { GenerateEvent, GenerateRequest } from "@/lib/types";

// ─── Minimal renderHook harness ──────────────────────────────────────────────

type HookResult<P, R> = {
  result: { current: R };
  rerender: (props?: P) => void;
  unmount: () => void;
};

function renderHook<P, R>(
  callback: (props: P) => R,
  options: { initialProps: P },
): HookResult<P, R> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;

  const result: { current: R } = { current: null as unknown as R };
  let currentProps = options.initialProps;

  function TestComponent({ props }: { props: P }) {
    result.current = callback(props);
    return null;
  }

  act(() => {
    root = createRoot(container);
    root.render(React.createElement(TestComponent, { props: currentProps }));
  });

  function rerender(newProps?: P) {
    if (newProps !== undefined) currentProps = newProps;
    act(() => {
      root.render(React.createElement(TestComponent, { props: currentProps }));
    });
  }

  function unmount() {
    act(() => { root.unmount(); });
    container.remove();
  }

  return { result, rerender, unmount };
}

// ─── SSE stream helpers ──────────────────────────────────────────────────────

/**
 * Build a controllable SSE stream. Returns both the Response-like body and a
 * set of helpers to push events into it from the test.
 */
function makeSseStream(): {
  body: ReadableStream<Uint8Array>;
  push: (event: GenerateEvent) => void;
  pushRaw: (chunk: string) => void;
  close: () => void;
  error: (err: unknown) => void;
} {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array>;

  const body = new ReadableStream<Uint8Array>({
    start(c) { controller = c; },
  });

  return {
    body,
    push(event) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    },
    pushRaw(chunk) {
      controller.enqueue(encoder.encode(chunk));
    },
    close() {
      controller.close();
    },
    error(err) {
      controller.error(err);
    },
  };
}

/** Yield once so the hook's read loop can pull queued chunks. */
async function tick() {
  // Multiple microtask flushes — the read loop awaits reader.read() which needs
  // a full event-loop turn to observe newly-enqueued bytes in jsdom.
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

// ─── Test fixtures ───────────────────────────────────────────────────────────

const REQUEST: GenerateRequest = {
  storySlug: "test-story",
  chapterId: "ch-1",
  mode: "full",
};

type FetchCall = { url: string; init: RequestInit | undefined };

function setupFetchMock(): { calls: FetchCall[]; setHandler: (fn: (url: string, init?: RequestInit) => Response | Promise<Response>) => void } {
  const calls: FetchCall[] = [];
  let handler: (url: string, init?: RequestInit) => Response | Promise<Response> = () => {
    throw new Error("fetch handler not set");
  };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    return await handler(url, init);
  }));
  return {
    calls,
    setHandler(fn) { handler = fn; },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("useStreamGenerate", () => {
  beforeEach(() => {
    // Real timers — SSE resolves via microtasks, fake timers block that.
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("starts in idle status with empty sections and null jobId/error", () => {
    setupFetchMock();
    const { result } = renderHook(() => useStreamGenerate(), { initialProps: undefined });
    expect(result.current.status).toBe("idle");
    expect(result.current.sections).toEqual([]);
    expect(result.current.jobId).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.recap).toBeNull();
  });

  it("start(request) transitions status idle → requesting → streaming and POSTs to /api/generate", async () => {
    const stream = makeSseStream();
    const mock = setupFetchMock();
    mock.setHandler((url) => {
      if (url === "/api/generate") {
        return new Response(stream.body, {
          headers: { "content-type": "text/event-stream" },
        });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const { result } = renderHook(() => useStreamGenerate(), { initialProps: undefined });

    act(() => { result.current.start(REQUEST); });
    expect(result.current.status).toBe("requesting");

    await act(async () => { await tick(); });

    stream.push({ type: "start", jobId: "job-1" });
    await act(async () => { await tick(); });

    expect(result.current.status).toBe("streaming");
    expect(result.current.jobId).toBe("job-1");

    // Verify fetch call
    expect(mock.calls.length).toBe(1);
    expect(mock.calls[0].url).toBe("/api/generate");
    expect(mock.calls[0].init?.method).toBe("POST");
    expect(mock.calls[0].init?.body).toBe(JSON.stringify(REQUEST));
    const headers = mock.calls[0].init?.headers as Record<string, string> | undefined;
    expect(headers?.["content-type"] ?? headers?.["Content-Type"]).toBe("application/json");

    stream.push({ type: "done", finishReason: "stop" });
    stream.close();
    await act(async () => { await tick(); });
    expect(result.current.status).toBe("done");
  });

  it("token events accumulate into the current section's text", async () => {
    const stream = makeSseStream();
    const mock = setupFetchMock();
    mock.setHandler(() => new Response(stream.body, {
      headers: { "content-type": "text/event-stream" },
    }));

    const { result } = renderHook(() => useStreamGenerate(), { initialProps: undefined });
    act(() => { result.current.start(REQUEST); });
    await act(async () => { await tick(); });

    stream.push({ type: "start", jobId: "job-1" });
    await act(async () => { await tick(); });

    stream.push({ type: "token", text: "Hello, " });
    stream.push({ type: "token", text: "world!" });
    await act(async () => { await tick(); });

    expect(result.current.sections).toHaveLength(1);
    expect(result.current.sections[0]).toEqual({ index: 0, text: "Hello, world!" });

    stream.push({ type: "done", finishReason: "stop" });
    stream.close();
    await act(async () => { await tick(); });
  });

  it("section-break pushes a new empty section and subsequent tokens land there", async () => {
    const stream = makeSseStream();
    setupFetchMock().setHandler(() => new Response(stream.body, {
      headers: { "content-type": "text/event-stream" },
    }));

    const { result } = renderHook(() => useStreamGenerate(), { initialProps: undefined });
    act(() => { result.current.start(REQUEST); });
    await act(async () => { await tick(); });

    stream.push({ type: "start", jobId: "job-1" });
    stream.push({ type: "token", text: "First section." });
    stream.push({ type: "section-break" });
    stream.push({ type: "token", text: "Second one." });
    await act(async () => { await tick(); });

    expect(result.current.sections).toHaveLength(2);
    expect(result.current.sections[0]).toEqual({ index: 0, text: "First section." });
    expect(result.current.sections[1]).toEqual({ index: 1, text: "Second one." });

    stream.push({ type: "done", finishReason: "stop" });
    stream.close();
    await act(async () => { await tick(); });
  });

  it("done event transitions status to 'done'", async () => {
    const stream = makeSseStream();
    setupFetchMock().setHandler(() => new Response(stream.body, {
      headers: { "content-type": "text/event-stream" },
    }));

    const { result } = renderHook(() => useStreamGenerate(), { initialProps: undefined });
    act(() => { result.current.start(REQUEST); });
    await act(async () => { await tick(); });

    stream.push({ type: "start", jobId: "job-1" });
    stream.push({ type: "token", text: "prose" });
    stream.push({ type: "done", finishReason: "stop" });
    stream.close();
    await act(async () => { await tick(); });

    expect(result.current.status).toBe("done");
  });

  it("recap event is exposed via the recap field", async () => {
    const stream = makeSseStream();
    setupFetchMock().setHandler(() => new Response(stream.body, {
      headers: { "content-type": "text/event-stream" },
    }));

    const { result } = renderHook(() => useStreamGenerate(), { initialProps: undefined });
    act(() => { result.current.start(REQUEST); });
    await act(async () => { await tick(); });

    stream.push({ type: "start", jobId: "job-1" });
    stream.push({ type: "token", text: "content" });
    stream.push({ type: "done", finishReason: "stop" });
    stream.push({ type: "recap", text: "A recap of the chapter." });
    stream.close();
    await act(async () => { await tick(); });

    expect(result.current.recap).toBe("A recap of the chapter.");
  });

  it("stop() aborts the in-flight fetch and POSTs to /api/generate/stop with the jobId", async () => {
    const stream = makeSseStream();
    const mock = setupFetchMock();
    let capturedSignal: AbortSignal | undefined;
    mock.setHandler((url, init) => {
      if (url === "/api/generate") {
        capturedSignal = init?.signal ?? undefined;
        return new Response(stream.body, {
          headers: { "content-type": "text/event-stream" },
        });
      }
      if (url === "/api/generate/stop") {
        return new Response(JSON.stringify({ ok: true, data: { stopped: true } }), {
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const { result } = renderHook(() => useStreamGenerate(), { initialProps: undefined });
    act(() => { result.current.start(REQUEST); });
    await act(async () => { await tick(); });

    stream.push({ type: "start", jobId: "job-xyz" });
    await act(async () => { await tick(); });
    expect(result.current.jobId).toBe("job-xyz");

    act(() => { result.current.stop(); });
    await act(async () => { await tick(); });

    expect(capturedSignal?.aborted).toBe(true);
    expect(result.current.status).toBe("stopped");

    // Find the stop call
    const stopCall = mock.calls.find((c) => c.url === "/api/generate/stop");
    expect(stopCall).toBeDefined();
    expect(stopCall!.init?.method).toBe("POST");
    expect(stopCall!.init?.body).toBe(JSON.stringify({ jobId: "job-xyz" }));
  });

  it("stop() with no active stream is a no-op (does not POST /api/generate/stop)", async () => {
    const mock = setupFetchMock();
    mock.setHandler(() => {
      throw new Error("fetch should not be called");
    });

    const { result } = renderHook(() => useStreamGenerate(), { initialProps: undefined });
    expect(result.current.status).toBe("idle");

    act(() => { result.current.stop(); });
    await act(async () => { await tick(); });

    expect(mock.calls.filter((c) => c.url === "/api/generate/stop").length).toBe(0);
    expect(result.current.status).toBe("idle");
  });

  it("stop() after the stream completes naturally is a no-op (status stays 'done')", async () => {
    const stream = makeSseStream();
    const mock = setupFetchMock();
    mock.setHandler(() => new Response(stream.body, {
      headers: { "content-type": "text/event-stream" },
    }));

    const { result } = renderHook(() => useStreamGenerate(), { initialProps: undefined });
    act(() => { result.current.start(REQUEST); });
    await act(async () => { await tick(); });

    stream.push({ type: "start", jobId: "job-done" });
    stream.push({ type: "token", text: "all done" });
    stream.push({ type: "done", finishReason: "stop" });
    stream.close();
    await act(async () => { await tick(); });

    expect(result.current.status).toBe("done");

    act(() => { result.current.stop(); });
    await act(async () => { await tick(); });

    // No /api/generate/stop POST should have been made — the server already finished.
    expect(mock.calls.filter((c) => c.url === "/api/generate/stop").length).toBe(0);
    // Status remains "done" — stop() shouldn't overwrite a natural completion.
    expect(result.current.status).toBe("done");
  });

  it("fetch rejection transitions status to 'error' with the message set", async () => {
    setupFetchMock().setHandler(() => {
      throw new Error("network down");
    });

    const { result } = renderHook(() => useStreamGenerate(), { initialProps: undefined });
    act(() => { result.current.start(REQUEST); });
    await act(async () => { await tick(); });

    expect(result.current.status).toBe("error");
    expect(result.current.error?.message).toBe("network down");
  });

  it("server-emitted error event transitions status to 'error'", async () => {
    const stream = makeSseStream();
    setupFetchMock().setHandler(() => new Response(stream.body, {
      headers: { "content-type": "text/event-stream" },
    }));

    const { result } = renderHook(() => useStreamGenerate(), { initialProps: undefined });
    act(() => { result.current.start(REQUEST); });
    await act(async () => { await tick(); });

    stream.push({ type: "start", jobId: "job-e" });
    stream.push({ type: "error", message: "rate limited", kind: "rate-limit" });
    stream.close();
    await act(async () => { await tick(); });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toEqual({ message: "rate limited", kind: "rate-limit" });
  });

  it("start() called while stream 1 is still producing does not let stream 1 mutate state after stream 2 takes over", async () => {
    // Regression: the restart-race bug. Two streams overlap — stream 1 has
    // emitted a token but NOT `done` when start() is called a second time.
    // Stream 2 must fully own state; stream 1's still-open controller must
    // never append a "ghost" token after stream 2 claims ownership.
    const stream1 = makeSseStream();
    const stream2 = makeSseStream();
    const streams = [stream1, stream2];
    let which = 0;
    setupFetchMock().setHandler((url) => {
      if (url === "/api/generate") {
        const s = streams[which++];
        return new Response(s.body, { headers: { "content-type": "text/event-stream" } });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const { result } = renderHook(() => useStreamGenerate(), { initialProps: undefined });

    // Kick off stream 1 and push one token.
    act(() => { result.current.start(REQUEST); });
    await act(async () => { await tick(); });
    stream1.push({ type: "start", jobId: "job-1" });
    stream1.push({ type: "token", text: "aaa" });
    await act(async () => { await tick(); });
    expect(result.current.jobId).toBe("job-1");
    expect(result.current.sections[0]?.text).toBe("aaa");

    // OVERLAP: call start() again WITHOUT closing stream 1. This should abort
    // stream 1's fetch and install stream 2 as the authoritative owner.
    act(() => { result.current.start(REQUEST); });
    expect(result.current.status).toBe("requesting");
    expect(result.current.sections).toEqual([]);
    expect(result.current.jobId).toBeNull();

    // Drive stream 2 to completion.
    await act(async () => { await tick(); });
    stream2.push({ type: "start", jobId: "job-2" });
    stream2.push({ type: "token", text: "bbb" });
    stream2.push({ type: "done", finishReason: "stop" });
    stream2.close();
    await act(async () => { await tick(); });

    // Stream 2 owns the world.
    expect(result.current.status).toBe("done");
    expect(result.current.jobId).toBe("job-2");
    expect(result.current.sections).toHaveLength(1);
    expect(result.current.sections[0].text).toBe("bbb");

    // Now try to "haunt" stream 2's state from stream 1's still-open
    // controller. These enqueues must not reach the handler because stream 1's
    // AbortController was aborted when start() was called the second time.
    stream1.push({ type: "token", text: "GHOST" });
    stream1.push({ type: "done", finishReason: "stop" });
    try { stream1.close(); } catch { /* already cancelled */ }
    await act(async () => { await tick(); });

    // No ghost append. Status/jobId/sections still reflect stream 2 only.
    expect(result.current.status).toBe("done");
    expect(result.current.jobId).toBe("job-2");
    expect(result.current.sections).toHaveLength(1);
    expect(result.current.sections[0].text).toBe("bbb");
  });

  it("a fresh start() after a completed stream resets state", async () => {
    const stream1 = makeSseStream();
    let which = 0;
    const streams = [stream1];
    setupFetchMock().setHandler((url) => {
      if (url === "/api/generate") {
        const s = streams[which++];
        return new Response(s.body, { headers: { "content-type": "text/event-stream" } });
      }
      throw new Error("unexpected");
    });

    const { result } = renderHook(() => useStreamGenerate(), { initialProps: undefined });
    act(() => { result.current.start(REQUEST); });
    await act(async () => { await tick(); });

    stream1.push({ type: "start", jobId: "job-1" });
    stream1.push({ type: "token", text: "first run" });
    stream1.push({ type: "done", finishReason: "stop" });
    stream1.close();
    await act(async () => { await tick(); });

    expect(result.current.status).toBe("done");
    expect(result.current.sections[0].text).toBe("first run");

    // Second start
    const stream2 = makeSseStream();
    streams.push(stream2);

    act(() => { result.current.start(REQUEST); });
    expect(result.current.sections).toEqual([]);
    expect(result.current.jobId).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.recap).toBeNull();
    expect(result.current.status).toBe("requesting");

    // Settle the second stream so it doesn't leak
    await act(async () => { await tick(); });
    stream2.push({ type: "start", jobId: "job-2" });
    stream2.push({ type: "done", finishReason: "stop" });
    stream2.close();
    await act(async () => { await tick(); });
  });
});
