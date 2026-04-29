// Append-only log of update-flow activity, written to data/logs/updates.log.
// Wired into electron-updater as `autoUpdater.logger` AND used by the
// update controller to record every state transition. Without this, an
// update download that fails leaves no trace beyond a transient UI string,
// and the user has no way to diagnose or share the failure.
//
// Privacy: we write only metadata about the update flow — version
// strings, host names, status codes, error messages, and event names.
// No request bodies, headers, or tokens. The path stays inside
// data/logs/ alongside blocked-requests.log and crashes.log.

import { appendFile, mkdir, readFile, stat, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { updatesLog } from "../lib/storage/paths";

// Cap a single log file at ~256 KB. On overflow we rotate to .1 (single
// generation) — enough history to debug a stuck update without growing
// unbounded. Keep the active file small so a user can hand-paste it into
// a bug report.
const ROTATE_BYTES = 256 * 1024;

export interface UpdateLogger {
  info(message?: unknown): void;
  warn(message?: unknown): void;
  error(message?: unknown): void;
  debug(message: string): void;
  // Filename for the user to open. Stable for the lifetime of the
  // process (controller passes it through to the renderer if needed).
  readonly path: string;
  // Resolves once every queued write has settled. Production code
  // doesn't await this — fire-and-forget logging is fine — but tests
  // and a future "drain on quit" hook can use it to observe completion.
  flush(): Promise<void>;
}

export function createUpdateLogger(dataDir: string): UpdateLogger {
  const path = updatesLog(dataDir);
  let chain: Promise<void> = Promise.resolve();

  function enqueue(line: string): void {
    chain = chain.then(() => write(path, line)).catch(() => {
      // Logging must never crash the app; swallow disk errors.
    });
  }

  function format(level: string, message: unknown): string {
    const ts = new Date().toISOString();
    const text = stringify(message);
    return `${ts}\t${level}\t${text}\n`;
  }

  return {
    info: (m) => enqueue(format("INFO", m)),
    warn: (m) => enqueue(format("WARN", m)),
    error: (m) => enqueue(format("ERROR", m)),
    debug: (m) => enqueue(format("DEBUG", m)),
    path,
    flush: () => chain,
  };
}

function stringify(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (value instanceof Error) {
    // Error.message + .stack covers the common case. electron-updater
    // wraps HTTP errors as Error subclasses with a `.code` field; pull
    // that through too so the user sees ERR_UPDATER_INVALID_RELEASE_FEED
    // / ERR_INTERNET_DISCONNECTED / etc.
    const code = (value as { code?: unknown }).code;
    const codeSuffix = typeof code === "string" ? ` [${code}]` : "";
    return `${value.message}${codeSuffix}\n${value.stack ?? ""}`.trim();
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function write(path: string, line: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  // Rotate before append if we'd push past the cap. Stat is cheap and
  // misses (file doesn't exist) just create it on first append.
  try {
    const s = await stat(path);
    if (s.size + line.length > ROTATE_BYTES) {
      // Replace the previous .1 (no second-generation history needed).
      const rotated = `${path}.1`;
      try { await unlink(rotated); } catch { /* not present */ }
      await rename(path, rotated);
    }
  } catch {
    // ENOENT etc. — first write
  }
  await appendFile(path, line, "utf-8");
}

// Read the current log + the rotated .1 (if present) so the caller can
// surface tail-N to a UI or copy the whole thing. Returns "" when no log
// has been written yet. Currently unused by main.ts but exposed because
// the IPC "open the log file" path also needs to handle "doesn't exist
// yet" without surfacing an error.
export async function readUpdateLog(dataDir: string): Promise<string> {
  const path = updatesLog(dataDir);
  try {
    return await readFile(path, "utf-8");
  } catch {
    return "";
  }
}
