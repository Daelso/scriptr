// PRIVACY: Do NOT import `crashReporter` from "electron" (or call
// `crashReporter.start()`). Electron's crash reporter is off by default and
// must stay that way. The no-telemetry ESLint rule cannot enforce this
// because `crashReporter` is a named export of "electron" rather than its
// own package — see Task 1.7's note.
import { app, BrowserWindow, Menu, dialog, shell, session } from "electron";
import type { RenderProcessGoneDetails } from "electron";
import { join } from "node:path";
import { resolveDataDir, StartupCancelledError } from "./migrate";
import { startNextServer, type ServerHandle, type ServerExitInfo } from "./server";
import { installNetworkFilter } from "./network-filter";
import { configureUpdater, isCheckEnabled } from "./update";
import { buildAppMenu } from "./menu";
import { GITHUB_REPO_PATH } from "./repo";
import { loadConfig } from "../lib/config";
import { blockedRequestsLog, crashesLog } from "../lib/storage/paths";
import { logCrash } from "./crash-log";

const isDev = !app.isPackaged;
let serverHandle: ServerHandle | null = null;
let mainWindow: BrowserWindow | null = null;
// Set true once we've decided to quit on purpose. The `serverHandle.onExit`
// listener checks this synchronously to distinguish "user quit → child
// killed cleanly" from "child died on its own". Ordering matters: we set
// this BEFORE calling `serverHandle.close()` so the resulting `exit` event
// (which can fire in the same tick) sees `wantedExit === true`.
let wantedExit = false;

// ─── Single-instance lock ────────────────────────────────────────────────────
// Two concurrent Electron processes against the same userData would race on
// config.json and story files. If we lose the lock, exit immediately and let
// the existing instance focus its window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ─── App lifecycle hooks ─────────────────────────────────────────────────────

app.on("ready", () => {
  void main();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// macOS: re-create the window when the dock icon is clicked after window close
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void main();
});

app.on("will-quit", async (e) => {
  wantedExit = true;
  if (serverHandle) {
    e.preventDefault();
    try {
      await serverHandle.close();
    } finally {
      serverHandle = null;
      app.quit();
    }
  }
});

// Defense-in-depth: deny window-open for ANY web-contents (including any
// child the renderer might spawn). main window's handler is set per-window
// below; this is a global fallback.
app.on("web-contents-created", (_, contents) => {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
});

// ─── Crash handlers ─────────────────────────────────────────────────────────

async function handleFatalServerCrash(
  dataDir: string,
  info: ServerExitInfo,
): Promise<void> {
  await logCrash(dataDir, { kind: "server", ...info });
  // showErrorBox is intentional: the only forward path is "quit and reopen"
  // — there's nothing to choose between, so a single OK button is honest.
  dialog.showErrorBox(
    "scriptr",
    `scriptr's local server stopped unexpectedly. Please quit and reopen the app.\n\nCrash details written to:\n${crashesLog(dataDir)}`,
  );
  app.quit();
}

// In-memory crash counter for the reload-loop guard. Resets on relaunch
// (intentional — a user who quits and reopens gets a fresh budget).
const recentRendererCrashes: number[] = [];
const CRASH_WINDOW_MS = 60_000;
const CRASH_LIMIT = 3;

async function handleRendererCrash(
  window: BrowserWindow,
  dataDir: string,
  details: RenderProcessGoneDetails,
): Promise<void> {
  await logCrash(dataDir, {
    kind: "renderer",
    reason: details.reason,
    exitCode: details.exitCode,
  });

  const now = Date.now();
  recentRendererCrashes.push(now);
  while (recentRendererCrashes.length > 0 && now - recentRendererCrashes[0] > CRASH_WINDOW_MS) {
    recentRendererCrashes.shift();
  }
  const loopGuardTripped = recentRendererCrashes.length >= CRASH_LIMIT;

  const buttons = loopGuardTripped ? ["Quit"] : ["Reload", "Quit"];
  const message = loopGuardTripped
    ? "scriptr's window keeps crashing."
    : "scriptr's window crashed.";
  const detail = loopGuardTripped
    ? `Please quit and check ${crashesLog(dataDir)}.`
    : `Reason: ${details.reason}. Crash details written to ${crashesLog(dataDir)}.`;

  const { response } = await dialog.showMessageBox(window, {
    type: "error",
    message,
    detail,
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
  });

  if (loopGuardTripped || response === buttons.indexOf("Quit")) {
    app.quit();
    return;
  }
  // response === 0 → Reload
  window.webContents.reload();
}

// ─── Main startup sequence ───────────────────────────────────────────────────

async function main(): Promise<void> {
  // 1. Resolve data directory (may prompt + migrate)
  let dataDir: string;
  try {
    dataDir = await resolveDataDir(app, dialog);
  } catch (err) {
    // StartupCancelledError already carries a user-friendly message; other
    // errors are unexpected and we surface them raw for diagnosis.
    if (!(err instanceof StartupCancelledError)) {
      await dialog.showErrorBox("scriptr", (err as Error).message);
    }
    app.quit();
    return;
  }
  process.env.SCRIPTR_DATA_DIR = dataDir;

  // 2. Read config to decide CSP shape + onboarding posture. Both must be
  //    settled BEFORE Next boots — Next reads SCRIPTR_UPDATES_CHECK at startup
  //    to bake the connect-src directive.
  //    During first-run onboarding (no API key) we force updates off so the
  //    very first launch makes zero network calls until the user has
  //    configured the app — even at the CSP layer.
  const cfg = await loadConfig(dataDir);
  const needsOnboarding = !cfg.apiKey;
  const updatesEnabled = !needsOnboarding && (await isCheckEnabled(dataDir));
  if (updatesEnabled) process.env.SCRIPTR_UPDATES_CHECK = "1";

  // 3. Boot the Next.js server (Next standalone bundle) on an ephemeral port.
  //    In dev the standalone bundle lives at <cwd>/.next/standalone after
  //    `npm run build`. In packaged builds, electron-builder's extraResources
  //    copies .next/standalone to <resources>/app, so app IS the standalone dir.
  const standaloneDir = isDev
    ? join(process.cwd(), ".next", "standalone")
    : join(process.resourcesPath, "app");
  serverHandle = await startNextServer(standaloneDir);
  serverHandle.onExit((info) => {
    if (wantedExit) return;
    void handleFatalServerCrash(dataDir, info);
  });

  // 4. Install the main-process network filter
  installNetworkFilter(session.defaultSession, {
    loopbackPort: serverHandle.port,
    updatesEnabled,
    logPath: blockedRequestsLog(dataDir),
  });

  // 4b. Deny every browser permission request (camera, microphone,
  //     geolocation, notifications, midi, clipboard-read, etc.). scriptr is
  //     a writing app — it has no legitimate use for any of these, and
  //     they're all ways an XSS payload could exfiltrate or fingerprint.
  //     WebRTC also doesn't go through onBeforeRequest; this is the only
  //     place to deny it cleanly.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, callback) => {
    callback(false);
  });

  // 5. Create the window — application menu set once for all platforms
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "scriptr",
    backgroundColor: "#ffffff",
    show: false, // wait for ready-to-show to avoid blank flash
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      devTools: isDev,
      // Default-true. When enabled, Chromium fetches hunspell dictionaries
      // from redirector.gvt1.com (Google CDN) on first text-input focus.
      // The network filter blocks the requests, but they still spam
      // blocked-requests.log with Google URLs and contradict the
      // privacy panel's "Allowed destinations" claim. We rely on OS-level
      // spellcheck if the user wants it.
      spellcheck: false,
    },
  });
  Menu.setApplicationMenu(buildAppMenu(dataDir, isDev));

  // External-link handler: allowlist-guarded shell.openExternal.
  // Tighter than just `endsWith(".x.ai")` — match exact host or an explicit
  // subdomain set, and require GitHub URLs to be under the scriptr repo.
  const xAiHosts = new Set(["x.ai", "console.x.ai", "api.x.ai"]);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      const isXai = parsed.protocol === "https:" && xAiHosts.has(parsed.hostname);
      // Path boundary check: `/Daelso/scriptr` must match the full path or
      // be followed by `/`. Otherwise `/Daelso/scriptr-evil` would match
      // because string.startsWith doesn't respect path segments.
      const isScriptrRepo =
        parsed.protocol === "https:" &&
        parsed.hostname === "github.com" &&
        (parsed.pathname === GITHUB_REPO_PATH ||
          parsed.pathname.startsWith(GITHUB_REPO_PATH + "/"));
      if (isXai || isScriptrRepo) void shell.openExternal(url);
    } catch {
      // ignore invalid URLs
    }
    return { action: "deny" };
  });

  // Block in-place navigation away from the embedded Next server. Without
  // this, a renderer-side `location.href = "https://github.com/..."` would
  // navigate the main window. The network filter would block the actual
  // fetch, but the user could still be stranded on a blank/error page.
  // We only allow navigation within the loopback origin we booted.
  const loopbackOrigin = serverHandle.url; // http://127.0.0.1:<port>
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(loopbackOrigin + "/") && url !== loopbackOrigin) {
      event.preventDefault();
      // If it looks like an external link, route through the same allowlist
      // as the window-open handler so users still get useful behavior.
      try {
        const parsed = new URL(url);
        const isXai = parsed.protocol === "https:" && xAiHosts.has(parsed.hostname);
        const isScriptrRepo =
          parsed.protocol === "https:" &&
          parsed.hostname === "github.com" &&
          (parsed.pathname === GITHUB_REPO_PATH ||
            parsed.pathname.startsWith(GITHUB_REPO_PATH + "/"));
        if (isXai || isScriptrRepo) void shell.openExternal(url);
      } catch {
        // ignore
      }
    }
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  // Capture into a local so the closure doesn't have to deal with the
  // module-scoped `mainWindow` going null between event registration and fire.
  const win = mainWindow;
  win.webContents.on("render-process-gone", (_event, details) => {
    void handleRendererCrash(win, dataDir, details);
  });

  const landing = needsOnboarding ? "/settings?onboarding=1" : "/";
  await mainWindow.loadURL(serverHandle.url + landing);

  // 6. Updates: gated behind did-finish-load so the check doesn't compete
  //    with first paint. updatesEnabled is already false during onboarding
  //    (set in step 2), so no extra check needed here.
  if (updatesEnabled) {
    const runCheck = configureUpdater({
      dataDir,
      onUpdateReady: (version) => {
        mainWindow?.webContents.executeJavaScript(
          `window.dispatchEvent(new CustomEvent("scriptr:update-ready", { detail: ${JSON.stringify(version)} }))`,
        ).catch(() => { /* swallow — notification UX is best-effort */ });
      },
    });
    mainWindow.webContents.once("did-finish-load", () => {
      void runCheck();
    });
  }
}
