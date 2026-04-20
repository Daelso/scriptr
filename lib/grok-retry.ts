import type OpenAI from "openai";

export type GrokErrorKind = "auth" | "rate-limit" | "server" | "refusal" | "network" | "unknown";

export class GrokError extends Error {
  constructor(public kind: GrokErrorKind, message: string, public status?: number) {
    super(message);
  }
}

type CreateParams = Parameters<OpenAI["chat"]["completions"]["create"]>[0];

export type RetryOptions = { maxRetries?: number; baseDelayMs?: number };

const AUTH_STATUS = new Set([401, 403]);

function classify(err: unknown): GrokError {
  const status = (err as { status?: number })?.status;
  const msg = (err as Error)?.message ?? String(err);
  if (status && AUTH_STATUS.has(status)) return new GrokError("auth", msg, status);
  if (status === 429) return new GrokError("rate-limit", msg, status);
  if (status && status >= 500) return new GrokError("server", msg, status);
  if (msg.match(/content policy|refus/i)) return new GrokError("refusal", msg, status);
  if (msg.match(/network|fetch|ECONN|ENOTFOUND/i)) return new GrokError("network", msg, status);
  return new GrokError("unknown", msg, status);
}

export async function callGrokWithRetry(
  client: OpenAI,
  params: CreateParams,
  opts: RetryOptions = {}
) {
  const maxRetries = opts.maxRetries ?? 3;
  const baseDelay = opts.baseDelayMs ?? 500;
  let attempt = 0;
  // Pre-first-token retries only. Once create() resolves with a stream, errors
  // during iteration are surfaced by the caller — not retried here.
  while (true) {
    try {
      return await client.chat.completions.create(params);
    } catch (err) {
      const grokErr = classify(err);
      const retryable = grokErr.kind === "rate-limit" || grokErr.kind === "server" || grokErr.kind === "network";
      if (!retryable || attempt >= maxRetries) throw grokErr;
      const delay = baseDelay * 2 ** attempt + Math.floor(Math.random() * 100);
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
    }
  }
}
