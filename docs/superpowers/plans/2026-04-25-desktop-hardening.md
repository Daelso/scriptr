# Desktop hardening Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Electron fuses, fatal-server-crash dialog, renderer-crash dialog, and a shared `<dataDir>/logs/crashes.log` to the packaged scriptr Electron app.

**Architecture:** Bottom-up. Build the pure path/format helpers first, then the testable `ServerHandle.onExit` registration, then wire the crash handlers into `main.ts`, finally bake the fuses into `electron-builder.yml` with a CI smoke-verify step. Each chunk produces working code that compiles, lints, and tests green on its own.

**Tech Stack:** Electron 33, electron-builder 25 (declarative `electronFuses`), Vitest, TypeScript, GitHub Actions.

**Spec:** [docs/superpowers/specs/2026-04-25-desktop-hardening-design.md](../specs/2026-04-25-desktop-hardening-design.md)

---

## File structure

| File | Action | Responsibility |
|------|--------|---------------|
| `lib/storage/paths.ts` | modify | Add `crashesLog(dataDir)` returning `<dataDir>/logs/crashes.log` |
| `tests/lib/storage/paths.test.ts` | modify | Assert `crashesLog` path |
| `electron/crash-log.ts` | create | `formatCrashEntry` (pure) + `logCrash` (write wrapper) |
| `tests/electron/crash-log.test.ts` | create | Pure-function unit tests for `formatCrashEntry` |
| `electron/server.ts` | modify | Extend `ServerHandle` with `onExit(listener)` registration |
| `tests/electron/server.test.ts` | modify | Test that `onExit` fires with `{ code, signal, stderrTail }` |
| `electron/main.ts` | modify | Wire `wantedExit` flag, `serverHandle.onExit`, `render-process-gone`, reload-loop guard |
| `electron-builder.yml` | modify | Add `electronFuses:` block |
| `tests/electron/fuses.test.ts` | create | Parse YAML, assert each fuse key is set to expected value |
| `.github/workflows/release.yml` | modify | Add per-OS `npx @electron/fuses read` smoke-verify step |

---

## Chunk 1: Crash-log foundation (pure helpers)

Bottom-up. The path helper and format helper are pure — they unblock every later test that needs to write or assert log entries. No I/O coupling, no Electron coupling.

### Task 1: Add `crashesLog` path helper

**Files:**
- Modify: `lib/storage/paths.ts`
- Test: `tests/lib/storage/paths.test.ts`

- [ ] **Step 1: Add the failing test**

Append inside the existing `describe("storage paths", ...)` block in `tests/lib/storage/paths.test.ts`:

```ts
it("builds the crashes log path under <dataDir>/logs/", () => {
  expect(crashesLog(dataDir)).toBe("/tmp/fakedata/logs/crashes.log");
});
```

Add `crashesLog` to the import list at the top of the file (alongside `blockedRequestsLog`).

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/lib/storage/paths.test.ts
```

Expected: FAIL with "crashesLog is not exported" or similar import error.

- [ ] **Step 3: Add the helper**

Append to `lib/storage/paths.ts` immediately after `blockedRequestsLog`:

```ts
export function crashesLog(dataDir: string) {
  return join(logsDir(dataDir), "crashes.log");
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/lib/storage/paths.test.ts
```

Expected: PASS, all tests in the file green.

- [ ] **Step 5: Commit**

```bash
git add lib/storage/paths.ts tests/lib/storage/paths.test.ts
git commit -m "feat(paths): add crashesLog helper"
```

---

### Task 2: Create `electron/crash-log.ts` with `formatCrashEntry`

Pure single-line formatter. Tab-separated, ISO timestamp, multi-line stderr flattened with `↵`. Truncates `stderrTail` to 512 bytes for the log line (the dialog never includes stderr in copy, only points at the file path).

**Files:**
- Create: `electron/crash-log.ts`
- Create: `tests/electron/crash-log.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/electron/crash-log.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatCrashEntry } from "@/electron/crash-log";

describe("crash-log — formatCrashEntry", () => {
  const at = new Date("2026-04-25T14:32:08.412Z");

  it("formats a server crash to a single tab-separated line", () => {
    const line = formatCrashEntry(at, {
      kind: "server",
      code: null,
      signal: "SIGSEGV",
      stderrTail: "Segmentation fault\nstack trace line 1",
    });
    expect(line).toBe(
      "2026-04-25T14:32:08.412Z\tserver\tcode=null\tsignal=SIGSEGV\tstderr=Segmentation fault↵stack trace line 1\n",
    );
  });

  it("formats a renderer crash without stderr", () => {
    const line = formatCrashEntry(at, {
      kind: "renderer",
      reason: "oom",
      exitCode: -1,
    });
    expect(line).toBe(
      "2026-04-25T14:32:08.412Z\trenderer\treason=oom\texitCode=-1\n",
    );
  });

  it("renders code=<num> and signal=null when present", () => {
    const line = formatCrashEntry(at, {
      kind: "server",
      code: 137,
      signal: null,
      stderrTail: "",
    });
    expect(line).toBe(
      "2026-04-25T14:32:08.412Z\tserver\tcode=137\tsignal=null\tstderr=\n",
    );
  });

  it("truncates stderr longer than 512 bytes", () => {
    const big = "x".repeat(2000);
    const line = formatCrashEntry(at, {
      kind: "server",
      code: null,
      signal: null,
      stderrTail: big,
    });
    // 512 chars + truncation marker
    expect(line).toContain("stderr=" + "x".repeat(512) + "…(truncated)");
  });

  it("flattens CRLF and LF in stderr", () => {
    const line = formatCrashEntry(at, {
      kind: "server",
      code: null,
      signal: null,
      stderrTail: "line1\r\nline2\nline3",
    });
    expect(line).toContain("stderr=line1↵line2↵line3");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/electron/crash-log.test.ts
```

Expected: FAIL with "Cannot find module '@/electron/crash-log'".

- [ ] **Step 3: Implement `formatCrashEntry`**

Create `electron/crash-log.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/electron/crash-log.test.ts
```

Expected: PASS, 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add electron/crash-log.ts tests/electron/crash-log.test.ts
git commit -m "feat(electron): add crash-log entry formatter"
```

---

### Task 3: Add `logCrash` write-side wrapper

Mirrors the `logBlocked` pattern in `electron/network-filter.ts:83-86`: `mkdir -p` the parent, `appendFile`, swallow errors. **Logging a crash must never crash the app.**

**Files:**
- Modify: `electron/crash-log.ts`

- [ ] **Step 1: Append `logCrash` implementation**

Add to the bottom of `electron/crash-log.ts`:

```ts
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { crashesLog } from "@/lib/storage/paths";

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
```

The `appendFile` and `mkdir` imports go at the top of the file alongside the existing imports.

- [ ] **Step 2: Verify lint and typecheck**

```bash
npm run typecheck && npm run lint
```

Expected: both green. The `scriptr/no-telemetry` rule must not flag this — it's local file I/O, no network.

- [ ] **Step 3: Commit**

```bash
git add electron/crash-log.ts
git commit -m "feat(electron): add logCrash file writer"
```

---

## Chunk 2: ServerHandle.onExit hook

Single registered listener. Re-registering replaces (we don't expect multi-listener callers). Pure-ish: no Electron dep, just `child_process`.

### Task 4: Extend `ServerHandle` with `onExit` registration

**Files:**
- Modify: `electron/server.ts`

- [ ] **Step 1: Update the type and wiring**

In `electron/server.ts`:

1. Add the new types near the top of the file (after the existing `ServerHandle` export):

```ts
export type ServerExitInfo = {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** Last ~4096 bytes of child stderr — useful for crash diagnosis. */
  stderrTail: string;
};

/** A single listener; re-registering replaces. */
export type ServerExitListener = (info: ServerExitInfo) => void;
```

2. Update `ServerHandle`:

```ts
export type ServerHandle = {
  url: string;
  port: number;
  close: () => Promise<void>;
  /**
   * Register a listener for post-ready child exits. Single-listener:
   * calling `onExit` a second time replaces the previous listener.
   * Listeners registered AFTER the child has already exited will not
   * fire — main.ts always registers synchronously after `await
   * startNextServer`, so this is intentional.
   */
  onExit: (listener: ServerExitListener) => void;
};
```

3. Inside `startNextServer`, after `waitForReady` resolves and before the `return` statement, install the post-ready exit watcher:

```ts
let exitListener: ServerExitListener | null = null;
let exitedInfo: ServerExitInfo | null = null;
child.once("exit", (code, signal) => {
  exitedInfo = { code, signal, stderrTail: stderrBuf };
  exitListener?.(exitedInfo);
});
```

4. In the returned object, add `onExit`:

```ts
return {
  port,
  url: `http://127.0.0.1:${port}`,
  close: async () => {
    if (child.exitCode !== null) return;
    child.kill("SIGTERM");
    await once(child, "exit");
  },
  onExit: (listener) => {
    exitListener = listener;
  },
};
```

- [ ] **Step 2: Verify typecheck**

```bash
npm run typecheck
```

Expected: green.

- [ ] **Step 3: Verify existing tests still pass**

```bash
npx vitest run tests/electron/server.test.ts
```

Expected: PASS, all existing `buildChildEnv` tests still green.

- [ ] **Step 4: Commit**

```bash
git add electron/server.ts
git commit -m "feat(electron): expose ServerHandle.onExit for crash detection"
```

---

### Task 5: Test that `onExit` fires with `{ code, signal, stderrTail }`

Use a real `spawn` of an inline Node script that prints to stderr and exits.

**Files:**
- Modify: `tests/electron/server.test.ts`

- [ ] **Step 1: Add the failing test**

Append a new `describe` block at the bottom of `tests/electron/server.test.ts`:

```ts
import { startNextServer } from "@/electron/server";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("server — startNextServer onExit", () => {
  // Build a tiny standalone-shaped directory whose `server.js` listens on
  // PORT, then exits ~50ms later with a non-zero code after writing to
  // stderr. This exercises the full onExit code path without needing real Next.
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "scriptr-server-test-"));
    await writeFile(
      join(tmp, "server.js"),
      `
      const http = require("http");
      const port = parseInt(process.env.PORT, 10);
      const srv = http.createServer((_, res) => res.end("ok"));
      srv.listen(port, "127.0.0.1", () => {
        setTimeout(() => {
          process.stderr.write("simulated boom\\n");
          process.exit(7);
        }, 50);
      });
      `,
      "utf-8",
    );
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("fires onExit with code, signal, and stderrTail after the child dies", async () => {
    const handle = await startNextServer(tmp);
    const info = await new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
      stderrTail: string;
    }>((resolve) => {
      handle.onExit(resolve);
    });
    expect(info.code).toBe(7);
    expect(info.signal).toBeNull();
    expect(info.stderrTail).toContain("simulated boom");
  }, 10_000);

  it("re-registering onExit replaces the previous listener", async () => {
    const handle = await startNextServer(tmp);
    let firstCalled = false;
    handle.onExit(() => {
      firstCalled = true;
    });
    const second = new Promise<void>((resolve) => {
      handle.onExit(() => resolve());
    });
    await second;
    expect(firstCalled).toBe(false);
  }, 10_000);
});
```

Add `beforeEach`, `afterEach` to the existing import from `vitest` at the top of the file.

- [ ] **Step 2: Run the new tests**

```bash
npx vitest run tests/electron/server.test.ts
```

Expected: PASS, including the two new tests.

If they fail because the test runner is Electron rather than Node (only an issue locally — CI uses Node), check that `ELECTRON_RUN_AS_NODE` is unset: `env -u ELECTRON_RUN_AS_NODE npx vitest run tests/electron/server.test.ts`.

- [ ] **Step 3: Commit**

```bash
git add tests/electron/server.test.ts
git commit -m "test(electron): cover ServerHandle.onExit fan-out + replace-on-rebind"
```

---

## Chunk 3: Main process crash wiring

Glue. Mostly imperative wiring in `main.ts` plus two small helpers (`handleFatalServerCrash`, `handleRendererCrash`). Per the spec, this layer is verified by running the packaged app — there is no harness for `BrowserWindow`/`webContents` event simulation.

### Task 6: Wire `wantedExit` + `serverHandle.onExit` for fatal-server-crash

**Files:**
- Modify: `electron/main.ts`

- [ ] **Step 1: Add the `wantedExit` flag and update `will-quit`**

In `electron/main.ts`, add the flag below the existing `serverHandle` declaration:

```ts
// Set true once we've decided to quit on purpose. The `serverHandle.onExit`
// listener checks this synchronously to distinguish "user quit → child
// killed cleanly" from "child died on its own". Ordering matters: we set
// this BEFORE calling `serverHandle.close()` so the resulting `exit` event
// (which can fire in the same tick) sees `wantedExit === true`.
let wantedExit = false;
```

Update the `app.on("will-quit")` handler (currently lines 52-62) to set the flag BEFORE awaiting close:

```ts
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
```

- [ ] **Step 2: Add the `handleFatalServerCrash` helper**

Add the new imports at the top of `electron/main.ts`. **Merge the `crashesLog` import into the existing line 15** (`import { blockedRequestsLog } from "../lib/storage/paths";` → `import { blockedRequestsLog, crashesLog } from "../lib/storage/paths";`). The other two imports are new lines:

```ts
import { logCrash } from "./crash-log";
import type { ServerExitInfo } from "./server";
```

Then add at module scope (above `main()`):

```ts
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
```

- [ ] **Step 3: Register `serverHandle.onExit` after the server starts**

In `main()`, immediately after the line `serverHandle = await startNextServer(standaloneDir);`, add:

```ts
serverHandle.onExit((info) => {
  if (wantedExit) return;
  void handleFatalServerCrash(dataDir, info);
});
```

- [ ] **Step 4: Verify typecheck and lint**

```bash
npm run typecheck && npm run lint
```

Expected: green.

- [ ] **Step 5: Verify the build still produces a valid main process**

```bash
npm run build:electron
```

Expected: green. `dist/electron/main.js` updated.

- [ ] **Step 6: Commit**

```bash
git add electron/main.ts
git commit -m "feat(electron): show fatal dialog when Next subprocess dies unexpectedly"
```

---

### Task 7: Wire `render-process-gone` handler for renderer crash

**Files:**
- Modify: `electron/main.ts`

- [ ] **Step 1: Add the `handleRendererCrash` helper**

Add at module scope in `electron/main.ts` (next to `handleFatalServerCrash`):

Add the type import at the top of the file (separate line — `RenderProcessGoneDetails` is the type of `details` for the `render-process-gone` event in Electron 33):

```ts
import type { RenderProcessGoneDetails } from "electron";
```

If that named export isn't resolvable from your installed `electron` typings, replace the import with an inline equivalent:

```ts
type RenderProcessGoneDetails = { reason: string; exitCode: number };
```

Then at module scope:

```ts
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
```

- [ ] **Step 2: Register the handler on the main window**

In `main()`, after `mainWindow.once("ready-to-show", ...)` and before `await mainWindow.loadURL(...)`, add:

```ts
// Capture into a local so the closure doesn't have to deal with the
// module-scoped `mainWindow` going null between event registration and fire.
const win = mainWindow;
win.webContents.on("render-process-gone", (_event, details) => {
  void handleRendererCrash(win, dataDir, details);
});
```

- [ ] **Step 3: Verify typecheck and lint**

```bash
npm run typecheck && npm run lint
```

Expected: green.

- [ ] **Step 4: Verify build**

```bash
npm run build:electron
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts
git commit -m "feat(electron): handle renderer crashes with Reload/Quit dialog and reload-loop guard"
```

---

## Chunk 4: Fuses + CI verification

Declarative, no runtime code. Two artifacts: the YAML block and the CI step. Locked down by a unit test that parses the YAML and asserts each fuse value.

### Task 8: Add `electronFuses` block to `electron-builder.yml`

**Files:**
- Modify: `electron-builder.yml`

- [ ] **Step 1: Append the fuses block**

Add the following block to `electron-builder.yml` (location: after `forceCodeSigning: false`, before the `mac:` section):

```yaml
# Compile-time security toggles baked into the packaged Electron binary.
# Each fuse rewrites a sentinel byte at package time; once flipped, the
# behavior cannot be re-enabled at runtime by argv or env.
# https://www.electronjs.org/docs/latest/tutorial/fuses
electronFuses:
  # MUST stay true. electron/server.ts spawns process.execPath with
  # ELECTRON_RUN_AS_NODE=1 to run Next's standalone server.js. Flipping
  # this off would break that spawn — packaged app would fail to boot.
  runAsNode: true

  # Refuse to load JavaScript from outside the asar archive. Tamper guard.
  onlyLoadAppFromAsar: true

  # Block --inspect / --remote-debugging-port from attaching a debugger to
  # the main process. Without this, an attacker with code-execution on the
  # user's machine could attach to a running scriptr.exe and exfiltrate the
  # in-memory xAI key.
  enableNodeCliInspectArguments: false

  # Same hardening for NODE_OPTIONS.
  enableNodeOptionsEnvironmentVariable: false

  # Encrypt cookies at rest using OS-level keys (Keychain / DPAPI /
  # libsecret). scriptr doesn't deliberately set cookies; defense in depth.
  enableCookieEncryption: true

  # Default true. Set explicitly so future electron-builder upgrades
  # don't silently flip it.
  loadBrowserProcessSpecificV8Snapshot: true
```

- [ ] **Step 2: Verify YAML is valid**

```bash
node -e "console.log(require('js-yaml').load(require('fs').readFileSync('electron-builder.yml','utf-8')).electronFuses)"
```

Expected output: an object with all six keys printed.

- [ ] **Step 3: Commit**

```bash
git add electron-builder.yml
git commit -m "feat(packaging): bake security fuses into Electron binary"
```

---

### Task 9: Add lock-down test for the fuses block

**Files:**
- Create: `tests/electron/fuses.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/electron/fuses.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";

describe("electron-builder.yml — electronFuses", () => {
  // Parse from the repo root. process.cwd() during vitest is the repo root,
  // matching how every other test reads project files.
  const config = load(
    readFileSync(join(process.cwd(), "electron-builder.yml"), "utf-8"),
  ) as { electronFuses?: Record<string, boolean> };

  it("declares an electronFuses block", () => {
    expect(config.electronFuses).toBeDefined();
  });

  it.each([
    ["runAsNode", true],
    ["onlyLoadAppFromAsar", true],
    ["enableNodeCliInspectArguments", false],
    ["enableNodeOptionsEnvironmentVariable", false],
    ["enableCookieEncryption", true],
    ["loadBrowserProcessSpecificV8Snapshot", true],
  ] as const)("sets %s to %s", (key, value) => {
    expect(config.electronFuses?.[key]).toBe(value);
  });
});
```

- [ ] **Step 2: Run the test**

```bash
npx vitest run tests/electron/fuses.test.ts
```

Expected: PASS, 7 assertions green.

- [ ] **Step 3: Commit**

```bash
git add tests/electron/fuses.test.ts
git commit -m "test(packaging): lock electronFuses values against config drift"
```

---

### Task 10: Add per-OS fuse smoke-verify to the release workflow

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Insert the verify step**

In `.github/workflows/release.yml`, inside the `build:` job, **after** the two `Package with electron-builder` steps and **before** the `Upload installers as workflow artifact` step, insert:

```yaml
      # Visual smoke-verify that the fuses landed in the packaged binary.
      # Output goes to the job log; a human reviews on each release.
      # Authoritative value lock-in is in tests/electron/fuses.test.ts.
      - name: Verify Electron fuses
        shell: bash
        run: |
          # macOS has both x64 and arm64 outputs (electron-builder.yml
          # configures arch: [x64, arm64]) — produces release/mac/scriptr.app
          # and release/mac-arm64/scriptr.app. We discover and read each
          # *.app under release/ so neither arch silently skips verification.
          case "${{ matrix.os }}" in
            ubuntu-latest)
              bins=("release/linux-unpacked/scriptr")
              ;;
            windows-latest)
              bins=("release/win-unpacked/scriptr.exe")
              ;;
            macos-latest)
              mapfile -t apps < <(find release -maxdepth 3 -type d -name "scriptr.app" 2>/dev/null)
              if [[ ${#apps[@]} -eq 0 ]]; then
                echo "::error ::No scriptr.app found under release/"
                ls -la release/ || true
                exit 1
              fi
              bins=()
              for app in "${apps[@]}"; do
                bins+=("$app/Contents/MacOS/scriptr")
              done
              ;;
          esac
          for bin in "${bins[@]}"; do
            if [[ ! -e "$bin" ]]; then
              echo "::error ::Expected packaged binary not found at $bin"
              ls -la "$(dirname "$bin")" || true
              exit 1
            fi
            echo "--- Fuses for $bin ---"
            npx --yes @electron/fuses read --app "$bin"
          done
```

- [ ] **Step 2: Validate workflow syntax locally**

```bash
node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/release.yml','utf-8'))"
```

Expected: no output (clean parse). A YAML syntax error would throw.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): smoke-verify electron fuses on each packaged binary"
```

---

## Final verification

- [ ] **Step 1: Full test suite**

```bash
npm run typecheck && npm run lint && npm test
```

Expected: all green. New tests added: `crashesLog` path, `formatCrashEntry` (5 cases), `ServerHandle.onExit` (2 cases), `electronFuses` block (7 cases).

- [ ] **Step 2: Privacy egress test still green**

```bash
npx vitest run tests/privacy/no-external-egress.test.ts
```

Expected: PASS. No new API routes were added, so no extension was needed; this is a sanity check that nothing accidentally changed.

- [ ] **Step 3: Build the main process bundle**

```bash
npm run build:electron
```

Expected: green; `dist/electron/main.js` and `dist/electron/crash-log.js` updated.

- [ ] **Step 4: Open the PR**

```bash
git push -u origin <branch-name>
gh pr create --title "Desktop hardening: Electron fuses + crash handling" --body "..."
```

The user triggers the Windows build via Actions → release.yml workflow_dispatch → platforms: windows, then verifies install + the three crash modes manually before merging:

1. Open Settings, kill the embedded Node subprocess via Task Manager → fatal dialog appears, app quits.
2. Force-crash the renderer via DevTools → Reload/Quit dialog appears.
3. Trigger 3 renderer crashes within 60s → loop-guard dialog (Quit-only) appears.
4. Pull a fuses report from the packaged binary: `npx @electron/fuses read --app release/win-unpacked/scriptr.exe` → all six values match the YAML.

---

## Notes for the implementer

- **Subagent cwd discipline:** if you're dispatching subagents from a worktree, every prompt must include the absolute worktree path and every `git add`/test command in the prompt must use it. See `AGENTS.md`.
- **WSL gotcha:** the user's shell sets `ELECTRON_RUN_AS_NODE=1`. If you run `electron` or `electron-builder` directly from this shell, prefix with `env -u ELECTRON_RUN_AS_NODE`. Tests (vitest) don't need this — they run under plain Node.
- **Crash-log path in dialogs:** rendered as the absolute path verbatim. Long Windows paths look ugly but copy-paste cleanly into a bug report, which is what matters.
- **Reload-loop counter:** in-memory only, intentionally resets on relaunch. Don't persist it.
- **Don't extend `tests/privacy/no-external-egress.test.ts`:** crash-log writes are local file I/O, not HTTP routes — the egress test only covers HTTP handlers.
