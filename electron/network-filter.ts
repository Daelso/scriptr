import type { Session } from "electron";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type FilterOptions = {
  loopbackPort: number;
};

// Loopback hostnames that all resolve to the local machine. We bind the
// embedded Next server to 127.0.0.1, but renderer code or third-party deps
// may construct URLs using `localhost` or `::1`; allowing all three keeps
// the filter loopback-only without surprising failures.
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

// Internal Electron / Chromium schemes the renderer legitimately needs.
// We explicitly allowlist these instead of blanket-allowing every non-http
// scheme — that would let `wss:`, `file:`, `data:`, `blob:`, `ftp:` bypass
// the network policy.
const ALLOWED_INTERNAL_SCHEMES = new Set([
  "devtools:",
  "chrome:",
  "chrome-extension:",
]);

// GitHub destinations electron-updater touches when checking + downloading
// updates. Allowed unconditionally under Electron — the manual "Check for
// updates" button must reach GitHub regardless of the launch toggle, and
// `electron-updater` runs in the main process via Node's https (not the
// renderer's fetch), so this allowance is main-process only. The launch
// toggle still gates *whether* we automatically initiate a check; this
// allowance just means GitHub is reachable when we do.
const UPDATE_HOSTS = new Set([
  "api.github.com", // release metadata JSON
  "github.com", // release YAML feed + redirect target
  "objects.githubusercontent.com", // CDN where artifacts actually download from
]);

export function shouldAllow(url: URL, opts: FilterOptions): boolean {
  // Default-deny model: every branch below is an explicit allow.

  if (ALLOWED_INTERNAL_SCHEMES.has(url.protocol)) return true;

  // Loopback to the embedded Next server (http only)
  if (
    url.protocol === "http:" &&
    LOOPBACK_HOSTS.has(url.hostname) &&
    Number(url.port) === opts.loopbackPort
  ) {
    return true;
  }

  // xAI API — only over https
  if (url.protocol === "https:" && url.hostname === "api.x.ai") return true;

  // GitHub update flow — only over https
  if (url.protocol === "https:" && UPDATE_HOSTS.has(url.hostname)) {
    return true;
  }

  return false;
}

export type InstallOptions = FilterOptions & {
  logPath: string; // path to blocked-requests.log
};

export function installNetworkFilter(sess: Session, opts: InstallOptions): void {
  sess.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
    let parsed: URL;
    try {
      parsed = new URL(details.url);
    } catch {
      return callback({ cancel: true });
    }
    if (shouldAllow(parsed, opts)) return callback({ cancel: false });
    void logBlocked(opts.logPath, details.url).catch(() => {
      // swallow — logging a blocked request must never crash the app
    });
    callback({ cancel: true });
  });
}

async function logBlocked(logPath: string, url: string): Promise<void> {
  await mkdir(dirname(logPath), { recursive: true });
  await appendFile(logPath, `${new Date().toISOString()}\t${url}\n`, "utf-8");
}
