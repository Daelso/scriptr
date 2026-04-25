import type { Session } from "electron";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type FilterOptions = {
  loopbackPort: number;
  updatesEnabled: boolean;
};

export function shouldAllow(url: URL, opts: FilterOptions): boolean {
  // Internal Electron schemes are always allowed
  if (url.protocol !== "http:" && url.protocol !== "https:") return true;

  // Loopback to the embedded Next server
  if (
    url.protocol === "http:" &&
    url.hostname === "127.0.0.1" &&
    Number(url.port) === opts.loopbackPort
  ) {
    return true;
  }

  // xAI API — only over https
  if (url.protocol === "https:" && url.hostname === "api.x.ai") return true;

  // GitHub releases — only when updates enabled, only over https
  if (
    opts.updatesEnabled &&
    url.protocol === "https:" &&
    url.hostname === "api.github.com"
  ) {
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
