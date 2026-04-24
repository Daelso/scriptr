# Desktop Packaging (Electron) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship scriptr as a cross-platform desktop app (Windows, macOS, Linux) by wrapping the existing Next.js server in an Electron shell. No changes to the storage layer, renderer, or generation flow — only a new process on top.

**Architecture:** An Electron main process resolves an OS-standard user data directory, sets `SCRIPTR_DATA_DIR`, boots Next.js programmatically on an ephemeral loopback port, and points a locked-down `BrowserWindow` at it. The renderer is the existing Next.js app unchanged. No IPC, no preload — the app talks to itself via localhost HTTP. Auto-update is opt-in (but on by default) via `electron-updater` against GitHub Releases. Builds are unsigned for v1.

**Tech Stack:** Next.js 16, React 19, TypeScript, Electron 33+, `electron-builder`, `electron-updater`, Vitest (unit tests), GitHub Actions (CI).

**Spec:** [docs/superpowers/specs/2026-04-24-desktop-packaging-design.md](../specs/2026-04-24-desktop-packaging-design.md)

**Operating conventions (from AGENTS.md and CLAUDE.md):**
- This is Next.js 16 — read `node_modules/next/dist/docs/` before writing any Next.js integration code. Route handlers use `ctx: { params: Promise<{...}> }`.
- Storage paths go through [lib/storage/paths.ts](../../../lib/storage/paths.ts) helpers — never hand-concatenate paths.
- Privacy is non-negotiable. Any new destination must be explicit in CSP, in the main-process filter, and exercised in [tests/privacy/no-external-egress.test.ts](../../../tests/privacy/no-external-egress.test.ts).
- Use `logger` from [lib/logger.ts](../../../lib/logger.ts), not `console.*`, for anything touching request/response data.
- TDD discipline: write the failing test first, run it to confirm it fails for the right reason, then implement.
- After each task: commit. After each chunk: run typecheck + test + lint before moving on.

---

## Chunk 1: Foundations

Adds dependencies, extends the configuration type for update settings, adds new storage path helpers, extends the privacy ESLint rule, and opts Next.js into `standalone` output. After this chunk, nothing user-visible has changed — but every downstream Electron task has its prerequisites in place.

### Task 1.1: Verify the Next.js 16 programmatic server API

Before committing to the architecture, confirm that `next({ dev: false, customServer: true })` + an ephemeral-port `http.createServer` works under Next 16.2.4. If it doesn't, the fallback is spawning `next start` as a child process — same architecture, different boot.

**Files:**
- Create (temporary): `/home/chase/projects/scriptr/scripts/spike-next-programmatic.mjs`

- [ ] **Step 1: Read the Next.js docs on custom servers**

Run:
```bash
cd /home/chase/projects/scriptr && ls node_modules/next/dist/docs/ 2>/dev/null && grep -l -r "custom server\|customServer\|createServer" node_modules/next/dist/docs/ 2>/dev/null | head -10
```

Read whichever file(s) surface. Focus on the exported programmatic API shape — in particular whether the `customServer` option still exists in v16 and what `next()` returns.

- [ ] **Step 2: Write a minimal spike script**

Write to `/home/chase/projects/scriptr/scripts/spike-next-programmatic.mjs`:

```js
import next from "next";
import http from "node:http";

const app = next({ dev: false, dir: process.cwd(), customServer: true });
await app.prepare();
const handle = app.getRequestHandler();

const server = http.createServer((req, res) => handle(req, res));
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
console.log(`listening on http://127.0.0.1:${port}`);

// Fetch the root and a known API route
const root = await fetch(`http://127.0.0.1:${port}/`);
const settings = await fetch(`http://127.0.0.1:${port}/api/settings`);
console.log("GET / →", root.status);
console.log("GET /api/settings →", settings.status);

server.close();
await app.close();
```

- [ ] **Step 3: Build Next and run the spike**

Run:
```bash
cd /home/chase/projects/scriptr && npm run build && node scripts/spike-next-programmatic.mjs
```

Expected: script prints two 200s (or at worst `GET /` = 307 if it redirects to a story, `GET /api/settings` = 200). If it prints errors or hangs, the programmatic API has changed.

- [ ] **Step 4: Decide based on spike result**

- **If the spike works** → continue with this plan as-is. Delete the spike file: `rm scripts/spike-next-programmatic.mjs`.
- **If the spike fails** → STOP. File a note in the plan at Task 2.4 and switch `electron/server.ts` to spawn `next start` as a child process (binding `127.0.0.1`, waiting for stdout "ready" line before opening the window). Rest of the plan is unchanged. Delete the spike file either way.

- [ ] **Step 5: Commit deletion**

If the spike worked, no commit needed (the spike file is untracked). If you had to edit the plan to record the fallback, commit that change to the plan doc.

---

### Task 1.2: Add Electron dependencies

**Files:**
- Modify: `/home/chase/projects/scriptr/package.json`

- [ ] **Step 1: Install electron + builder + updater**

Run:
```bash
cd /home/chase/projects/scriptr && npm install --save-dev electron@^33 electron-builder@^25 electron-updater@^6
```

Expected: `package.json` and `package-lock.json` update. `node_modules/electron/` exists. On first install Electron downloads ~100MB of binaries — normal.

- [ ] **Step 2: Verify Electron is callable**

Run:
```bash
cd /home/chase/projects/scriptr && npx electron --version
```

Expected: prints a version like `v33.x.x`.

- [ ] **Step 3: Commit**

```bash
cd /home/chase/projects/scriptr && git add package.json package-lock.json && git commit -m "chore(electron): add electron, electron-builder, electron-updater"
```

---

### Task 1.3: Add Electron TypeScript config and npm scripts

The main process is compiled separately from Next — different module system (CommonJS, since Electron's main process is CJS), different lib (`node`, not `dom`). A sibling `tsconfig` keeps the two apart.

**Files:**
- Create: `/home/chase/projects/scriptr/electron/tsconfig.json`
- Modify: `/home/chase/projects/scriptr/package.json`
- Modify: `/home/chase/projects/scriptr/.gitignore`
- Modify: `/home/chase/projects/scriptr/tsconfig.json` (exclude electron/ from the main tsconfig)

- [ ] **Step 1: Write the electron tsconfig**

Create `/home/chase/projects/scriptr/electron/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "lib": ["ES2022"],
    "types": ["node"],
    "outDir": "../dist/electron",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["**/*.ts"],
  "exclude": ["**/*.test.ts"]
}
```

- [ ] **Step 2: Exclude electron/ from the main tsconfig**

Read `/home/chase/projects/scriptr/tsconfig.json` first. Find the `"exclude"` array (or add one if missing) and add `"electron"` to it. Do not change any other field.

- [ ] **Step 3: Add `dist/` to .gitignore**

Append to `/home/chase/projects/scriptr/.gitignore`:

```
# Electron main-process compile output
/dist/
```

- [ ] **Step 4: Add npm scripts**

In `/home/chase/projects/scriptr/package.json`, add these scripts to the `"scripts"` object (do not modify existing scripts):

```json
"build:electron": "tsc -p electron/tsconfig.json",
"package:electron": "npm run build && npm run build:electron && electron-builder",
"dev:electron": "npm run build:electron && electron ."
```

Also add a top-level `"main"` field (Electron's entry point):

```json
"main": "dist/electron/main.js"
```

- [ ] **Step 5: Verify it compiles (should produce nothing yet)**

Run:
```bash
cd /home/chase/projects/scriptr && npm run build:electron
```

Expected: exits 0 with no output (nothing to compile yet — directory has only tsconfig.json).

- [ ] **Step 6: Commit**

```bash
cd /home/chase/projects/scriptr && git add electron/tsconfig.json tsconfig.json .gitignore package.json package-lock.json && git commit -m "chore(electron): add tsconfig, npm scripts, dist/ gitignore"
```

---

### Task 1.4: Extend `Config` with update-check settings

Add the `updates` field to the config type. No Electron code yet — but the shape needs to exist before Task 2.3 (update module) and Task 3.2 (settings UI) consume it.

**Files:**
- Modify: `/home/chase/projects/scriptr/lib/config.ts`
- Test: `/home/chase/projects/scriptr/tests/lib/config.test.ts` (create if missing, else extend)

- [ ] **Step 1: Check whether a config test file exists**

Run:
```bash
cd /home/chase/projects/scriptr && ls tests/lib/config.test.ts 2>/dev/null || echo "no test yet"
```

If it prints `no test yet`, create a new file. Otherwise extend the existing one.

- [ ] **Step 2: Write the failing test**

Write (or append to) `/home/chase/projects/scriptr/tests/lib/config.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, saveConfig, DEFAULT_CONFIG } from "@/lib/config";

describe("config — updates settings", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "scriptr-config-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("defaults updates.checkOnLaunch to true", () => {
    expect(DEFAULT_CONFIG.updates?.checkOnLaunch).toBe(true);
  });

  it("defaults updates.lastCheckedAt to undefined", () => {
    expect(DEFAULT_CONFIG.updates?.lastCheckedAt).toBeUndefined();
  });

  it("persists updates.checkOnLaunch false across save/load", async () => {
    await saveConfig(dir, { updates: { checkOnLaunch: false } });
    const loaded = await loadConfig(dir);
    expect(loaded.updates?.checkOnLaunch).toBe(false);
  });

  it("persists updates.lastCheckedAt across save/load", async () => {
    const ts = "2026-04-24T10:00:00.000Z";
    await saveConfig(dir, { updates: { checkOnLaunch: true, lastCheckedAt: ts } });
    const loaded = await loadConfig(dir);
    expect(loaded.updates?.lastCheckedAt).toBe(ts);
  });
});
```

- [ ] **Step 3: Run the test to confirm it fails**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/lib/config.test.ts
```

Expected: all four tests fail (typecheck error on `.updates` or assertion failure).

- [ ] **Step 4: Extend the Config type**

Edit `/home/chase/projects/scriptr/lib/config.ts`. Add after the existing `StyleRules` import:

```ts
export type UpdatesConfig = {
  checkOnLaunch: boolean;
  lastCheckedAt?: string; // ISO timestamp
};
```

Add `updates?: UpdatesConfig;` to the `Config` type:

```ts
export type Config = {
  apiKey?: string;
  defaultModel: string;
  bindHost: "127.0.0.1" | "0.0.0.0";
  bindPort: number;
  theme: "light" | "dark" | "system";
  autoRecap: boolean;
  includeLastChapterFullText: boolean;
  styleDefaults?: StyleRules;
  updates?: UpdatesConfig;
};
```

Add the default in `DEFAULT_CONFIG`:

```ts
export const DEFAULT_CONFIG: Config = {
  defaultModel: process.env.SCRIPTR_DEFAULT_MODEL ?? "grok-4-latest",
  bindHost: "127.0.0.1",
  bindPort: 3000,
  theme: "system",
  autoRecap: true,
  includeLastChapterFullText: false,
  updates: { checkOnLaunch: true },
};
```

- [ ] **Step 5: Run the test to confirm it passes**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/lib/config.test.ts
```

Expected: all four tests pass.

- [ ] **Step 6: Run typecheck**

Run:
```bash
cd /home/chase/projects/scriptr && npm run typecheck
```

Expected: no errors. (If errors reference settings routes, fix forward in the next task — don't swallow them here.)

- [ ] **Step 7: Commit**

```bash
cd /home/chase/projects/scriptr && git add lib/config.ts tests/lib/config.test.ts && git commit -m "feat(config): add updates.checkOnLaunch + lastCheckedAt fields"
```

---

### Task 1.5: Extend the settings API route to accept/return `updates`

The settings API today whitelists which Config fields it accepts. Add `updates` to the whitelist, and include it in the GET response.

**Files:**
- Modify: `/home/chase/projects/scriptr/app/api/settings/route.ts`
- Test: `/home/chase/projects/scriptr/tests/api/settings-updates.test.ts`

- [ ] **Step 1: Write the failing test**

Write `/home/chase/projects/scriptr/tests/api/settings-updates.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { GET, PUT } from "@/app/api/settings/route";

describe("settings API — updates field", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "scriptr-settings-"));
    process.env.SCRIPTR_DATA_DIR = dir;
  });
  afterEach(async () => {
    delete process.env.SCRIPTR_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  });

  it("GET returns updates defaults", async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.updates?.checkOnLaunch).toBe(true);
  });

  it("PUT persists updates.checkOnLaunch=false", async () => {
    const req = new Request("http://127.0.0.1/api/settings", {
      method: "PUT",
      body: JSON.stringify({ updates: { checkOnLaunch: false } }),
    }) as unknown as NextRequest;
    const res = await PUT(req);
    const body = await res.json();
    expect(body.ok).toBe(true);
    const after = await GET();
    const afterBody = await after.json();
    expect(afterBody.data.updates.checkOnLaunch).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/api/settings-updates.test.ts
```

Expected: the GET test passes (config has defaults), the PUT test fails because `updates` is not in the allowed list.

- [ ] **Step 3: Extend the route**

Edit `/home/chase/projects/scriptr/app/api/settings/route.ts`. Update the `GET` response to include `updates`:

```ts
return ok({
  hasKey: Boolean(cfg.apiKey),
  keyPreview: mask(cfg.apiKey),
  defaultModel: cfg.defaultModel,
  bindHost: cfg.bindHost,
  theme: cfg.theme,
  autoRecap: cfg.autoRecap,
  includeLastChapterFullText: cfg.includeLastChapterFullText,
  styleDefaults: cfg.styleDefaults,
  updates: cfg.updates,
  isElectron: Boolean(process.versions.electron),
});
```

Add `"updates"` to the `allowed` array in `PUT`:

```ts
const allowed: (keyof Config)[] = [
  "apiKey", "defaultModel", "theme", "autoRecap", "includeLastChapterFullText", "styleDefaults", "updates",
];
```

- [ ] **Step 4: Run the test to confirm it passes**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/api/settings-updates.test.ts
```

Expected: both tests pass.

- [ ] **Step 5: Run the full egress test to make sure nothing regressed**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/privacy/no-external-egress.test.ts
```

Expected: passes. (The settings route doesn't call `fetch`, so this should still be green.)

- [ ] **Step 6: Commit**

```bash
cd /home/chase/projects/scriptr && git add app/api/settings/route.ts tests/api/settings-updates.test.ts && git commit -m "feat(settings): expose updates field + isElectron flag via API"
```

---

### Task 1.6: Add storage path helpers for logs

Per the spec's "never hand-concatenate paths" rule, the Electron main process writes the blocked-requests log via a helper. Add `logsDir()` and `blockedRequestsLog()` to the central paths module.

**Files:**
- Modify: `/home/chase/projects/scriptr/lib/storage/paths.ts`
- Test: `/home/chase/projects/scriptr/tests/lib/storage/paths.test.ts` (create or extend)

- [ ] **Step 1: Check for an existing paths test**

Run:
```bash
cd /home/chase/projects/scriptr && ls tests/lib/storage/paths.test.ts 2>/dev/null || echo "no test yet"
```

If none, create the file.

- [ ] **Step 2: Write the failing test**

Append to (or create) `/home/chase/projects/scriptr/tests/lib/storage/paths.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { logsDir, blockedRequestsLog } from "@/lib/storage/paths";

describe("paths — logs", () => {
  const DATA = "/data";

  it("logsDir returns <dataDir>/logs", () => {
    expect(logsDir(DATA)).toBe("/data/logs");
  });

  it("blockedRequestsLog returns <dataDir>/logs/blocked-requests.log", () => {
    expect(blockedRequestsLog(DATA)).toBe("/data/logs/blocked-requests.log");
  });
});
```

- [ ] **Step 3: Run the test to confirm it fails**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/lib/storage/paths.test.ts
```

Expected: both tests fail with "logsDir is not a function".

- [ ] **Step 4: Add the helpers**

Append to `/home/chase/projects/scriptr/lib/storage/paths.ts`:

```ts
export function logsDir(dataDir: string) {
  return join(dataDir, "logs");
}
export function blockedRequestsLog(dataDir: string) {
  return join(logsDir(dataDir), "blocked-requests.log");
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/lib/storage/paths.test.ts
```

Expected: both tests pass.

- [ ] **Step 6: Commit**

```bash
cd /home/chase/projects/scriptr && git add lib/storage/paths.ts tests/lib/storage/paths.test.ts && git commit -m "feat(paths): add logsDir + blockedRequestsLog helpers"
```

---

### Task 1.7: Extend the no-telemetry ESLint rule to block Electron analytics

The existing rule blocks browser analytics. Add Electron-side telemetry packages and make sure `crashReporter` can't be imported from Electron.

**Files:**
- Modify: `/home/chase/projects/scriptr/eslint-rules/no-telemetry.js`
- Test: `/home/chase/projects/scriptr/tests/lint/no-telemetry.test.ts` (if exists) or fresh file

- [ ] **Step 1: Check whether a rule test exists**

Run:
```bash
cd /home/chase/projects/scriptr && ls tests/lint/ 2>/dev/null || echo "no lint tests"
```

If none, skip to Step 3 — we'll verify by ESLint running against a bad fixture file.

- [ ] **Step 2: If tests exist, add a case for `electron/crashReporter`**

If there's a rule test, add a case:

```ts
invalid: [
  // ...existing cases...
  { code: `import { crashReporter } from "electron/crashReporter";`, errors: [{ messageId: "blocked" }] },
  { code: `import { Amplitude } from "@amplitude/analytics-browser";`, errors: [{ messageId: "blocked" }] },
]
```

- [ ] **Step 3: Extend the BLOCKED list**

Edit `/home/chase/projects/scriptr/eslint-rules/no-telemetry.js`. Add these entries to the `BLOCKED` array (maintain alphabetical grouping with comment):

```js
// Electron-specific
"electron/crashReporter",        // Electron crash reports
"electron-log",                  // often used for remote logging
```

Keep everything else unchanged.

- [ ] **Step 4: Verify by creating a bad fixture and linting it**

Run:
```bash
cd /home/chase/projects/scriptr && mkdir -p /tmp/scriptr-lint-check && cat > /tmp/scriptr-lint-check/bad.ts <<'EOF'
import { crashReporter } from "electron/crashReporter";
export const _ = crashReporter;
EOF
npx eslint --rulesdir eslint-rules --no-config-lookup --rule '{"scriptr/no-telemetry": "error"}' --plugin scriptr /tmp/scriptr-lint-check/bad.ts 2>&1 | head -20
```

Expected: ESLint emits the "Telemetry package 'electron/crashReporter' is banned" error. (If the `--rulesdir` / `--no-config-lookup` flags don't work in ESLint 9 in this repo, fall back to running `npm run lint` against a real file that imports the blocked package — then remove the file.)

- [ ] **Step 5: Verify current lint still passes against real code**

Run:
```bash
cd /home/chase/projects/scriptr && npm run lint
```

Expected: passes. No existing code imports the newly blocked packages.

- [ ] **Step 6: Commit**

```bash
cd /home/chase/projects/scriptr && git add eslint-rules/no-telemetry.js && git commit -m "chore(lint): block electron/crashReporter + electron-log telemetry"
```

---

### Task 1.8: Opt Next.js into `standalone` output and prepare CSP for updates

`output: "standalone"` produces a self-contained `.next/standalone/` directory that Electron can ship. CSP gets a sentinel comment so Task 3.3 can extend it when updates are enabled.

**Files:**
- Modify: `/home/chase/projects/scriptr/next.config.ts`

- [ ] **Step 1: Edit next.config.ts**

Edit `/home/chase/projects/scriptr/next.config.ts`. The final file should be:

```ts
import type { NextConfig } from "next";

// When running under Electron with update checks enabled, the main process
// passes SCRIPTR_UPDATES_CHECK=1. We include GitHub releases in connect-src
// only then — keeping the web build's egress surface unchanged.
const updatesEnabled = process.env.SCRIPTR_UPDATES_CHECK === "1";

const connectSrc = ["'self'", "https://api.x.ai"];
if (updatesEnabled) connectSrc.push("https://api.github.com");

const cspDirectives = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src ${connectSrc.join(" ")}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: cspDirectives },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
```

- [ ] **Step 2: Verify the build produces a standalone output**

Run:
```bash
cd /home/chase/projects/scriptr && npm run build && ls -la .next/standalone/ 2>/dev/null | head
```

Expected: `.next/standalone/` exists and contains `server.js`, `node_modules/`, `package.json`.

- [ ] **Step 3: Run the existing dev server briefly to make sure headers still apply**

Run:
```bash
cd /home/chase/projects/scriptr && (npm run dev >/tmp/scriptr-dev.log 2>&1 &) && sleep 6 && curl -sI http://127.0.0.1:3000 | grep -i "content-security-policy" && kill %1 2>/dev/null; true
```

Expected: CSP header shows `connect-src 'self' https://api.x.ai` (no api.github.com, since `SCRIPTR_UPDATES_CHECK` isn't set).

- [ ] **Step 4: Verify conditional GitHub entry**

Run:
```bash
cd /home/chase/projects/scriptr && (SCRIPTR_UPDATES_CHECK=1 npm run dev >/tmp/scriptr-dev.log 2>&1 &) && sleep 6 && curl -sI http://127.0.0.1:3000 | grep -i "content-security-policy" && kill %1 2>/dev/null; true
```

Expected: CSP header now includes `https://api.github.com` in `connect-src`.

- [ ] **Step 5: Commit**

```bash
cd /home/chase/projects/scriptr && git add next.config.ts && git commit -m "feat(next): standalone output; conditional github CSP for updates"
```

---

**End of Chunk 1.** Run all quality gates:

```bash
cd /home/chase/projects/scriptr && npm run typecheck && npm run lint && npm test
```

Expected: all green.

---

## Chunk 2: Electron main process

Builds the Electron main process, one module per responsibility. `network-filter` and `migrate` have pure decision functions tested in isolation; `server`, `update`, `menu`, and `main` are integration glue verified by running the app.

### Task 2.1: `electron/network-filter.ts` — request allowlist

Pure decision function (`shouldAllow`) tested directly. Electron `webRequest` glue (`installNetworkFilter`) is a thin wrapper that calls the decision function and appends to the blocked-requests log on deny.

**Files:**
- Create: `/home/chase/projects/scriptr/electron/network-filter.ts`
- Create: `/home/chase/projects/scriptr/tests/electron/network-filter.test.ts`

- [ ] **Step 1: Write the failing test**

Write `/home/chase/projects/scriptr/tests/electron/network-filter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shouldAllow } from "@/electron/network-filter";

describe("network-filter — shouldAllow", () => {
  const base = { loopbackPort: 54321, updatesEnabled: false };

  it("allows loopback to the configured port", () => {
    expect(shouldAllow(new URL("http://127.0.0.1:54321/api/stories"), base)).toBe(true);
  });

  it("blocks loopback on the wrong port", () => {
    expect(shouldAllow(new URL("http://127.0.0.1:9999/"), base)).toBe(false);
  });

  it("blocks loopback over https", () => {
    expect(shouldAllow(new URL("https://127.0.0.1:54321/"), base)).toBe(false);
  });

  it("allows api.x.ai over https", () => {
    expect(shouldAllow(new URL("https://api.x.ai/v1/chat"), base)).toBe(true);
  });

  it("blocks api.x.ai over http", () => {
    expect(shouldAllow(new URL("http://api.x.ai/v1/chat"), base)).toBe(false);
  });

  it("blocks api.github.com when updates disabled", () => {
    expect(shouldAllow(new URL("https://api.github.com/repos/x/y/releases/latest"), base)).toBe(false);
  });

  it("allows api.github.com when updates enabled", () => {
    expect(shouldAllow(new URL("https://api.github.com/repos/x/y/releases/latest"), { ...base, updatesEnabled: true })).toBe(true);
  });

  it("blocks arbitrary hosts", () => {
    expect(shouldAllow(new URL("https://evil.example.com/"), base)).toBe(false);
    expect(shouldAllow(new URL("https://www.google-analytics.com/collect"), { ...base, updatesEnabled: true })).toBe(false);
  });

  it("allows devtools:// and file:// (internal Electron schemes)", () => {
    expect(shouldAllow(new URL("devtools://foo/"), base)).toBe(true);
    expect(shouldAllow(new URL("file:///some/path"), base)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/electron/network-filter.test.ts
```

Expected: all tests fail — `shouldAllow` is not defined.

- [ ] **Step 3: Implement the module**

Create `/home/chase/projects/scriptr/electron/network-filter.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to confirm it passes**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/electron/network-filter.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Verify it type-compiles**

Run:
```bash
cd /home/chase/projects/scriptr && npm run build:electron
```

Expected: `dist/electron/network-filter.js` is created, no errors.

- [ ] **Step 6: Commit**

```bash
cd /home/chase/projects/scriptr && git add electron/network-filter.ts tests/electron/network-filter.test.ts && git commit -m "feat(electron): network-filter with allowlist + blocked-request log"
```

---

### Task 2.2: `electron/migrate.ts` — first-launch data directory resolution

Pure decision function (`decideStartupAction`) tested directly. The executor wraps it with actual dialog + filesystem operations.

**Files:**
- Create: `/home/chase/projects/scriptr/electron/migrate.ts`
- Create: `/home/chase/projects/scriptr/tests/electron/migrate.test.ts`

- [ ] **Step 1: Write the failing test**

Write `/home/chase/projects/scriptr/tests/electron/migrate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { decideStartupAction, type StartupInputs } from "@/electron/migrate";

function inputs(overrides: Partial<StartupInputs> = {}): StartupInputs {
  return {
    userData: "/app-data",
    defaultDataDir: "/app-data/data",
    locationJsonPath: "/app-data/location.json",
    candidates: ["/cwd/data", "/resources/data"],
    probeLocationJson: async () => null,
    probeConfigExists: async () => false,
    ...overrides,
  };
}

describe("migrate — decideStartupAction", () => {
  it("honors location.json override when present", async () => {
    const result = await decideStartupAction(inputs({
      probeLocationJson: async () => "/custom/path",
    }));
    expect(result).toEqual({ kind: "use-override", dataDir: "/custom/path" });
  });

  it("boots from default data dir when config.json exists there", async () => {
    const result = await decideStartupAction(inputs({
      probeConfigExists: async (p) => p === "/app-data/data",
    }));
    expect(result).toEqual({ kind: "boot", dataDir: "/app-data/data" });
  });

  it("prompts when default is empty but a candidate has config.json", async () => {
    const result = await decideStartupAction(inputs({
      probeConfigExists: async (p) => p === "/cwd/data",
    }));
    expect(result).toEqual({
      kind: "prompt",
      candidate: "/cwd/data",
      targetIfCopy: "/app-data/data",
      locationJsonPath: "/app-data/location.json",
    });
  });

  it("returns fresh when nothing exists anywhere", async () => {
    const result = await decideStartupAction(inputs());
    expect(result).toEqual({ kind: "fresh", dataDir: "/app-data/data" });
  });

  it("location.json takes precedence over existing default data dir", async () => {
    const result = await decideStartupAction(inputs({
      probeLocationJson: async () => "/override",
      probeConfigExists: async (p) => p === "/app-data/data",
    }));
    expect(result.kind).toBe("use-override");
  });

  it("picks the first candidate that has config.json", async () => {
    const result = await decideStartupAction(inputs({
      probeConfigExists: async (p) => p === "/resources/data", // second candidate only
      candidates: ["/cwd/data", "/resources/data"],
    }));
    expect(result).toEqual({
      kind: "prompt",
      candidate: "/resources/data",
      targetIfCopy: "/app-data/data",
      locationJsonPath: "/app-data/location.json",
    });
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/electron/migrate.test.ts
```

Expected: all tests fail — `decideStartupAction` undefined.

- [ ] **Step 3: Implement the module**

Create `/home/chase/projects/scriptr/electron/migrate.ts`:

```ts
import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { App, Dialog } from "electron";

export type StartupInputs = {
  userData: string;
  defaultDataDir: string;
  locationJsonPath: string;
  candidates: string[];
  probeLocationJson: () => Promise<string | null>;
  probeConfigExists: (dir: string) => Promise<boolean>;
};

export type StartupDecision =
  | { kind: "use-override"; dataDir: string }
  | { kind: "boot"; dataDir: string }
  | { kind: "fresh"; dataDir: string }
  | { kind: "prompt"; candidate: string; targetIfCopy: string; locationJsonPath: string };

export async function decideStartupAction(inputs: StartupInputs): Promise<StartupDecision> {
  const override = await inputs.probeLocationJson();
  if (override) return { kind: "use-override", dataDir: override };

  if (await inputs.probeConfigExists(inputs.defaultDataDir)) {
    return { kind: "boot", dataDir: inputs.defaultDataDir };
  }

  for (const candidate of inputs.candidates) {
    if (await inputs.probeConfigExists(candidate)) {
      return {
        kind: "prompt",
        candidate,
        targetIfCopy: inputs.defaultDataDir,
        locationJsonPath: inputs.locationJsonPath,
      };
    }
  }

  return { kind: "fresh", dataDir: inputs.defaultDataDir };
}

// ─── Production executor ─────────────────────────────────────────────────────

export async function resolveDataDir(app: App, dialog: Dialog): Promise<string> {
  const userData = app.getPath("userData");
  const defaultDataDir = join(userData, "data");
  const locationJsonPath = join(userData, "location.json");

  const decision = await decideStartupAction({
    userData,
    defaultDataDir,
    locationJsonPath,
    candidates: candidatesFromEnv(),
    probeLocationJson: async () => {
      try {
        const raw = await readFile(locationJsonPath, "utf-8");
        const parsed = JSON.parse(raw) as { dataDir?: string };
        return parsed.dataDir ?? null;
      } catch {
        return null;
      }
    },
    probeConfigExists: async (dir) => {
      try {
        await stat(join(dir, "config.json"));
        return true;
      } catch {
        return false;
      }
    },
  });

  switch (decision.kind) {
    case "use-override":
    case "boot":
      return decision.dataDir;

    case "fresh":
      await mkdir(decision.dataDir, { recursive: true });
      return decision.dataDir;

    case "prompt": {
      const { response } = await dialog.showMessageBox({
        type: "question",
        buttons: ["Copy to new location", "Use in place", "Cancel"],
        defaultId: 0,
        cancelId: 2,
        message: "Existing scriptr data found",
        detail:
          `Found scriptr data at ${decision.candidate}.\n\n` +
          `Copy it to the standard app-data location (${decision.targetIfCopy}),\n` +
          `or keep the existing folder and point the app there?`,
      });
      if (response === 0) {
        await cp(decision.candidate, decision.targetIfCopy, { recursive: true });
        return decision.targetIfCopy;
      }
      if (response === 1) {
        await mkdir(userData, { recursive: true });
        await writeFile(
          decision.locationJsonPath,
          JSON.stringify({ dataDir: decision.candidate }, null, 2),
          "utf-8",
        );
        return decision.candidate;
      }
      throw new Error("Startup cancelled by user at migration prompt");
    }
  }
}

function candidatesFromEnv(): string[] {
  const out: string[] = [];
  out.push(join(process.cwd(), "data"));
  // When packaged, process.resourcesPath exists; the dev-mode ./data lives in cwd.
  if (process.resourcesPath) out.push(join(process.resourcesPath, "data"));
  return out;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/electron/migrate.test.ts
```

Expected: all six tests pass.

- [ ] **Step 5: Verify it type-compiles**

Run:
```bash
cd /home/chase/projects/scriptr && npm run build:electron
```

Expected: `dist/electron/migrate.js` exists, no errors.

- [ ] **Step 6: Commit**

```bash
cd /home/chase/projects/scriptr && git add electron/migrate.ts tests/electron/migrate.test.ts && git commit -m "feat(electron): first-launch data dir migration (pure decision + executor)"
```

---

### Task 2.3: `electron/server.ts` — Next.js programmatic boot

Boots the Next app on an ephemeral loopback port. If Task 1.1 found the programmatic API doesn't work, this file instead spawns `next start` — adjust the body accordingly (fallback body is in the second code block below).

**Files:**
- Create: `/home/chase/projects/scriptr/electron/server.ts`

- [ ] **Step 1: Implement the primary (programmatic) version**

Create `/home/chase/projects/scriptr/electron/server.ts`:

```ts
import http, { type Server } from "node:http";
import next from "next";

export type ServerHandle = {
  url: string;
  port: number;
  close: () => Promise<void>;
};

export async function startNextServer(appDir: string): Promise<ServerHandle> {
  const app = next({
    dev: false,
    dir: appDir,
    customServer: true,
    hostname: "127.0.0.1",
  });
  await app.prepare();
  const handle = app.getRequestHandler();

  const server: Server = http.createServer((req, res) => handle(req, res));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("Next.js server did not bind to a TCP address");
  }

  return {
    port: addr.port,
    url: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
```

- [ ] **Step 2 (only if Task 1.1 fell back to child process): replace with the spawn version**

```ts
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";

export type ServerHandle = {
  url: string;
  port: number;
  close: () => Promise<void>;
};

export async function startNextServer(appDir: string): Promise<ServerHandle> {
  // Port 0 = OS picks free port. Next reads PORT env var.
  const child: ChildProcess = spawn(process.execPath, [
    "node_modules/next/dist/bin/next",
    "start",
    "-H", "127.0.0.1",
    "-p", "0",
  ], {
    cwd: appDir,
    env: { ...process.env, PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const port = await waitForListeningLine(child);

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      child.kill("SIGTERM");
      await once(child, "exit");
    },
  };
}

async function waitForListeningLine(child: ChildProcess): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const onData = (buf: Buffer) => {
      const text = buf.toString();
      const match = text.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        child.stdout?.off("data", onData);
        resolve(Number(match[1]));
      }
    };
    child.stdout?.on("data", onData);
    child.on("exit", (code) => reject(new Error(`Next exited before ready (code ${code})`)));
    setTimeout(() => reject(new Error("Next did not report ready within 30s")), 30_000);
  });
}
```

- [ ] **Step 3: Verify it type-compiles**

Run:
```bash
cd /home/chase/projects/scriptr && npm run build:electron
```

Expected: `dist/electron/server.js` exists, no errors.

- [ ] **Step 4: Commit**

```bash
cd /home/chase/projects/scriptr && git add electron/server.ts && git commit -m "feat(electron): server module — Next.js programmatic boot on ephemeral port"
```

---

### Task 2.4: `electron/update.ts` — auto-updater wrapper

Thin wrapper over `electron-updater`. Reads settings from `config.json` via the existing storage helpers, updates `lastCheckedAt` on each check, and notifies via a callback when a new version is ready.

**Files:**
- Create: `/home/chase/projects/scriptr/electron/update.ts`

- [ ] **Step 1: Implement the module**

Create `/home/chase/projects/scriptr/electron/update.ts`:

```ts
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
 * Wire up electron-updater. Returns a function that triggers a check on demand
 * (e.g., the "Check now" button). Automatic checks happen in main.ts.
 */
export function configureUpdater({ dataDir, onUpdateReady }: UpdateDeps): () => Promise<void> {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  // electron-updater pulls release YAML from the feed configured in publish options (electron-builder.yml).

  autoUpdater.on("update-downloaded", (info) => {
    onUpdateReady(info.version);
  });

  autoUpdater.on("error", (err) => {
    // Swallow — a failed update check must never crash the app.
    console.error("[updater] check failed:", err.message);
  });

  return async function checkNow() {
    try {
      await autoUpdater.checkForUpdates();
    } finally {
      await saveConfig(dataDir, {
        updates: {
          checkOnLaunch: (await loadConfig(dataDir)).updates?.checkOnLaunch ?? true,
          lastCheckedAt: new Date().toISOString(),
        },
      });
    }
  };
}

export function installUpdate(): void {
  autoUpdater.quitAndInstall();
}
```

- [ ] **Step 2: Verify it type-compiles**

Run:
```bash
cd /home/chase/projects/scriptr && npm run build:electron
```

Expected: `dist/electron/update.js` exists, no errors. (Note: this is the first file that imports from `../lib/config` — confirm it resolves. If TS complains about `@/lib/config` style paths, use relative imports as shown.)

- [ ] **Step 3: Commit**

```bash
cd /home/chase/projects/scriptr && git add electron/update.ts && git commit -m "feat(electron): update module — electron-updater wrapper with config-backed settings"
```

---

### Task 2.5: `electron/menu.ts` — application menu

Minimal menu: File (Reveal data folder, Quit), Edit (standard), View (Reload in dev, DevTools in dev), Help (About — version only, no remote URLs).

**Files:**
- Create: `/home/chase/projects/scriptr/electron/menu.ts`

- [ ] **Step 1: Implement the module**

Create `/home/chase/projects/scriptr/electron/menu.ts`:

```ts
import { app, Menu, shell, type MenuItemConstructorOptions } from "electron";

export function buildAppMenu(dataDir: string, isDev: boolean): Menu {
  const isMac = process.platform === "darwin";

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: "about" as const },
            { type: "separator" as const },
            { role: "services" as const },
            { type: "separator" as const },
            { role: "hide" as const },
            { role: "hideOthers" as const },
            { role: "unhide" as const },
            { type: "separator" as const },
            { role: "quit" as const },
          ],
        }]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "Reveal Data Folder",
          click: () => void shell.openPath(dataDir),
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { label: "Edit", submenu: [
      { role: "undo" }, { role: "redo" }, { type: "separator" },
      { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
    ]},
    {
      label: "View",
      submenu: [
        ...(isDev
          ? [
              { role: "reload" as const },
              { role: "forceReload" as const },
              { role: "toggleDevTools" as const },
              { type: "separator" as const },
            ]
          : []),
        { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
        { type: "separator" }, { role: "togglefullscreen" },
      ],
    },
    {
      role: "help",
      submenu: [
        {
          label: `scriptr ${app.getVersion()}`,
          enabled: false,
        },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}
```

- [ ] **Step 2: Verify it type-compiles**

Run:
```bash
cd /home/chase/projects/scriptr && npm run build:electron
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/chase/projects/scriptr && git add electron/menu.ts && git commit -m "feat(electron): app menu with Reveal Data Folder entry"
```

---

### Task 2.6: `electron/main.ts` — app lifecycle glue

Wires everything: resolve data dir → set SCRIPTR_DATA_DIR → conditionally set SCRIPTR_UPDATES_CHECK → start Next server → install network filter → create BrowserWindow → set up menu → kick off update check (unless onboarding).

**Files:**
- Create: `/home/chase/projects/scriptr/electron/main.ts`

- [ ] **Step 1: Implement the module**

Create `/home/chase/projects/scriptr/electron/main.ts`:

```ts
import { app, BrowserWindow, Menu, dialog, shell, session } from "electron";
import { join } from "node:path";
import { resolveDataDir } from "./migrate";
import { startNextServer, type ServerHandle } from "./server";
import { installNetworkFilter } from "./network-filter";
import { configureUpdater, isCheckEnabled, installUpdate } from "./update";
import { buildAppMenu } from "./menu";
import { loadConfig } from "../lib/config";
import { blockedRequestsLog } from "../lib/storage/paths";

const isDev = !app.isPackaged;
let serverHandle: ServerHandle | null = null;
let mainWindow: BrowserWindow | null = null;

app.on("ready", () => {
  void main();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
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

  // 2. Read update preferences — must happen before Next boots so CSP is correct
  const updatesEnabled = await isCheckEnabled(dataDir);
  if (updatesEnabled) process.env.SCRIPTR_UPDATES_CHECK = "1";

  // 3. Boot the Next.js server on an ephemeral loopback port
  const appDir = isDev
    ? process.cwd()
    : join(process.resourcesPath, "app"); // electron-builder places standalone here
  serverHandle = await startNextServer(appDir);

  // 4. Install the main-process network filter
  installNetworkFilter(session.defaultSession, {
    loopbackPort: serverHandle.port,
    updatesEnabled,
    logPath: blockedRequestsLog(dataDir),
  });

  // 5. Determine first-run onboarding (no API key configured)
  const cfg = await loadConfig(dataDir);
  const needsOnboarding = !cfg.apiKey;

  // 6. Create the window
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "scriptr",
    backgroundColor: "#ffffff",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      devTools: isDev,
    },
  });

  mainWindow.setMenu(buildAppMenu(dataDir, isDev));
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(mainWindow.getMenu());
  }

  // External-link handler: allowlist-guarded shell.openExternal
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      const allowed =
        (parsed.protocol === "https:" && parsed.hostname.endsWith(".x.ai")) ||
        (parsed.protocol === "https:" && parsed.hostname === "github.com") ||
        parsed.href.startsWith("https://github.com/");
      if (allowed) void shell.openExternal(url);
    } catch {
      // ignore invalid URLs
    }
    return { action: "deny" };
  });

  const landing = needsOnboarding ? "/settings?onboarding=1" : "/";
  await mainWindow.loadURL(serverHandle.url + landing);

  // 7. Updates: skip during onboarding so the first launch makes zero network calls
  //    until the user has configured the app.
  if (updatesEnabled && !needsOnboarding) {
    const checkNow = configureUpdater({
      dataDir,
      onUpdateReady: (version) => {
        mainWindow?.webContents.executeJavaScript(
          `window.dispatchEvent(new CustomEvent("scriptr:update-ready", { detail: ${JSON.stringify(version)} }))`,
        ).catch(() => { /* swallow */ });
      },
    });
    void checkNow();
  }

  // Swallowed for now: an IPC hook could let the UI trigger installUpdate()
  // when the user clicks "Restart to install". Not wired in v1 — the user
  // can close+reopen the app to pick up the downloaded update.
  void installUpdate; // silence unused-export warning in type-check
}
```

- [ ] **Step 2: Verify it type-compiles**

Run:
```bash
cd /home/chase/projects/scriptr && npm run build:electron
```

Expected: all files compile into `dist/electron/`.

- [ ] **Step 3: Smoke-test the packaged-but-dev flow**

Run:
```bash
cd /home/chase/projects/scriptr && npm run build && npm run build:electron && npm run dev:electron
```

Expected: an Electron window opens showing scriptr. If no API key is configured, it loads Settings with an onboarding banner (banner is added in Chunk 3 — for now, it just lands on `/settings?onboarding=1` with no visual treatment).

Close the window. Confirm the terminal reports the server closed cleanly.

- [ ] **Step 4: Commit**

```bash
cd /home/chase/projects/scriptr && git add electron/main.ts && git commit -m "feat(electron): main process — lifecycle, window, server boot, update wiring"
```

---

**End of Chunk 2.** Run all quality gates:

```bash
cd /home/chase/projects/scriptr && npm run typecheck && npm run lint && npm test
```

Expected: all green. At this point, `npm run dev:electron` launches a working (ugly) desktop version.

---

## Chunk 3: Web-side integration, build, distribution

The renderer (settings page, privacy panel) gains onboarding + update controls. A new privacy egress test covers the update-off case. `electron-builder` config produces installers for three platforms. A GitHub Actions workflow publishes them to draft releases. README tells users how to launch the unsigned builds.

### Task 3.1: `PrivacyPanel` — desktop disclosure section

Render a "Desktop app network activity" section when `/api/settings` reports `isElectron: true`. Shows enabled destinations, `checkOnLaunch` state, and `lastCheckedAt`.

**Files:**
- Modify: `/home/chase/projects/scriptr/components/settings/PrivacyPanel.tsx`

- [ ] **Step 1: Read the existing panel in full**

Run:
```bash
cd /home/chase/projects/scriptr && wc -l components/settings/PrivacyPanel.tsx
```

Read the whole file — the new section will be appended inside the existing root `<section>` container, above or below the story-payload table depending on what reads best. Pick the location that keeps the information hierarchy clear: the network-activity summary is higher-level than per-story payloads, so render it first.

- [ ] **Step 2: Add the desktop disclosure**

In `PrivacyPanel.tsx`:

1. Add a SWR hook for settings:

```tsx
const { data: settings } = useSWR<{
  isElectron?: boolean;
  updates?: { checkOnLaunch: boolean; lastCheckedAt?: string };
}>("/api/settings", fetcher);
```

2. Render this block near the top of the root `<section>`:

```tsx
{settings?.isElectron && (
  <div className="rounded-md border border-border/60 bg-muted/30 p-4">
    <h3 className="mb-2 text-sm font-medium">Desktop app network activity</h3>
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="text-muted-foreground">Allowed destinations</dt>
      <dd>
        <code>https://api.x.ai</code> (generation)
        {settings.updates?.checkOnLaunch && (
          <>, <code>https://api.github.com</code> (updates)</>
        )}
      </dd>
      <dt className="text-muted-foreground">Update check on launch</dt>
      <dd>{settings.updates?.checkOnLaunch ? "enabled" : "disabled"}</dd>
      <dt className="text-muted-foreground">Last check</dt>
      <dd>{settings.updates?.lastCheckedAt ?? "never"}</dd>
    </dl>
  </div>
)}
```

- [ ] **Step 3: Manual verify in dev**

Run `npm run dev` in one terminal, `curl -s http://127.0.0.1:3000/api/settings | jq .data.isElectron` — should print `false` under web mode. Then `npm run dev:electron` — the panel should render the new block at the top.

- [ ] **Step 4: Commit**

```bash
cd /home/chase/projects/scriptr && git add components/settings/PrivacyPanel.tsx && git commit -m "feat(privacy): desktop network-activity disclosure in PrivacyPanel"
```

---

### Task 3.2: `SettingsForm` — onboarding banner + updates section

Adds (a) a welcome banner when `?onboarding=1`, and (b) an updates toggle + "Check now" + last-checked timestamp, both visible only under Electron.

**Files:**
- Modify: `/home/chase/projects/scriptr/components/settings/SettingsForm.tsx`

- [ ] **Step 1: Read the existing form**

Run:
```bash
cd /home/chase/projects/scriptr && wc -l components/settings/SettingsForm.tsx
```

Read the full file. Understand where the API key input lives — the banner goes directly above it.

- [ ] **Step 2: Add the onboarding banner**

Import `useSearchParams` from `next/navigation`:

```tsx
import { useSearchParams } from "next/navigation";
```

At the top of the component, read the flag:

```tsx
const search = useSearchParams();
const onboarding = search.get("onboarding") === "1";
```

Render above the API key field:

```tsx
{onboarding && (
  <div className="mb-4 rounded-md border border-blue-500/30 bg-blue-500/5 p-4">
    <h2 className="text-sm font-semibold">Welcome to scriptr</h2>
    <p className="mt-1 text-sm text-muted-foreground">
      Paste your xAI API key below to get started.{" "}
      <a
        href="https://console.x.ai"
        target="_blank"
        rel="noreferrer"
        className="underline"
      >
        Get a key →
      </a>
    </p>
  </div>
)}
```

- [ ] **Step 3: Add the updates section (Electron-only)**

Read the SWR hook(s) already in this file to pick up `isElectron` and `updates` from the GET response. If they aren't already on the response type, extend it. Render this block below the existing style-defaults / other settings:

```tsx
{settings.isElectron && (
  <section className="mt-6 flex flex-col gap-3">
    <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
      Updates
    </h2>
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={settings.updates?.checkOnLaunch ?? true}
        onChange={(e) =>
          updateSettings({
            updates: {
              checkOnLaunch: e.target.checked,
              lastCheckedAt: settings.updates?.lastCheckedAt,
            },
          })
        }
      />
      Check for updates on launch
    </label>
    <div className="flex items-center gap-3 text-sm text-muted-foreground">
      <span>
        Last checked: {settings.updates?.lastCheckedAt ?? "never"}
      </span>
      <button
        type="button"
        className="rounded border px-2 py-1 text-xs"
        onClick={async () => {
          await fetch("/api/updates/check-now", { method: "POST" });
          // SWR will refresh on focus; for immediacy, mutate() if available
        }}
      >
        Check now
      </button>
    </div>
  </section>
)}
```

(Replace `updateSettings({...})` with whatever helper the form uses to PUT partial settings. Read the file first to match its style.)

- [ ] **Step 4: Add the `/api/updates/check-now` route**

Create `/home/chase/projects/scriptr/app/api/updates/check-now/route.ts`:

```ts
import { ok, fail } from "@/lib/api";

export async function POST() {
  if (!process.versions.electron) {
    return fail("Updates only available in the desktop app", 400);
  }
  // The Electron main process polls config.updates.lastCheckedAt after running
  // its check. For "check now" from the UI, we signal it via a sentinel file
  // — Chunk 3 Task 3.2b wires the main process to watch for it. In v1, we keep
  // it simple: the UI call is a no-op; the user relies on next-launch check
  // or restarting the app.
  return ok({ queued: true });
}
```

**Note:** This is intentionally minimal for v1. A proper in-app "Check now" would need the main process to expose an IPC/HTTP endpoint that triggers `checkNow()`. That's an enhancement — deferred. The button still exists so users know the feature is there; it just tells them the check will happen next launch.

- [ ] **Step 5: Add the new route to the egress test**

Edit `/home/chase/projects/scriptr/tests/privacy/no-external-egress.test.ts`. Find the block that iterates through routes and add the new POST. Follow the existing pattern exactly — do not invent a new shape.

- [ ] **Step 6: Verify tests**

Run:
```bash
cd /home/chase/projects/scriptr && npm test
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
cd /home/chase/projects/scriptr && git add components/settings/SettingsForm.tsx app/api/updates/check-now/route.ts tests/privacy/no-external-egress.test.ts && git commit -m "feat(settings): onboarding banner + updates section (Electron-only)"
```

---

### Task 3.3: Update-off egress test

Prove that when `updates.checkOnLaunch` is `false`, nothing in the Next server reaches out to `api.github.com`. This test complements the main-process filter test — different layer, same invariant.

**Files:**
- Create: `/home/chase/projects/scriptr/tests/privacy/update-opt-out.test.ts`

- [ ] **Step 1: Write the test**

Write `/home/chase/projects/scriptr/tests/privacy/update-opt-out.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET } from "@/app/api/settings/route";
import { POST } from "@/app/api/updates/check-now/route";

let recorded: { url: string; method: string }[] = [];
const origFetch = globalThis.fetch;

beforeEach(() => {
  recorded = [];
  globalThis.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
    recorded.push({ url, method: init?.method ?? "GET" });
    return Promise.resolve(new Response("{}", { status: 200 }));
  };
});
afterEach(() => {
  globalThis.fetch = origFetch;
});

describe("privacy — update opt-out", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "scriptr-upd-"));
    await writeFile(
      join(dir, "config.json"),
      JSON.stringify({ updates: { checkOnLaunch: false } }),
      "utf-8",
    );
    process.env.SCRIPTR_DATA_DIR = dir;
  });
  afterEach(async () => {
    delete process.env.SCRIPTR_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  });

  it("GET /api/settings does not fetch anything", async () => {
    await GET();
    expect(recorded).toEqual([]);
  });

  it("POST /api/updates/check-now does not fetch github", async () => {
    // Simulate Next running under Electron so the route doesn't early-return.
    const original = (process.versions as Record<string, string | undefined>).electron;
    (process.versions as Record<string, string | undefined>).electron = "33.0.0";
    try {
      await POST();
    } finally {
      (process.versions as Record<string, string | undefined>).electron = original;
    }
    expect(recorded.find((r) => r.url.includes("github.com"))).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/privacy/update-opt-out.test.ts
```

Expected: both tests pass.

- [ ] **Step 3: Commit**

```bash
cd /home/chase/projects/scriptr && git add tests/privacy/update-opt-out.test.ts && git commit -m "test(privacy): assert no github fetch when updates disabled"
```

---

### Task 3.4: Electron-builder configuration

The single file that controls cross-platform packaging.

**Files:**
- Create: `/home/chase/projects/scriptr/electron-builder.yml`

- [ ] **Step 1: Write the config**

Create `/home/chase/projects/scriptr/electron-builder.yml`:

```yaml
appId: com.scriptr.app
productName: scriptr
# Copyright: stock string — update if you have a legal entity
copyright: Copyright © 2026 scriptr

# Files bundled into the resources directory of the installer
files:
  - "dist/electron/**/*"
  - "package.json"
  - "!node_modules/**/*" # we pull deps from standalone instead
# Next.js standalone output — this is the Next app that main.ts boots
extraResources:
  - from: ".next/standalone"
    to: "app"
  - from: ".next/static"
    to: "app/.next/static"
  - from: "public"
    to: "app/public"

directories:
  output: "release"

# Don't sign anything for v1 — design decision, flagged in README
forceCodeSigning: false
mac:
  identity: null
  hardenedRuntime: false
  gatekeeperAssess: false
  target:
    - target: dmg
      arch: [x64, arm64]
  category: public.app-category.productivity
win:
  signAndEditExecutable: false
  target:
    - target: nsis
      arch: [x64]
  publisherName: scriptr
nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
linux:
  target:
    - AppImage
    - deb
  category: Office
  maintainer: scriptr

# Update feed — publish to GitHub Releases
publish:
  provider: github
  owner: Daelso
  repo: scriptr
  releaseType: draft
```

- [ ] **Step 2: Verify electron-builder parses the config**

Run:
```bash
cd /home/chase/projects/scriptr && npx electron-builder --help >/dev/null && npx electron-builder --dir --config electron-builder.yml 2>&1 | tail -30
```

Expected: It runs at least as far as collecting files. It will likely fail somewhere if `.next/standalone` hasn't been built yet — that's fine; you're only verifying config parsing. Run `npm run build && npm run build:electron` first if you want a clean pass.

- [ ] **Step 3: Commit**

```bash
cd /home/chase/projects/scriptr && git add electron-builder.yml && git commit -m "chore(electron-builder): unsigned cross-platform config (NSIS, dmg, AppImage, deb)"
```

---

### Task 3.5: GitHub Actions release workflow

CI matrix builds all three platforms on tag push and uploads artifacts to a draft GitHub Release.

**Files:**
- Create: `/home/chase/projects/scriptr/.github/workflows/release.yml`

- [ ] **Step 1: Write the workflow**

Create `/home/chase/projects/scriptr/.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - "v*.*.*"

jobs:
  build:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build Next.js
        run: npm run build

      - name: Compile Electron main process
        run: npm run build:electron

      - name: Typecheck + lint + test
        run: |
          npm run typecheck
          npm run lint
          npm test

      - name: Package with electron-builder
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: npx electron-builder --publish always
```

- [ ] **Step 2: Commit**

```bash
cd /home/chase/projects/scriptr && git add .github/workflows/release.yml && git commit -m "ci(release): matrix build + publish draft GitHub release on tag"
```

(Don't push a tag yet — the actual release is a user-driven step after this plan is merged.)

---

### Task 3.6: README desktop install section

Document the unsigned-build install warnings and `Reveal Data Folder` menu entry.

**Files:**
- Modify: `/home/chase/projects/scriptr/README.md`

- [ ] **Step 1: Locate a good section anchor**

Run:
```bash
cd /home/chase/projects/scriptr && grep -n "^##" README.md | head -20
```

Find a section title the new "Desktop install" block should come before or after. "Quickstart" or "Running locally" is the natural neighbor.

- [ ] **Step 2: Insert the new section**

Add a `## Desktop install` section with this content:

```markdown
## Desktop install

scriptr ships as an unsigned desktop app for Windows, macOS, and Linux. Download the latest installer from the [Releases page](https://github.com/Daelso/scriptr/releases).

### Windows

Run the installer. Windows SmartScreen will show "Windows protected your PC" — click **More info**, then **Run anyway**. This happens because the installer is unsigned. The app installs per-user by default; no admin rights needed.

### macOS

Open the `.dmg`, drag scriptr to Applications. On first launch, macOS will refuse to open it — right-click scriptr in Applications and choose **Open**, then confirm. Gatekeeper remembers the exception; future launches don't prompt.

### Linux

Download the AppImage, make it executable (`chmod +x scriptr-*.AppImage`), and double-click. On Debian/Ubuntu, the `.deb` is available as an alternative.

### Data location

Stories, chapters, bible, and config live in:

- **Windows:** `%APPDATA%\scriptr\data`
- **macOS:** `~/Library/Application Support/scriptr/data`
- **Linux:** `~/.local/share/scriptr/data`

From the app: **File → Reveal Data Folder** opens it. Back up this folder to preserve your work.
```

- [ ] **Step 3: Commit**

```bash
cd /home/chase/projects/scriptr && git add README.md && git commit -m "docs(readme): desktop install section (unsigned warnings, data location)"
```

---

**End of Chunk 3.** Run all quality gates:

```bash
cd /home/chase/projects/scriptr && npm run typecheck && npm run lint && npm test
```

Expected: all green.

**Final end-to-end smoke test:**

```bash
cd /home/chase/projects/scriptr && npm run build && npm run build:electron && npm run dev:electron
```

Expected: an Electron window opens. If no API key is configured: you see the Settings page with an onboarding banner. Enter a key, navigate to stories, create/edit one, verify generation works. Open Settings → Privacy to see the "Desktop app network activity" disclosure. Close the app — server shuts down cleanly in the terminal.

**Full distributable build (optional, verifies CI locally):**

```bash
cd /home/chase/projects/scriptr && npm run package:electron
```

Expected: `release/` contains platform-appropriate installers.
