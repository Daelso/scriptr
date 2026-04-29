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
    event:
      | "update-available"
      | "update-not-available"
      | "update-downloaded"
      | "download-progress"
      | "error",
    listener: (info?: unknown) => void,
  ): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(): void;
};

// Subset of electron-updater's Logger interface we actually call.
// Production wires this to the file-backed logger in update-log.ts;
// tests can pass a stub or omit it entirely.
export type ControllerLogger = {
  info(message?: unknown): void;
  warn(message?: unknown): void;
  error(message?: unknown): void;
};

export type UpdateControllerDeps = {
  dataDir: string;
  autoUpdater: AutoUpdaterLike;
  getCurrentVersion: () => string;
  broadcast: (state: UpdateState) => void;
  logger?: ControllerLogger;
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
  const log: ControllerLogger = deps.logger ?? noopLogger;

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
    log.info(`event: update-available ${describeInfo(info)}`);
    if (state.kind !== "checking") {
      log.warn(`ignored update-available — state is ${state.kind}`);
      return;
    }
    const version = readVersion(info);
    setState({ kind: "downloading", version });
  });

  autoUpdater.on("update-not-available", (info) => {
    log.info(`event: update-not-available ${describeInfo(info)}`);
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

  // electron-updater fires download-progress every ~250ms during a
  // download. We only log the first event (so the log shows "download
  // started, target=X bytes") and then every 25% milestone, to keep the
  // log readable without losing the signal that a download was making
  // progress before it failed.
  let lastProgressBucket = -1;
  autoUpdater.on("download-progress", (raw) => {
    const p = raw as { percent?: number; total?: number; transferred?: number } | undefined;
    if (!p) return;
    const pct = typeof p.percent === "number" ? Math.floor(p.percent) : 0;
    const bucket = Math.floor(pct / 25);
    if (lastProgressBucket === -1 && typeof p.total === "number") {
      log.info(`event: download-progress started (target=${p.total} bytes)`);
    }
    if (bucket > lastProgressBucket) {
      log.info(
        `event: download-progress ${pct}% ` +
          `(${p.transferred ?? "?"}/${p.total ?? "?"} bytes)`,
      );
      lastProgressBucket = bucket;
    }
  });

  autoUpdater.on("update-downloaded", (info) => {
    log.info(`event: update-downloaded ${describeInfo(info)}`);
    lastProgressBucket = -1;
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
    // Always log — even errors that arrive after we've already settled
    // are useful diagnostic context. Only the state transition is gated.
    log.error(err);
    if (state.kind !== "checking" && state.kind !== "downloading") return;
    const message = formatErrorMessage(err, state.kind);
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
      log.info(`checkNow ignored — state is ${state.kind}`);
      return state;
    }
    log.info(`checkNow starting (currentVersion=${getCurrentVersion()})`);
    setState({ kind: "checking" });
    lastProgressBucket = -1;
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
      log.error(err);
      if (getState().kind === "checking") {
        const message = formatErrorMessage(err, "checking");
        settle({ kind: "error", message });
      }
    }
    return promise;
  }

  async function installNow(): Promise<UpdateState> {
    if (state.kind !== "downloaded") {
      log.warn(`installNow ignored — state is ${state.kind}`);
      return state;
    }
    log.info(`installNow — relaunching to install ${state.version}`);
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

// Compose the user-facing error string. Includes the error code (e.g.
// `ERR_UPDATER_NO_PUBLISHED_VERSIONS`, `ENOTFOUND`) when present so the
// user has a self-diagnosable handle, plus a phase prefix so they can
// tell "couldn't reach GitHub" from "download stalled mid-stream". The
// renderer further sanitizes home-directory paths before display.
function formatErrorMessage(err: unknown, phase: "checking" | "downloading"): string {
  const phaseLabel = phase === "downloading" ? "while downloading" : "while checking for updates";
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    const codeSuffix = typeof code === "string" && code.length > 0 ? ` [${code}]` : "";
    return `${err.message}${codeSuffix} (${phaseLabel})`;
  }
  if (typeof err === "string") return `${err} (${phaseLabel})`;
  return `Unknown error ${phaseLabel}`;
}

function describeInfo(info: unknown): string {
  if (!info || typeof info !== "object") return "";
  const v = (info as { version?: unknown }).version;
  return typeof v === "string" ? `(version=${v})` : "";
}

const noopLogger: ControllerLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};
