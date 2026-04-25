import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { crashesLog } from "@/lib/storage/paths";

export type CrashEntry =
  | {
      kind: "server";
      code: number | null;
      signal: NodeJS.Signals | null;
      stderrTail: string;
    }
  | { kind: "renderer"; reason: string; exitCode: number };

const STDERR_LIMIT = 512;

/**
 * Format a crash entry as a single tab-separated line, terminated with `\n`.
 * Multi-line stderr is flattened with `↵` so each crash is one grep-able row,
 * matching the shape of `<dataDir>/logs/blocked-requests.log`.
 *
 * Pure: timestamp comes in via `at` so tests are deterministic.
 */
export function formatCrashEntry(at: Date, entry: CrashEntry): string {
  const ts = at.toISOString();
  if (entry.kind === "server") {
    const flattened = entry.stderrTail.replace(/\r\n|\n|\r/g, "↵");
    const truncated =
      flattened.length > STDERR_LIMIT
        ? flattened.slice(0, STDERR_LIMIT) + "…(truncated)"
        : flattened;
    return `${ts}\tserver\tcode=${entry.code}\tsignal=${entry.signal}\tstderr=${truncated}\n`;
  }
  return `${ts}\trenderer\treason=${entry.reason}\texitCode=${entry.exitCode}\n`;
}

/**
 * Append a crash entry to <dataDir>/logs/crashes.log. Best-effort: if the
 * write fails (disk full, permissions, etc.) we swallow — the caller is
 * already in a crash path and we must not throw.
 */
export async function logCrash(dataDir: string, entry: CrashEntry): Promise<void> {
  const path = crashesLog(dataDir);
  const line = formatCrashEntry(new Date(), entry);
  try {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, line, "utf-8");
  } catch {
    // swallow — see jsdoc
  }
}
