import type OpenAI from "openai";
import { buildRecapPrompt } from "@/lib/prompts";
import { callGrokWithRetry } from "@/lib/grok-retry";
import type { RetryOptions } from "@/lib/grok-retry";
import type { Story, Chapter } from "@/lib/types";

type ChatCompletionShape = {
  choices?: Array<{ message?: { content?: string } }>;
};

export async function generateRecap(
  client: OpenAI,
  model: string,
  story: Story,
  chapter: Chapter,
  retryOpts?: RetryOptions
): Promise<string> {
  const prompt = buildRecapPrompt({ story, chapter });
  // Non-streaming call. Use the retry wrapper so pre-first-token rate limits retry.
  const response = await callGrokWithRetry(
    client,
    {
      model,
      stream: false,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
    },
    retryOpts
  );
  // Narrow to the standard ChatCompletion shape (non-stream response).
  const shaped = response as unknown as ChatCompletionShape;
  const text = shaped.choices?.[0]?.message?.content ?? "";
  return text.trim();
}
