const KEY_REGEX = /xai-[A-Za-z0-9]{16,}/g;
const SENSITIVE_FIELDS = /^(authorization|api[-_ ]?key|x-api-key|cookie)$/i;

function redact(value: unknown): unknown {
  if (typeof value === "string") return value.replace(KEY_REGEX, "[REDACTED-KEY]");
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = Array.isArray(value) ? ([] as unknown as Record<string, unknown>) : {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_FIELDS.test(k) ? "[REDACTED]" : redact(v);
    }
    return out;
  }
  return value;
}

function stringify(parts: unknown[]): string {
  return parts
    .map((p) => (typeof p === "string" ? redact(p) : JSON.stringify(redact(p))))
    .join(" ");
}

export function makeLogger() {
  return {
    info: (...args: unknown[]) => console.log("[info]", stringify(args)),
    warn: (...args: unknown[]) => console.warn("[warn]", stringify(args)),
    error: (...args: unknown[]) => console.error("[error]", stringify(args)),
  };
}

export const logger = makeLogger();
