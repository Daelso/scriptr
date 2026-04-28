import { loadConfig, saveConfig } from "../lib/config";
import type { UpdateState } from "../lib/update-state";
export type { UpdateState };

// The narrow shape the controller actually uses from electron-updater's
// AppUpdater singleton. Defined here so tests can supply a plain
// EventEmitter without dragging in the real package.
export type AutoUpdaterLike = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(
    event: "update-available" | "update-not-available" | "update-downloaded" | "error",
    listener: (info?: unknown) => void,
  ): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(): void;
};

export type UpdateControllerDeps = {
  dataDir: string;
  autoUpdater: AutoUpdaterLike;
  getCurrentVersion: () => string;
  broadcast: (state: UpdateState) => void;
};

export type UpdateController = {
  checkNow(): Promise<UpdateState>;
  // Thin alias for the launch-time check — same code path as checkNow,
  // separate name for call-site clarity (matches the spec's "Settings page
  // mount" diagram).
  checkOnLaunch(): Promise<UpdateState>;
  installNow(): Promise<UpdateState>;
  getState(): UpdateState;
};

export function createUpdateController(deps: UpdateControllerDeps): UpdateController {
  const { dataDir, autoUpdater, getCurrentVersion, broadcast } = deps;

  autoUpdater.autoDownload = true;
  // Install on next quit if the user just closes the app normally.
  autoUpdater.autoInstallOnAppQuit = true;

  let state: UpdateState = {
    kind: "idle",
    lastCheckedAt: null,
    currentVersion: getCurrentVersion(),
  };
  let lastCheckedAt: string | null = null;

  function setState(next: UpdateState): void {
    state = next;
    broadcast(state);
  }

  // Helper: settle the in-flight check by transitioning to a terminal state
  // and resolving the awaiting checkNow() promise. We capture the resolver
  // when checkNow starts, then settle it from the autoUpdater event handlers.
  let resolveInFlight: ((s: UpdateState) => void) | null = null;
  function settle(next: UpdateState): void {
    setState(next);
    if (resolveInFlight) {
      const r = resolveInFlight;
      resolveInFlight = null;
      r(next);
    }
  }

  async function stampLastCheckedAt(): Promise<void> {
    const now = new Date().toISOString();
    lastCheckedAt = now;
    // Merge — never overwrite the whole `updates` sub-object (preserves
    // future fields and the existing checkOnLaunch boolean).
    const current = await loadConfig(dataDir);
    await saveConfig(dataDir, {
      updates: {
        ...(current.updates ?? { checkOnLaunch: true }),
        lastCheckedAt: now,
      },
    });
  }

  autoUpdater.on("update-available", (info) => {
    if (state.kind !== "checking") return;
    const version = readVersion(info);
    setState({ kind: "downloading", version });
  });

  autoUpdater.on("update-not-available", () => {
    if (state.kind !== "checking") return;
    // Await persistence before settling so the in-flight checkNow() promise
    // resolves only once `config.json` reflects the new lastCheckedAt. A
    // persistence failure must not crash the app; on error we still settle
    // to idle (the in-memory state already reflects success).
    void (async () => {
      try {
        await stampLastCheckedAt();
      } catch {
        /* ignore */
      }
      settle({
        kind: "idle",
        lastCheckedAt,
        currentVersion: getCurrentVersion(),
      });
    })();
  });

  autoUpdater.on("update-downloaded", (info) => {
    // Two valid entry points: from "downloading" (normal flow) or from
    // "checking" (a previously-downloaded update is already on disk and
    // electron-updater fires the event without going through "available").
    if (state.kind !== "downloading" && state.kind !== "checking") return;
    const version = readVersion(info);
    void (async () => {
      try {
        await stampLastCheckedAt();
      } catch {
        /* ignore */
      }
      settle({ kind: "downloaded", version });
    })();
  });

  autoUpdater.on("error", (err) => {
    // Only react if a check was in-flight or a download was running. After
    // we've already settled to error/downloaded/idle, late errors are noise.
    if (state.kind !== "checking" && state.kind !== "downloading") return;
    const message = err instanceof Error ? err.message : "update failed";
    console.error("[updater] check failed:", message);
    settle({ kind: "error", message });
  });

  async function checkNow(): Promise<UpdateState> {
    // Re-entry guard: if a check is already in flight, OR we're in
    // downloaded (nothing to gain), return current state without
    // broadcasting and without firing a second checkForUpdates.
    // Note: the returned promise resolves to the *current* state — it does
    // NOT wait for the in-flight check (when there is one) to settle. The
    // caller observes the in-flight outcome via the broadcast channel.
    if (state.kind === "checking" || state.kind === "downloading" || state.kind === "downloaded") {
      return state;
    }
    setState({ kind: "checking" });
    const promise = new Promise<UpdateState>((resolve) => {
      resolveInFlight = resolve;
    });
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      // The promise rejected before any event fired. Synthesise an error
      // transition so the renderer gets feedback. We use getState() rather
      // than `state` directly because TS's narrowing from the early-return
      // guard above is stale here — event handlers may have mutated `state`
      // while we awaited checkForUpdates, and the freshly-typed return of
      // getState() reflects that the value can still be "checking".
      if (getState().kind === "checking") {
        const message = err instanceof Error ? err.message : "update check failed";
        settle({ kind: "error", message });
      }
    }
    return promise;
  }

  async function installNow(): Promise<UpdateState> {
    if (state.kind !== "downloaded") {
      console.warn("[updater] installNow ignored — state is", state.kind);
      return state;
    }
    autoUpdater.quitAndInstall();
    return state;
  }

  function getState(): UpdateState {
    return state;
  }

  return { checkNow, checkOnLaunch: checkNow, installNow, getState };
}

function readVersion(info: unknown): string {
  if (info && typeof info === "object" && "version" in info) {
    const v = (info as { version: unknown }).version;
    if (typeof v === "string") return v;
  }
  return "unknown";
}
