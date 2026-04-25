// PRIVACY: Do NOT import `crashReporter` from "electron" (or call
// `crashReporter.start()`). Electron's crash reporter is off by default and
// must stay that way. The no-telemetry ESLint rule cannot enforce this
// because `crashReporter` is a named export of "electron" rather than its
// own package — see Task 1.7's note.
import { app, BrowserWindow, Menu, dialog, shell, session } from "electron";
import { join } from "node:path";
import { resolveDataDir } from "./migrate";
import { startNextServer, type ServerHandle } from "./server";
import { installNetworkFilter } from "./network-filter";
import { configureUpdater, isCheckEnabled } from "./update";
import { buildAppMenu } from "./menu";
import { GITHUB_REPO_PATH } from "./repo";
import { loadConfig } from "../lib/config";
import { blockedRequestsLog } from "../lib/storage/paths";

const isDev = !app.isPackaged;
let serverHandle: ServerHandle | null = null;
let mainWindow: BrowserWindow | null = null;

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

// ─── Main startup sequence ───────────────────────────────────────────────────

async function main(): Promise<void> {
  // 1. Resolve data directory (may prompt + migrate)
  let dataDir: string;
  try {
    dataDir = await resolveDataDir(app, dialog);
  } catch (err) {
    await dialog.showErrorBox("scriptr", (err as Error).message);
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

  // 4. Install the main-process network filter
  installNetworkFilter(session.defaultSession, {
    loopbackPort: serverHandle.port,
    updatesEnabled,
    logPath: blockedRequestsLog(dataDir),
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

  mainWindow.once("ready-to-show", () => mainWindow?.show());

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
