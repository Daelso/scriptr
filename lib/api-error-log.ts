import { mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import { logger } from "@/lib/logger";
import { apiErrorsLog, logsDir } from "@/lib/storage/paths";

/**
 * Best-effort persistent log of API failures.
 *
 * Why a file: the Electron host (electron/server.ts) only captures the
 * spawned Next process's stderr in a 4KB rolling buffer, surfaced solely
 * when the child crashes. Normal request-handler errors disappear into the
 * void on Windows, so users (and we) can't diagnose anything from a
 * "Build failed (500)" toast. This writes a NDJSON line per error to
 * `<data>/logs/api-errors.log` so failures leave a paper trail that can be
 * shared in bug reports.
 *
 * Each line is a single JSON object with millisecond ISO timestamp, route,
 * error name, message, stack, and optional context. Append-only; no rotation
 * — the volume is low (one entry per failed export) and a stale log is
 * easier to reason about than a rotated one.
 *
 * Failures inside this helper itself are swallowed: a logging-system bug
 * must NEVER mask the underlying error the caller is trying to record.
 */
export async function logApiError(
  dataDir: string,
  route: string,
  err: unknown,
  context?: Record<string, unknown>,
): Promise<void> {
  try {
    const e = err instanceof Error ? err : new Error(String(err));
    const entry = {
      ts: new Date().toISOString(),
      route,
      error: { name: e.name, message: e.message, stack: e.stack },
      ...(context ? { context } : {}),
    };
    const path = apiErrorsLog(dataDir);
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, JSON.stringify(entry) + "\n", "utf-8");
  } catch (writeErr) {
    // Don't mask the real error. Log to stderr only.
    logger.warn(
      "logApiError: failed to persist",
      writeErr instanceof Error ? writeErr.message : String(writeErr),
    );
  }
}

/** Internal: exposed so the path-only callers can mention the file in
 *  user-visible messages. */
export function apiErrorsLogPath(dataDir: string): string {
  return apiErrorsLog(dataDir);
}

/** Internal: also exposed for callers that want to mention the parent dir. */
export function apiErrorsLogDir(dataDir: string): string {
  return logsDir(dataDir);
}
