"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createParser } from "eventsource-parser";
import type { GenerateEvent, GenerateRequest } from "@/lib/types";

export type StreamStatus =
  | "idle"
  | "requesting"
  | "streaming"
  | "done"
  | "error"
  | "stopped";

export interface StreamedSection {
  /** Monotonic local index — section 0, 1, 2, … since stream start. */
  index: number;
  /** Accumulated text for this section so far. */
  text: string;
}

export interface UseStreamGenerateReturn {
  status: StreamStatus;
  sections: StreamedSection[];
  /** jobId captured from the `start` event, or null until received. */
  jobId: string | null;
  /** Error info when status === "error". */
  error: { message: string; kind?: string } | null;
  /** Recap text when a `recap` SSE event arrives (full/continue modes only). */
  recap: string | null;
  /** Kick off a generation. Resets prior state. */
  start: (request: GenerateRequest) => void;
  /** Abort the in-flight stream. No-op if not streaming. Also POSTs /api/generate/stop. */
  stop: () => void;
}

/**
 * SSE client hook for `/api/generate`.
 *
 * Owns the full streaming lifecycle: issues the POST, parses SSE frames via
 * `eventsource-parser`, tracks accumulated section text, captures the jobId
 * from the opening `start` event, and cleans up on unmount or `stop()`.
 *
 * Privacy note: the fetch target is same-origin only — no third-party calls.
 */
export function useStreamGenerate(): UseStreamGenerateReturn {
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [sections, setSections] = useState<StreamedSection[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; kind?: string } | null>(null);
  const [recap, setRecap] = useState<string | null>(null);

  // Mutable refs for cross-closure access (jobId needed by stop(), abort
  // controller needed to actually cancel the fetch).
  const abortRef = useRef<AbortController | null>(null);
  const jobIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  // Unmount cleanup: abort any in-flight fetch so the read loop doesn't keep
  // calling setState after the component is gone.
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, []);

  const handleEvent = useCallback((ev: GenerateEvent) => {
    if (!mountedRef.current) return;
    switch (ev.type) {
      case "start": {
        jobIdRef.current = ev.jobId;
        setJobId(ev.jobId);
        // Seed section 0 now that the stream is live.
        setSections([{ index: 0, text: "" }]);
        setStatus("streaming");
        return;
      }
      case "token": {
        setSections((prev) => {
          if (prev.length === 0) {
            return [{ index: 0, text: ev.text }];
          }
          const last = prev[prev.length - 1];
          const updated: StreamedSection = { index: last.index, text: last.text + ev.text };
          return [...prev.slice(0, -1), updated];
        });
        return;
      }
      case "section-break": {
        setSections((prev) => {
          const nextIndex = prev.length === 0 ? 0 : prev[prev.length - 1].index + 1;
          return [...prev, { index: nextIndex, text: "" }];
        });
        return;
      }
      case "done": {
        setStatus("done");
        return;
      }
      case "recap": {
        setRecap(ev.text);
        return;
      }
      case "error": {
        setError({ message: ev.message, kind: ev.kind });
        setStatus("error");
        return;
      }
    }
  }, []);

  const start = useCallback((request: GenerateRequest) => {
    // Reset state for a fresh run. Abort any prior in-flight stream; the prior
    // read loop keys off its own AbortController, not stoppedRef, so the new
    // run's state is not affected by the prior cancellation.
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    jobIdRef.current = null;
    setJobId(null);
    setSections([]);
    setError(null);
    setRecap(null);
    setStatus("requesting");

    const abort = new AbortController();
    abortRef.current = abort;

    const parser = createParser({
      onEvent: (msg) => {
        // Only `data` carries our JSON payload; ignore event/id/retry.
        if (!msg.data) return;
        // Race guard: if this run's AbortController was fired (because stop()
        // or a subsequent start() superseded us), any chunks still being
        // drained from the buffered side of `reader.read()` must NOT mutate
        // state. Without this, a token enqueued before abort but parsed after
        // a second start() would ghost-append into the new run's sections.
        if (abort.signal.aborted) return;
        let parsed: GenerateEvent;
        try {
          parsed = JSON.parse(msg.data) as GenerateEvent;
        } catch {
          return;
        }
        handleEvent(parsed);
      },
    });

    void (async () => {
      // Abort-aware error handling: the `signal` is the authoritative source
      // for "was this run cancelled?" — not stoppedRef, which is shared state
      // and can be reset by a subsequent start().
      const wasCancelled = () => abort.signal.aborted;

      let response: Response;
      try {
        response = await fetch("/api/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
          signal: abort.signal,
        });
      } catch (err) {
        if (wasCancelled()) return;
        if (!mountedRef.current) return;
        const message = err instanceof Error ? err.message : "network error";
        setError({ message });
        setStatus("error");
        return;
      }

      if (!response.body) {
        if (wasCancelled()) return;
        if (!mountedRef.current) return;
        setError({ message: "no response body" });
        setStatus("error");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parser.feed(decoder.decode(value, { stream: true }));
        }
      } catch (err) {
        if (wasCancelled()) return;
        if (!mountedRef.current) return;
        const message = err instanceof Error ? err.message : "stream error";
        setError({ message });
        setStatus("error");
        return;
      } finally {
        try { reader.releaseLock(); } catch { /* ignore */ }
        // Natural completion: drop the controller so a subsequent stop() is a
        // no-op (there's nothing to abort, and no jobId-stop POST is desired
        // once the server has already finished).
        if (abortRef.current === abort) abortRef.current = null;
      }
    })();
  }, [handleEvent]);

  const stop = useCallback(() => {
    const controller = abortRef.current;
    const currentJobId = jobIdRef.current;
    if (!controller) return;

    controller.abort();
    abortRef.current = null;

    if (mountedRef.current) setStatus("stopped");

    if (currentJobId) {
      // Fire-and-forget: caller doesn't need to await.
      void fetch("/api/generate/stop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId: currentJobId }),
      }).catch(() => {
        // best-effort — the local abort already halted the client-side stream.
      });
    }
  }, []);

  return { status, sections, jobId, error, recap, start, stop };
}
