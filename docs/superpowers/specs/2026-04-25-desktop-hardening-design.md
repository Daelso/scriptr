---
title: Desktop hardening (Electron) — design
date: 2026-04-25
status: approved
---

# Desktop hardening

Followup to the desktop packaging spec ([2026-04-24-desktop-packaging-design.md](2026-04-24-desktop-packaging-design.md)) and PR #1 (merged at d84b65f). The initial Electron packaging shipped installers, auto-update, default-deny network filter, and renderer lockdown. This spec covers three hardening items that turn current silent-failure modes into useful signals and close one real attack surface.

## Goals

- Bake compile-time security toggles into the packaged Electron binary so they cannot be re-enabled at runtime.
- Replace the "API calls hang forever" failure mode when the embedded Next.js server crashes with a clean fatal dialog and graceful quit.
- Replace the "blank window" failure mode when the renderer crashes with a Reload/Quit prompt.
- Persist crash details to disk so users can attach them to bug reports.

## Non-goals

- Code signing (Apple Dev cert / Windows Authenticode). Explicit non-goal per the desktop packaging spec.
- ASAR integrity checks. Marginal value without code signing — depends on signed-binary tamper detection to be meaningful.
- Atomic config writes (`lib/config.ts#saveConfig`). Pre-existing storage concern unrelated to desktop packaging.
- Auto-restart of the crashed server subprocess. The brief explicitly cuts this — restart logic adds complexity, crashes are rare, a clean error is fine.
- Startup-error dialog when `startNextServer` fails before main has registered an `onExit` listener. Today the app silently fails to launch in that case; fixing it is its own feature, deferred.

## Architecture

### Files modified

- [electron-builder.yml](../../../electron-builder.yml) — add `electronFuses:` block.
- [electron/server.ts](../../../electron/server.ts) — extend `ServerHandle` with an `onExit(listener)` registration so `main.ts` can react to post-ready child exits without reaching into the child handle.
- [electron/main.ts](../../../electron/main.ts) — add `wantedExit` flag, register `serverHandle.onExit` for fatal-server-crash, register `webContents.on("render-process-gone")` for renderer crash. Both crash paths funnel through a new helper.
- [lib/storage/paths.ts](../../../lib/storage/paths.ts) — add `crashesLog(dataDir)` returning `<dataDir>/logs/crashes.log`.
- [.github/workflows/release.yml](../../../.github/workflows/release.yml) — add a post-build step running `npx @electron/fuses read --app <binary>` on each OS for visual smoke-verification.

### Files added

- `electron/crash-log.ts` — appends formatted crash entries to `crashesLog(dataDir)`. Exports `formatCrashEntry` (pure, testable) and `logCrash` (write-side wrapper).
- `tests/electron/crash-log.test.ts` — pure-function unit tests.
- `tests/electron/fuses.test.ts` — parses `electron-builder.yml`, asserts each fuse key is set to its expected value. Locks down config drift.

No new runtime dependencies. `@electron/fuses` is invoked transitively by electron-builder during packaging and via `npx` in CI verification — no `package.json` add needed.

## Electron fuses

Use electron-builder's declarative `electronFuses` block in `electron-builder.yml`. electron-builder calls `@electron/fuses` under the hood — every fuse we need is exposed by the declarative path, so no custom afterPack hook.

```yaml
# Bake compile-time security toggles into the packaged Electron binary.
# Each fuse rewrites a sentinel byte in the binary; once flipped, the
# behavior cannot be re-enabled at runtime by argv or env. See
# https://www.electronjs.org/docs/latest/tutorial/fuses
electronFuses:
  # MUST stay true. electron/server.ts spawns process.execPath with
  # ELECTRON_RUN_AS_NODE=1 to run Next's standalone server.js. Flipping
  # this fuse off would break that spawn — packaged app would fail to boot.
  runAsNode: true

  # Refuse to load JavaScript from outside the asar archive. Strong
  # tamper guard: an attacker who replaces a .js file inside resources/
  # cannot have it loaded. Pairs naturally with our existing
  # contextIsolation + sandbox + nodeIntegration:false posture.
  onlyLoadAppFromAsar: true

  # Block --inspect / --inspect-brk / --remote-debugging-port from
  # attaching a debugger to the main process. Without this, an attacker
  # with code-execution on the user's machine could attach to a running
  # scriptr.exe and exfiltrate the in-memory xAI key.
  enableNodeCliInspectArguments: false

  # Same hardening for NODE_OPTIONS — would otherwise let an attacker
  # set NODE_OPTIONS=--inspect=... in the user's environment to bypass
  # the CLI fuse above.
  enableNodeOptionsEnvironmentVariable: false

  # Encrypt cookies at rest using OS-level keys (Keychain / DPAPI /
  # libsecret). scriptr doesn't deliberately set cookies, but Next.js
  # may; defense in depth.
  enableCookieEncryption: true

  # Default true. Set explicitly so future electron-builder upgrades
  # don't silently flip it.
  loadBrowserProcessSpecificV8Snapshot: true
```

**Out of scope (intentionally not set):**

- `enableEmbeddedAsarIntegrityValidation` — requires code signing (non-goal). Default off; we leave it off intentionally.
- `grantFileProtocolExtraPrivileges` — unrelated to threat model. The network filter already blocks `file://` for renderer-initiated requests.

### CI verification

Post-build step in `.github/workflows/release.yml`, per OS:

```yaml
- name: Verify fuses
  shell: bash
  run: |
    case "${{ matrix.os }}" in
      ubuntu-latest)  bin="release/linux-unpacked/scriptr" ;;
      windows-latest) bin="release/win-unpacked/scriptr.exe" ;;
      macos-latest)   bin="release/mac/scriptr.app/Contents/MacOS/scriptr" ;;
    esac
    npx --yes @electron/fuses read --app "$bin"
```

Output is logged to the job. We don't `grep` the log for specific values — the unit test in `tests/electron/fuses.test.ts` covers expected values, and a human reviewer reads the CI output before merging.

## Server subprocess crash handling

### `electron/server.ts` — expose exit hook

Extend `ServerHandle`:

```ts
export type ServerExitInfo = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderrTail: string; // last 4096 bytes — already buffered at server.ts:46-50
};

export type ServerHandle = {
  url: string;
  port: number;
  close: () => Promise<void>;
  onExit: (listener: (info: ServerExitInfo) => void) => void;
};
```

Inside `startNextServer`, wire `child.on("exit")` to fan out to a single registered listener. Coordinate with the existing `waitForReady` early-exit listener (server.ts:158) so the post-ready exit doesn't race with the startup-failure path — the `child.off("exit", onEarlyExit)` at server.ts:171 already detaches the readiness listener after `waitForReady` resolves, so a post-ready listener registered by `main.ts` is the only one bound when `child.exit` fires.

### `electron/main.ts` — coordinate with will-quit

```ts
let wantedExit = false;

app.on("will-quit", async (e) => {
  wantedExit = true;            // set BEFORE awaiting close
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

// after startNextServer completes:
serverHandle.onExit((info) => {
  if (wantedExit) return;       // clean shutdown — ignore
  void handleFatalServerCrash(dataDir, info);
});
```

`handleFatalServerCrash`:

1. `await logCrash(dataDir, { kind: "server", ...info })` — append to `<dataDir>/logs/crashes.log`.
2. `await dialog.showErrorBox("scriptr", "scriptr's local server stopped unexpectedly. Please quit and reopen the app. Crash details have been written to <crashes.log path>.")` — modal, blocks until dismissed.
3. `app.quit()`.

We use `showErrorBox` (single OK button) rather than `showMessageBox` because there's nothing actionable: the server is dead, the only path forward is restart.

## Renderer crash handling

After `mainWindow` is created and other listeners are wired in `electron/main.ts`:

```ts
mainWindow.webContents.on("render-process-gone", (_event, details) => {
  // details.reason: "crashed" | "killed" | "oom" | "launch-failed"
  //                 | "integrity-failure" (and a couple others)
  // details.exitCode: number
  void handleRendererCrash(mainWindow!, dataDir, details);
});
```

`handleRendererCrash`:

1. `await logCrash(dataDir, { kind: "renderer", reason: details.reason, exitCode: details.exitCode })`.
2. `await dialog.showMessageBox(window, { type: "error", message: "scriptr's window crashed.", detail: "Reason: <details.reason>. Crash details written to <path>.", buttons: ["Reload", "Quit"], defaultId: 0, cancelId: 1 })` — returns `{ response: number }` where `0 = Reload`, `1 = Quit`.
3. If `response === 0`: `window.webContents.reload()`. If `response === 1`: `app.quit()`.

The dialog is window-modal (passed `mainWindow` as parent) so it doesn't trap the user under another app.

### Reload-loop guard

If reload triggers another crash, the same handler fires again. Guard against an infinite loop with an in-memory counter: if 3 crashes happen within 60 seconds, the next dialog only offers "Quit" (no Reload) and the message becomes "scriptr's window keeps crashing. Please quit and check `<crashes.log path>`." One extra branch, no new state machinery.

`details.reason` is the only signal we have. We log it for debugging but can't auto-recover from any of them — `oom` would just crash again on reload, `integrity-failure` means the asar was tampered with. The Reload button is honest about being a "try again."

## Crash log helper

### `lib/storage/paths.ts`

```ts
export function crashesLog(dataDir: string): string {
  return join(dataDir, "logs", "crashes.log");
}
```

Sits alongside `blockedRequestsLog` — same `<dataDir>/logs/` convention.

### `electron/crash-log.ts`

```ts
export type CrashEntry =
  | { kind: "server"; code: number | null; signal: NodeJS.Signals | null; stderrTail: string }
  | { kind: "renderer"; reason: string; exitCode: number };

// Pure, testable: format an entry to a single line. Multi-line stderr is
// flattened with `↵` so each crash is one grep-able line.
export function formatCrashEntry(at: Date, entry: CrashEntry): string;

// Write-side wrapper. Mirrors the network-filter logBlocked pattern
// (mkdir -p the parent, append). Swallows errors — logging a crash must
// never crash the app.
export async function logCrash(dataDir: string, entry: CrashEntry): Promise<void>;
```

### Format

Tab-separated, ISO timestamp first — same shape as `blocked-requests.log` so users only learn one log format:

```
2026-04-25T14:32:08.412Z	server	code=null	signal=SIGSEGV	stderr=Segmentation fault↵...
2026-04-25T14:35:11.001Z	renderer	reason=oom	exitCode=-1
```

### Growth

Append-only, no rotation. A user who crashes daily for a year accumulates ~365 lines × ~500 bytes ≈ 180KB. Acceptable. A separate cleanup job is easy to add if it ever becomes a problem.

### Privacy

The file lives in the user's data directory and never leaves the machine. The egress test (`tests/privacy/no-external-egress.test.ts`) doesn't need extending since this isn't an HTTP route. The `scriptr/no-telemetry` ESLint rule already blocks Electron's `crashReporter` (comment at `electron/main.ts:1-5`); this work doesn't go near it.

## Testing

### Unit tests (Vitest, Linux CI)

- **`tests/electron/fuses.test.ts`** — parse `electron-builder.yml`, assert `electronFuses` block exists with each expected key/value. Lock down config drift: a future contributor who deletes `enableNodeCliInspectArguments: false` fails CI before the unsigned package ships. Use the `yaml` package (already a transitive dep via Next) — falls back to `js-yaml` (transitive via electron-builder) if `yaml` isn't resolvable from the test.
- **`tests/electron/crash-log.test.ts`** — pure-function tests on `formatCrashEntry`:
  - Server crash with code + signal + multi-line stderr → tab-separated, newlines flattened.
  - Renderer crash with reason + exitCode → tab-separated.
  - Timestamp uses ISO format (caller passes a `Date` so the test is deterministic).
- **`tests/lib/storage/paths.test.ts`** — extend with one assertion that `crashesLog("/tmp/x")` returns `/tmp/x/logs/crashes.log`.
- **`tests/electron/server.test.ts`** — extend with a test that `startNextServer`'s exit listener fires the registered `onExit` listener with `{ code, signal, stderrTail }`. Use a real `spawn` of a tiny inline Node script that exits immediately. Edge case: `onExit` registered before exit fires once; registered after exit does not retroactively fire (we accept this — main.ts always registers synchronously after `await startNextServer`).

### Not unit-testable

Verified by running the packaged app:

- `app.on("will-quit")` ↔ `wantedExit` ↔ `serverHandle.onExit` interaction.
- `mainWindow.webContents.on("render-process-gone")` wiring + dialog buttons.
- Fuses actually landing in the binary — covered by the CI `npx @electron/fuses read` step.

The user triggers Windows builds via Actions → `release.yml` `workflow_dispatch` and verifies install + crash behavior manually before merging.

## Risks & open items

- **`yaml` vs `js-yaml` resolution in tests.** Both are transitive deps; pick whichever resolves cleanly during implementation. If neither does, add `yaml` as a test-time devDep — small cost.
- **Renderer crash dialog fires during quit.** If the renderer dies during `app.quit()`, the dialog could appear after the user already chose to quit. The `wantedExit` flag is server-only today; consider extending it to gate the renderer handler too. Decide during implementation based on what `render-process-gone` does on quit in practice.
- **Server crash during onboarding.** First-launch onboarding has no API key configured and no real work in progress, but the dialog still fires. Acceptable — the message is generic enough to apply.

## Deferred

- Startup-error dialog (server crash before main registered onExit).
- ASAR integrity validation (needs code signing).
- Auto-restart of crashed server subprocess.
- Crash log rotation.
