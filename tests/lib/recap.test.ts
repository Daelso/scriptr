import { describe, it, expect, vi } from "vitest";
import type OpenAI from "openai";
import { GrokError } from "@/lib/grok-retry";

vi.mock("@/lib/grok-retry", async () => {
  const actual = await vi.importActual<typeof import("@/lib/grok-retry")>("@/lib/grok-retry");
  return { ...actual, callGrokWithRetry: vi.fn() };
});

import { callGrokWithRetry } from "@/lib/grok-retry";
import { generateRecap } from "@/lib/recap";
import type { Story, Chapter } from "@/lib/types";

const fakeClient = {} as OpenAI;

const story: Story = {
  slug: "test-story",
  title: "Test Story",
  authorPenName: "Author",
  description: "A test story.",
  copyrightYear: 2026,
  language: "en",
  bisacCategory: "FIC000000",
  keywords: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  chapterOrder: [],
};

const chapter: Chapter = {
  id: "ch-1",
  title: "Chapter One",
  summary: "A summary.",
  beats: ["Beat one."],
  prompt: "",
  recap: "",
  sections: [{ id: "sec-1", content: "Alice finds a key." }],
  wordCount: 4,
};

describe("generateRecap", () => {
  it("happy path — returns trimmed content from non-empty response", async () => {
    vi.mocked(callGrokWithRetry).mockResolvedValueOnce({
      choices: [{ message: { content: "Alice finds a key and opens a door." } }],
    } as unknown as Awaited<ReturnType<typeof callGrokWithRetry>>);

    const result = await generateRecap(fakeClient, "model-x", story, chapter);
    expect(result).toBe("Alice finds a key and opens a door.");
  });

  it("empty content — returns empty string", async () => {
    vi.mocked(callGrokWithRetry).mockResolvedValueOnce({
      choices: [{ message: { content: "" } }],
    } as unknown as Awaited<ReturnType<typeof callGrokWithRetry>>);

    const result = await generateRecap(fakeClient, "model-x", story, chapter);
    expect(result).toBe("");
  });

  it("error propagation — throws the classified GrokError", async () => {
    vi.mocked(callGrokWithRetry).mockRejectedValueOnce(
      new GrokError("auth", "bad key", 401)
    );

    await expect(generateRecap(fakeClient, "model-x", story, chapter)).rejects.toMatchObject({
      kind: "auth",
    });
  });

  it("trims leading and trailing whitespace from content", async () => {
    vi.mocked(callGrokWithRetry).mockResolvedValueOnce({
      choices: [{ message: { content: "  padded   \n" } }],
    } as unknown as Awaited<ReturnType<typeof callGrokWithRetry>>);

    const result = await generateRecap(fakeClient, "model-x", story, chapter);
    expect(result).toBe("padded");
  });

  it("malformed / missing choices — returns empty string safely", async () => {
    vi.mocked(callGrokWithRetry).mockResolvedValueOnce(
      {} as unknown as Awaited<ReturnType<typeof callGrokWithRetry>>
    );

    const result = await generateRecap(fakeClient, "model-x", story, chapter);
    expect(result).toBe("");
  });

  it("calls callGrokWithRetry with stream: false and correct messages", async () => {
    vi.mocked(callGrokWithRetry).mockResolvedValueOnce({
      choices: [{ message: { content: "recap text" } }],
    } as unknown as Awaited<ReturnType<typeof callGrokWithRetry>>);

    await generateRecap(fakeClient, "model-y", story, chapter);

    expect(vi.mocked(callGrokWithRetry)).toHaveBeenCalledWith(
      fakeClient,
      expect.objectContaining({
        stream: false,
        model: "model-y",
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "system" }),
          expect.objectContaining({ role: "user" }),
        ]),
      }),
      undefined
    );
  });
});
