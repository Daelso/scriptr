import { describe, it, expect, vi } from "vitest";
import type OpenAI from "openai";
import { callGrokWithRetry, GrokError } from "@/lib/grok-retry";

function statusErr(status: number, message: string): Error & { status: number } {
  const e = new Error(message) as Error & { status: number };
  e.status = status;
  return e;
}

function mockClient(behavior: ("ok" | "429" | "500" | "auth" | "refuse")[]) {
  let i = 0;
  return {
    chat: {
      completions: {
        create: vi.fn().mockImplementation(async () => {
          const step = behavior[i++];
          if (step === "ok")
            return (async function* () {
              yield { choices: [{ delta: { content: "hi" } }] };
            })();
          if (step === "429") throw statusErr(429, "rate");
          if (step === "500") throw statusErr(500, "boom");
          if (step === "auth") throw statusErr(401, "bad key");
          if (step === "refuse")
            return (async function* () {
              yield {
                choices: [{ delta: { content: "I can't help with that." } }],
                "x-refusal": true,
              };
            })();
        }),
      },
    },
  };
}

describe("callGrokWithRetry", () => {
  it("returns stream on first success", async () => {
    const client = mockClient(["ok"]);
    const stream = await callGrokWithRetry(client as unknown as OpenAI, { model: "m", messages: [] }, { maxRetries: 3 });
    expect(stream).toBeDefined();
    expect(client.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 up to maxRetries before first token", async () => {
    const client = mockClient(["429", "429", "ok"]);
    await callGrokWithRetry(client as unknown as OpenAI, { model: "m", messages: [] }, { maxRetries: 3, baseDelayMs: 1 });
    expect(client.chat.completions.create).toHaveBeenCalledTimes(3);
  });

  it("retries on 5xx before first token", async () => {
    const client = mockClient(["500", "ok"]);
    await callGrokWithRetry(client as unknown as OpenAI, { model: "m", messages: [] }, { maxRetries: 3, baseDelayMs: 1 });
    expect(client.chat.completions.create).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry on 401 (auth) — surfaces immediately", async () => {
    const client = mockClient(["auth"]);
    await expect(
      callGrokWithRetry(client as unknown as OpenAI, { model: "m", messages: [] }, { maxRetries: 3, baseDelayMs: 1 })
    ).rejects.toMatchObject({ kind: "auth" } satisfies Partial<GrokError>);
    expect(client.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it("surfaces after exhausting retries", async () => {
    const client = mockClient(["429", "429", "429", "429"]);
    await expect(
      callGrokWithRetry(client as unknown as OpenAI, { model: "m", messages: [] }, { maxRetries: 3, baseDelayMs: 1 })
    ).rejects.toMatchObject({ kind: "rate-limit" });
    expect(client.chat.completions.create).toHaveBeenCalledTimes(4); // 1 + 3 retries
  });
});
