import type { NextRequest } from "next/server";
import { readJson } from "@/lib/api";
import { loadConfig, effectiveDataDir } from "@/lib/config";
import { getStory } from "@/lib/storage/stories";
import { getBible } from "@/lib/storage/bible";
import { getChapter, updateChapter, listChapters } from "@/lib/storage/chapters";
import { lastPayloadFile } from "@/lib/storage/paths";
import { getGrokClient, MissingKeyError } from "@/lib/grok";
import { callGrokWithRetry, GrokError } from "@/lib/grok-retry";
import { buildChapterPrompt } from "@/lib/prompts";
import { chunkBySectionBreak } from "@/lib/stream";
import { registerJob, clearJob } from "@/lib/generation-job";
import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { GenerateEvent, GenerateRequest, Section } from "@/lib/types";

const PERSIST_INTERVAL_MS = 2000;

export async function POST(req: NextRequest): Promise<Response> {
  const body = await readJson<GenerateRequest>(req);

  if (body.mode !== "full") {
    return new Response(
      JSON.stringify({ ok: false, error: "only mode=full supported in this route yet" }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

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

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Snapshot sections from chapter at start of stream
      const sections: Section[] = [...chapter.sections];
      let currentText = "";
      let finishReason = "stop";

      // Persist current progress (sections + in-progress text) to disk
      const persistInProgress = async () => {
        const snapshotSections: Section[] = [
          ...sections,
          ...(currentText ? [{ id: randomUUID(), content: currentText }] : []),
        ];
        try {
          await updateChapter(dataDir, body.storySlug, body.chapterId, {
            sections: snapshotSections,
          });
        } catch {
          // best-effort; don't crash stream on periodic save failure
        }
      };

      const persistTimer = setInterval(() => {
        void persistInProgress();
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
          { maxRetries: 3 }
        );

        type OpenAIChunk = {
          choices: Array<{
            delta?: { content?: string };
            finish_reason?: string | null;
          }>;
        };

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
          tokensOf(response as AsyncIterable<OpenAIChunk>)
        )) {
          if (abort.signal.aborted) break;

          if (ev.type === "token") {
            currentText += ev.text;
            controller.enqueue(sse({ type: "token", text: ev.text }));
          } else if (ev.type === "section-break") {
            if (currentText) {
              sections.push({ id: randomUUID(), content: currentText });
              currentText = "";
              await updateChapter(dataDir, body.storySlug, body.chapterId, { sections });
            }
            controller.enqueue(sse({ type: "section-break" }));
          }
          // ev.type === "done" is handled after the loop
        }

        // Final section (no trailing section-break)
        if (currentText) {
          sections.push({ id: randomUUID(), content: currentText });
          currentText = "";
        }
        await updateChapter(dataDir, body.storySlug, body.chapterId, { sections });

        controller.enqueue(sse({ type: "done", finishReason }));
      } catch (err) {
        const message = err instanceof Error ? err.message : "stream error";
        const kind = err instanceof GrokError ? err.kind : "unknown";

        // Save partial content
        if (currentText) {
          sections.push({ id: randomUUID(), content: currentText });
          try {
            await updateChapter(dataDir, body.storySlug, body.chapterId, { sections });
          } catch {
            // best-effort
          }
        }

        controller.enqueue(sse({ type: "error", message, kind }));
      } finally {
        clearInterval(persistTimer);
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
