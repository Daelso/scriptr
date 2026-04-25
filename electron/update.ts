import { autoUpdater } from "electron-updater";
import { loadConfig, saveConfig } from "../lib/config";

export type UpdateDeps = {
  dataDir: string;
  onUpdateReady: (version: string) => void;
};

export async function isCheckEnabled(dataDir: string): Promise<boolean> {
  const cfg = await loadConfig(dataDir);
  return cfg.updates?.checkOnLaunch !== false;
}

/**
 * Wire up electron-updater. The returned `runCheck()` function performs one
 * check + records `lastCheckedAt`. main.ts calls this once after the window
 * finishes loading.
 */
export function configureUpdater({ dataDir, onUpdateReady }: UpdateDeps): () => Promise<void> {
  autoUpdater.autoDownload = true;
  // Install on next quit — no IPC bridge needed. The user closes the app
  // normally and the new version is in place on next launch. See spec
  // "Auto-update → Mechanism".
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-downloaded", (info) => {
    onUpdateReady(info.version);
  });

  autoUpdater.on("error", (err) => {
    // Swallow — a failed update check must never crash the app.
    console.error("[updater] check failed:", err.message);
  });

  return async function runCheck() {
    try {
      await autoUpdater.checkForUpdates();
    } finally {
      // Read current config and merge — never overwrite the whole `updates`
      // sub-object, since future fields would be silently dropped.
      const current = await loadConfig(dataDir);
      await saveConfig(dataDir, {
        updates: {
          ...(current.updates ?? { checkOnLaunch: true }),
          lastCheckedAt: new Date().toISOString(),
        },
      });
    }
  };
}
