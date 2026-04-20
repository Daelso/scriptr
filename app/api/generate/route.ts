import type { NextRequest } from "next/server";
import type OpenAI from "openai";
import { readJson } from "@/lib/api";
import { loadConfig, effectiveDataDir } from "@/lib/config";
import { getStory } from "@/lib/storage/stories";
import { getBible } from "@/lib/storage/bible";
import { getChapter, updateChapter, listChapters } from "@/lib/storage/chapters";
import { lastPayloadFile } from "@/lib/storage/paths";
import { getGrokClient, MissingKeyError } from "@/lib/grok";
import { callGrokWithRetry, GrokError } from "@/lib/grok-retry";
import type { RetryOptions } from "@/lib/grok-retry";
import { buildChapterPrompt, buildSectionRegenPrompt, buildContinuePrompt } from "@/lib/prompts";
import { resolveStyleRules } from "@/lib/style";
import { generateRecap } from "@/lib/recap";
import { chunkBySectionBreak } from "@/lib/stream";
import { registerJob, clearJob } from "@/lib/generation-job";
import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { GenerateEvent, GenerateRequest, Section, Story } from "@/lib/types";

const PERSIST_INTERVAL_MS = 2000;

// Exported so tests can reduce baseDelayMs to avoid real backoff delays.
export const _RETRY_OPTIONS: RetryOptions = { maxRetries: 3, baseDelayMs: 500 };

type OpenAIChunk = {
  choices: Array<{
    delta?: { content?: string };
    finish_reason?: string | null;
  }>;
};

export async function POST(req: NextRequest): Promise<Response> {
  const body = await readJson<GenerateRequest>(req);

  if (body.mode === "full") {
    return handleFull(body);
  }
  if (body.mode === "section") {
    return handleSection(body);
  }
  if (body.mode === "continue") {
    return handleContinue(body);
  }
  return json400(`unsupported mode: ${body.mode}`);
}

type ChapterStreamOptions = {
  dataDir: string;
  storySlug: string;
  chapterId: string;
  model: string;
  prompt: { system: string; user: string };
  /** Initial sections snapshot — new sections are appended to this. */
  initialSections: Section[];
  client: OpenAI;
  abort: AbortController;
  jobId: string;
  /** When true, generate a recap after the done event (full/continue modes only). */
  autoRecap?: boolean;
  /** The full story object, used for recap generation. */
  story?: Story;
};

/**
 * Shared streaming loop for full-mode and continue-mode generation.
 * Both modes stream new prose into sections, chunked by section breaks.
 * The only difference between them is the prompt and the initialSections.
 *
 * Option Y from the design doc: extract into a shared helper to avoid duplication.
 */
function runChapterStream(opts: ChapterStreamOptions): Response {
  const { dataDir, storySlug, chapterId, model, prompt, initialSections, client, abort, jobId, autoRecap, story } = opts;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Snapshot sections — new content is appended here
      const sections: Section[] = [...initialSections];
      let currentText = "";
      let finishReason = "stop";

      // Write queue: serializes all updateChapter calls to prevent concurrent writes.
      let writeQueue: Promise<void> = Promise.resolve();
      const enqueueWrite = (fn: () => Promise<void>) => {
        writeQueue = writeQueue.then(fn, fn);
      };

      // Stable ID for the current in-progress (ephemeral) section.
      // A new ID is minted at stream start and again after each section-break,
      // so every periodic tick within the same "phase" writes the same section ID.
      let inProgressSectionId = randomUUID();

      const persistTimer = setInterval(() => {
        enqueueWrite(async () => {
          const snapshotSections: Section[] = [
            ...sections,
            ...(currentText ? [{ id: inProgressSectionId, content: currentText }] : []),
          ];
          try {
            await updateChapter(dataDir, storySlug, chapterId, {
              sections: snapshotSections,
            });
          } catch {
            // best-effort; don't crash stream on periodic save failure
          }
        });
      }, PERSIST_INTERVAL_MS);

      controller.enqueue(sse({ type: "start", jobId }));

      try {
        const response = await callGrokWithRetry(
          client,
          {
            model,
            stream: true,
            messages: [
              { role: "system", content: prompt.system },
              { role: "user", content: prompt.user },
            ],
          },
          _RETRY_OPTIONS
        );

        async function* tokensOf(
          openAIStream: AsyncIterable<OpenAIChunk>
        ): AsyncIterable<string> {
          for await (const chunk of openAIStream) {
            if (abort.signal.aborted) return;
            const choice = chunk.choices?.[0];
            if (choice?.finish_reason) finishReason = choice.finish_reason;
            const content = choice?.delta?.content;
            if (content) yield content;
          }
        }

        for await (const ev of chunkBySectionBreak(
          tokensOf(response as unknown as AsyncIterable<OpenAIChunk>)
        )) {
          if (abort.signal.aborted) break;

          if (ev.type === "token") {
            currentText += ev.text;
            controller.enqueue(sse({ type: "token", text: ev.text }));
          } else if (ev.type === "section-break") {
            if (currentText) {
              sections.push({ id: randomUUID(), content: currentText });
              currentText = "";
              // Mint a fresh ephemeral ID for the next in-progress phase.
              inProgressSectionId = randomUUID();
              enqueueWrite(async () => {
                await updateChapter(dataDir, storySlug, chapterId, { sections: [...sections] });
              });
            }
            controller.enqueue(sse({ type: "section-break" }));
          }
          // ev.type === "done" is handled after the loop
        }

        // Final section (no trailing section-break)
        clearInterval(persistTimer);

        if (currentText) {
          sections.push({ id: randomUUID(), content: currentText });
          currentText = "";
        }

        enqueueWrite(async () => {
          try {
            await updateChapter(dataDir, storySlug, chapterId, { sections: [...sections] });
          } catch {
            // Generation completed but final save failed; periodic saves already persisted progress.
          }
        });
        await writeQueue;

        controller.enqueue(sse({ type: "done", finishReason }));

        // Auto-recap: best-effort, wrapped in try/catch. Errors are swallowed;
        // the chapter already saved successfully with recap = "".
        if (autoRecap && story) {
          let recap = "";
          try {
            // Re-read chapter from disk so the recap prompt sees the just-written sections.
            const freshChapter = await getChapter(dataDir, storySlug, chapterId);
            if (freshChapter) {
              recap = await generateRecap(
                client as Parameters<typeof generateRecap>[0],
                model,
                story,
                freshChapter,
                _RETRY_OPTIONS
              );
            }
          } catch {
            // Recap is best-effort; chapter still saved with recap = ""
          }
          try {
            await updateChapter(dataDir, storySlug, chapterId, { recap });
          } catch {
            // best-effort
          }
          controller.enqueue(sse({ type: "recap", text: recap }));
        }
      } catch (err) {
        clearInterval(persistTimer);

        const message = err instanceof Error ? err.message : "stream error";
        const kind = err instanceof GrokError ? err.kind : "unknown";

        // Push any in-flight currentText as a final section
        if (currentText) {
          sections.push({ id: randomUUID(), content: currentText });
          currentText = "";
        }
        // Serialize partial save with any pending queued writes
        enqueueWrite(async () => {
          try {
            await updateChapter(dataDir, storySlug, chapterId, { sections: [...sections] });
          } catch {
            // best-effort partial save
          }
        });
        await writeQueue;

        controller.enqueue(sse({ type: "error", message, kind }));
      } finally {
        clearInterval(persistTimer); // defensive — idempotent
        clearJob(jobId);
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: sseHeaders() });
}

async function handleFull(body: GenerateRequest): Promise<Response> {
  const dataDir = effectiveDataDir();
  const config = await loadConfig(dataDir);

  const story = await getStory(dataDir, body.storySlug);
  if (!story) return json400("story not found");

  const bible = await getBible(dataDir, body.storySlug);
  if (!bible) return json400("bible not found");

  const chapter = await getChapter(dataDir, body.storySlug, body.chapterId);
  if (!chapter) return json400("chapter not found");

  // priorRecaps: chapters that come BEFORE this one (1-based chapterIndex)
  const allChapters = await listChapters(dataDir, body.storySlug);
  const chapterIndex = allChapters.findIndex((c) => c.id === chapter.id);
  const priorRecaps =
    chapterIndex > 0
      ? allChapters
          .slice(0, chapterIndex)
          .map((c, i) => ({ chapterIndex: i + 1, recap: c.recap }))
      : [];

  // Include last chapter full text per config
  const lastChapterFullText =
    config.includeLastChapterFullText && chapterIndex > 0
      ? allChapters[chapterIndex - 1].sections.map((s) => s.content).join("\n---\n")
      : undefined;

  const prompt = buildChapterPrompt({
    story,
    bible,
    priorRecaps,
    chapter,
    includeLastChapterFullText: config.includeLastChapterFullText,
    lastChapterFullText,
    style: resolveStyleRules(config, bible),
  });

  const model = story.modelOverride ?? config.defaultModel;

  // Write .last-payload.json — exactly four fields, no headers, no key
  await writeFile(
    lastPayloadFile(dataDir, body.storySlug),
    JSON.stringify({ model, mode: body.mode, system: prompt.system, user: prompt.user }, null, 2),
    "utf-8"
  );

  // Get client — MissingKeyError yields SSE 500
  let client;
  try {
    client = getGrokClient(config);
  } catch (err) {
    const message = err instanceof MissingKeyError ? err.message : "missing API key";
    const errorStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(sse({ type: "error", message, kind: "auth" }));
        controller.close();
      },
    });
    return new Response(errorStream, { status: 500, headers: sseHeaders() });
  }

  const abort = new AbortController();
  const jobId = registerJob({ abort, storySlug: body.storySlug, chapterId: body.chapterId });

  return runChapterStream({
    dataDir,
    storySlug: body.storySlug,
    chapterId: body.chapterId,
    model,
    prompt,
    initialSections: [...chapter.sections],
    client,
    abort,
    jobId,
    autoRecap: config.autoRecap,
    story,
  });
}

async function handleContinue(body: GenerateRequest): Promise<Response> {
  // Design note: sectionId is reused as the "continue pivot" — the section after which
  // to truncate. Mode disambiguates semantics (section mode: rewrite; continue mode: pivot).
  if (typeof body.sectionId !== "string" || body.sectionId === "") {
    return json400("sectionId required");
  }
  if (body.regenNote !== undefined && typeof body.regenNote !== "string") {
    return json400("regenNote must be a string");
  }
  const regenNote = body.regenNote ?? "";

  const dataDir = effectiveDataDir();
  const config = await loadConfig(dataDir);

  const story = await getStory(dataDir, body.storySlug);
  if (!story) return json400("story not found");

  const bible = await getBible(dataDir, body.storySlug);
  if (!bible) return json400("bible not found");

  const originalChapter = await getChapter(dataDir, body.storySlug, body.chapterId);
  if (!originalChapter) return json400("chapter not found");

  const pivotIndex = originalChapter.sections.findIndex((s) => s.id === body.sectionId);
  if (pivotIndex === -1) return json400("section not found");

  // Truncate: keep sections up to and including the pivot, drop everything after.
  // Truncation is committed to disk BEFORE the stream starts — so even if the stream
  // fails, the truncation is durable (tested in "truncation happens even if stream fails").
  const truncatedSections = originalChapter.sections.slice(0, pivotIndex + 1);
  await updateChapter(dataDir, body.storySlug, body.chapterId, { sections: truncatedSections });

  const allChapters = await listChapters(dataDir, body.storySlug);
  const chapterIndex = allChapters.findIndex((c) => c.id === originalChapter.id);
  const priorRecaps =
    chapterIndex > 0
      ? allChapters
          .slice(0, chapterIndex)
          .map((c, i) => ({ chapterIndex: i + 1, recap: c.recap }))
      : [];

  // Build a chapter snapshot with the truncated sections for prompt building
  const truncatedChapter = { ...originalChapter, sections: truncatedSections };

  const prompt = buildContinuePrompt({ story, bible, priorRecaps, chapter: truncatedChapter, regenNote, style: resolveStyleRules(config, bible) });
  const model = story.modelOverride ?? config.defaultModel;

  // Write .last-payload.json — exactly four fields, no headers, no key
  await writeFile(
    lastPayloadFile(dataDir, body.storySlug),
    JSON.stringify({ model, mode: body.mode, system: prompt.system, user: prompt.user }, null, 2),
    "utf-8"
  );

  // Get client — MissingKeyError yields SSE 500
  let client;
  try {
    client = getGrokClient(config);
  } catch (err) {
    const message = err instanceof MissingKeyError ? err.message : "missing API key";
    const errorStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(sse({ type: "error", message, kind: "auth" }));
        controller.close();
      },
    });
    return new Response(errorStream, { status: 500, headers: sseHeaders() });
  }

  const abort = new AbortController();
  const jobId = registerJob({ abort, storySlug: body.storySlug, chapterId: body.chapterId });

  // initialSections = truncatedSections: new prose is appended after the pivot
  return runChapterStream({
    dataDir,
    storySlug: body.storySlug,
    chapterId: body.chapterId,
    model,
    prompt,
    initialSections: [...truncatedSections],
    client,
    abort,
    jobId,
    autoRecap: config.autoRecap,
    story,
  });
}

async function handleSection(body: GenerateRequest): Promise<Response> {
  if (typeof body.sectionId !== "string" || body.sectionId === "") {
    return json400("sectionId required");
  }
  if (body.regenNote !== undefined && typeof body.regenNote !== "string") {
    return json400("regenNote must be a string");
  }
  const regenNote = body.regenNote ?? "";

  const dataDir = effectiveDataDir();
  const config = await loadConfig(dataDir);

  const story = await getStory(dataDir, body.storySlug);
  if (!story) return json400("story not found");

  const bible = await getBible(dataDir, body.storySlug);
  if (!bible) return json400("bible not found");

  const chapter = await getChapter(dataDir, body.storySlug, body.chapterId);
  if (!chapter) return json400("chapter not found");

  const targetIndex = chapter.sections.findIndex((s) => s.id === body.sectionId);
  if (targetIndex === -1) return json400("section not found");

  const prompt = buildSectionRegenPrompt({
    story,
    bible,
    chapter,
    targetSectionId: body.sectionId,
    regenNote,
    style: resolveStyleRules(config, bible),
  });

  const model = story.modelOverride ?? config.defaultModel;

  await writeFile(
    lastPayloadFile(dataDir, body.storySlug),
    JSON.stringify({ model, mode: body.mode, system: prompt.system, user: prompt.user }, null, 2),
    "utf-8"
  );

  let client;
  try {
    client = getGrokClient(config);
  } catch (err) {
    const message = err instanceof Error ? err.message : "missing API key";
    const errorStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(sse({ type: "error", message, kind: "auth" }));
        controller.close();
      },
    });
    return new Response(errorStream, { status: 500, headers: sseHeaders() });
  }

  const abort = new AbortController();
  const jobId = registerJob({ abort, storySlug: body.storySlug, chapterId: body.chapterId });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let accumulated = "";
      let finishReason = "stop";

      controller.enqueue(sse({ type: "start", jobId }));

      try {
        const response = await callGrokWithRetry(
          client,
          {
            model,
            stream: true,
            messages: [
              { role: "system", content: prompt.system },
              { role: "user", content: prompt.user },
            ],
          },
          _RETRY_OPTIONS
        );

        for await (const chunk of response as unknown as AsyncIterable<OpenAIChunk>) {
          if (abort.signal.aborted) break;
          const choice = chunk.choices?.[0];
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          const content = choice?.delta?.content;
          if (content) {
            accumulated += content;
            controller.enqueue(sse({ type: "token", text: content }));
          }
        }

        // Replace the target section with accumulated text (trimmed)
        const newSections = [...chapter.sections];
        newSections[targetIndex] = {
          ...newSections[targetIndex],
          content: accumulated.trim(),
          regenNote,
        };
        try {
          await updateChapter(dataDir, body.storySlug, body.chapterId, { sections: newSections });
        } catch {
          // best-effort; generation succeeded even if save fails
        }

        controller.enqueue(sse({ type: "done", finishReason }));
      } catch (err) {
        const message = err instanceof Error ? err.message : "stream error";
        const kind = err instanceof GrokError ? err.kind : "unknown";
        // On error: do NOT save partial content. Original section stays intact.
        controller.enqueue(sse({ type: "error", message, kind }));
      } finally {
        clearJob(jobId);
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: sseHeaders() });
}

function sse(event: GenerateEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

function sseHeaders() {
  return {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    "connection": "keep-alive",
  };
}

function json400(message: string): Response {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status: 400,
    headers: { "content-type": "application/json" },
  });
}
