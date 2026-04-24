---
title: Desktop packaging (Electron) — design
date: 2026-04-24
status: approved
---

# Desktop packaging

Ship scriptr as a native-feeling desktop app for Windows, macOS, and Linux. Keep the Next.js server, renderer code, and privacy posture identical to the web build — only add a shell around them.

## Goals

- Double-click-to-launch experience with a dedicated app window (no browser, no terminal).
- Cross-platform: Windows, macOS, Linux.
- Data stored in OS-standard per-user locations, surviving app updates.
- Opt-in, on-by-default background update check via GitHub Releases.
- Preserve scriptr's privacy posture: no telemetry, no new network destinations beyond what the user explicitly enables.

## Non-goals (v1)

- Code signing / notarization. Users see SmartScreen/Gatekeeper warnings on first launch; that's accepted for v1 to avoid paid certs ($99/yr Apple, $100–400/yr Windows EV cert).
- Mac App Store / Microsoft Store submissions.
- Flatpak / snap / rpm packaging. AppImage + deb cover Linux.
- Delta updates, staged rollouts, beta channel.
- OS keychain integration for the xAI API key.
- UI for changing the data directory after install.
- Portable (installerless) Windows build.

## Framework decision: Electron

Tauri was considered and rejected. Electron wins here because scriptr's Next.js server is the authoritative API surface, and Next.js runs cleanly in Electron's bundled Node runtime with zero changes. A Tauri shell would require a Node sidecar binary (Node SEA or `pkg`-bundled Next.js server), which re-introduces the bundle size Tauri is supposed to save while adding a second build pipeline and novel integration risk around Next.js 16's programmatic server API and SSE.

Bundle size (~80–120 MB per platform) is acceptable for a writing app used actively. Electron's historical telemetry concerns are addressable with explicit configuration (see Privacy Hardening).

## Architecture

### Process layout

**Main process** (`electron/main.ts`)

Owns app lifecycle, `BrowserWindow`, menus, auto-updater, and the Next.js HTTP server. Startup sequence:

1. Resolve OS user-data directory; create if missing (see Data Directory).
2. Run first-launch migration check if needed.
3. Read `data/config.json` update preferences.
4. `process.env.SCRIPTR_DATA_DIR = <resolved path>`.
5. Boot Next.js programmatically via `next({ dev: false, dir: <app resources>, customServer: true })`, wrap in `http.createServer()`, `.listen(0, '127.0.0.1')` to bind an ephemeral loopback port.
6. Install the `onBeforeRequest` network filter on the default session.
7. Create `BrowserWindow` pointed at `http://127.0.0.1:<port>` (or `/settings?onboarding=1` if no API key is configured).
8. After window is shown, if enabled, kick off `autoUpdater.checkForUpdates()`.

**Renderer process**

The existing Next.js app, unchanged. No `preload.ts`, no contextBridge, no IPC. The renderer is a localhost HTTP client — identical code whether served by `next start` (web) or by the embedded server (desktop). This keeps the two distribution paths from diverging.

### Dev workflow

- `npm run dev` stays as-is — unchanged web-app iteration loop.
- New `npm run dev:electron` — runs `electron .` against a dev build of the main process (with DevTools enabled) pointed at a `next dev` server. For iterating on the shell without rebuilding Next each time.

### Why loopback HTTP instead of IPC

Keeps the API surface in one place (Next.js route handlers). An IPC bridge would require a second API implementation in the main process, plus serialization plumbing, plus tests for both paths. The ephemeral loopback port already has:

- CSP enforcement via Next response headers.
- Existing privacy/egress tests exercising the handlers directly.
- A clear security boundary (same-origin same-host).

## Data directory

### Location per platform

Electron's `app.getPath("userData")` resolves the right root per platform; we append `/data`:

- **Windows:** `%APPDATA%\scriptr\data` (`C:\Users\<user>\AppData\Roaming\scriptr\data`)
- **macOS:** `~/Library/Application Support/scriptr/data`
- **Linux:** `$XDG_DATA_HOME/scriptr/data`, falling back to `~/.local/share/scriptr/data`

### Integration point

`lib/config.ts#effectiveDataDir()` already respects `SCRIPTR_DATA_DIR`. The main process sets that env var before booting Next. **No changes to the storage layer.**

### First-launch migration

Main process, before starting Next:

1. If `<userData>/data/config.json` exists → boot normally.
2. Else, look for an existing `./data/` next to the executable or in the current working directory. If found and non-empty, show a native dialog:
   > Found existing scriptr data at `<path>`. Copy to the new location, or point the app at it in place?
   - **Copy** → recursive copy into userData dir; leave the original alone.
   - **Use in place** → persist the chosen path to `<userData>/location.json` (`{ "dataDir": "<abs path>" }`). Main process reads `location.json` on every subsequent launch and honors it.
3. Else → create empty `<userData>/data/` and boot.

### Reveal-folder menu item

Add a File (or Help) menu entry: **Reveal data folder** → `shell.openPath(effectiveDataDir())`. Necessary because the default location is hidden on all three platforms and users need it for backup / inspection.

## API key & first-run

### Storage

Stays in `data/config.json#apiKey`, plaintext. No keychain integration in v1.

Rationale: the data directory already contains the user's stories (more sensitive than the key in most threat models), keychain integration needs per-platform native code, and users who want at-rest encryption can place the data dir on an encrypted volume. Flagged as deferred.

`XAI_API_KEY` env var override continues to work — passed through by the main process to the Next server.

### First-run UX

On launch, main process checks `config.json#apiKey`. If missing or empty, loads the window at `/settings?onboarding=1` instead of `/`. The Settings page renders a banner when that query param is set:

> Welcome to scriptr. Paste your xAI API key below to get started. [Get a key →]

Once saved, the banner dismisses and the user can navigate to the story list via existing links. No new onboarding wizard, no duplicated UI in a native dialog.

## Privacy hardening

### Telemetry

- **Do not** call `crashReporter.start()`. Electron's crash reporter is off by default; we enforce this stays the case with a comment + lint rule extension.
- Extend `scriptr/no-telemetry` to also disallow importing `electron/crashReporter` and known Electron analytics packages.

### Network surface

Main process installs `session.defaultSession.webRequest.onBeforeRequest` with an allowlist:

- `http://127.0.0.1:<ephemeral-port>/*` (the embedded Next server)
- `https://api.x.ai/*`
- `https://api.github.com/repos/<owner>/scriptr/releases/*` — **only if update checks are enabled**

Any other URL: `callback({ cancel: true })`, logged to `<dataDir>/logs/blocked-requests.log`. This is belt-and-suspenders against a dependency introducing a tracker — CSP would catch most of it, but a main-process filter is a hard gate that can't be relaxed by a compromised renderer.

### Renderer lockdown

`BrowserWindow.webPreferences`:

```ts
{
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
}
```

No `preload.ts`. No Node APIs exposed to the renderer.

`setWindowOpenHandler`: deny all by default. External links (e.g., "Get an xAI key") go through a handler that calls `shell.openExternal(url)` after validating the URL against a small allowlist (`https://*.x.ai/*`, `https://github.com/<owner>/scriptr/*`).

### DevTools

Enabled in dev builds. Disabled in packaged builds via `BrowserWindow` config + removed from the menu.

### Carried over from web build

- CSP response headers from `next.config.ts` — still bind, since the renderer loads from `http://127.0.0.1:<port>` which is served by Next.
- `scriptr/no-telemetry` ESLint rule — unchanged.
- `tests/privacy/no-external-egress.test.ts` — unchanged, still runs per route.

### New tests

- **Main-process filter test:** stub Electron's `session.defaultSession.webRequest`, invoke the filter with allowed and disallowed URLs, assert cancel behavior matches allowlist.
- **Update-off egress test:** with `updates.checkOnLaunch: false`, verify the main process does not call `api.github.com` during startup.

### Privacy panel disclosure

Existing `/api/privacy/last-payload` surface gets a new section, shown only when running under Electron (detected via `process.versions.electron`):

- Desktop app network destinations (api.x.ai, optional api.github.com for updates)
- Update check frequency: `checkOnLaunch` toggle state
- Last check timestamp

## Auto-update

### Mechanism

`electron-updater` with GitHub Releases as the feed. On startup, after the main window is shown, call `autoUpdater.checkForUpdates()` unless `updates.checkOnLaunch === false`. If an update is found, download in the background. When ready, show a non-modal notification in the app:

> Update v0.3.0 ready — restart to install.

User clicks, `autoUpdater.quitAndInstall()` exits and relaunches into the new version.

### Settings

New section in `app/settings/page.tsx`, visible only under Electron:

- `updates.checkOnLaunch: boolean` (default `true`)
- `updates.lastCheckedAt: string` (read-only ISO timestamp)
- **Check now** button — force-runs a check regardless of toggle state.

Stored in `data/config.json` alongside existing config. Main process reads it on launch.

### Privacy surface

Exactly one new destination: GitHub Releases API for the scriptr repo. Added to:

- `connect-src` in CSP (conditional via Next header helper — only when user has Electron + updates-on).
- Main-process `onBeforeRequest` allowlist (conditional on same flag).
- `no-external-egress.test.ts` exemptions, with a new assertion that the destination is **not** reached when updates are disabled.

### Signing

Unsigned builds: `electron-updater` falls back to SHA512 hash verification from the YAML feed. Users see OS warnings on first install but updates still validate integrity against the release manifest. When we eventually sign, `electron-updater` picks it up automatically from the signed installer metadata.

### Deferred

- Delta updates (NSIS-only, adds build complexity).
- Staged rollouts (not needed for single-user app).
- Beta channel (one channel for v1).

## Build, packaging, distribution

### Source layout

```
electron/
  main.ts            # app lifecycle, window, next() boot, update check
  server.ts          # http.createServer wrapper around Next.js
  network-filter.ts  # onBeforeRequest allowlist
  migrate.ts         # first-launch data migration
electron-builder.yml
```

Main process in TypeScript. Compile via `tsc` or `esbuild` into `dist/electron/` pre-package.

### Build pipeline

New script `build:electron`:

1. `next build` (existing).
2. Compile `electron/*.ts` → `dist/electron/`.
3. Copy `.next/standalone` + `.next/static` + `public/` into Electron's resources tree.
4. `electron-builder` packages per platform.

Add `next.config.ts#output: "standalone"` to minimize the bundled `node_modules` footprint.

### Output per platform

- **Windows:** NSIS installer (`.exe`). Per-user install default, per-machine optional. Unsigned in v1 — SmartScreen shows "Unknown publisher" warning on first launch.
- **macOS:** `.dmg` for `x64` and `arm64`, plus a universal build. Unsigned — users right-click → Open to bypass Gatekeeper on first launch. Flag in release notes + README.
- **Linux:** AppImage (primary — works on most distros, no package manager needed). `.deb` (secondary — Debian/Ubuntu).

### CI

`.github/workflows/release.yml`, triggered on `v*` tag push:

- Matrix: `[ubuntu-latest, windows-latest, macos-latest]`
- Each job: `npm ci`, `npm run build`, `npm run build:electron`, `electron-builder --publish always`
- `electron-builder` uploads artifacts to the draft GitHub Release matching the tag.
- Secrets needed: `GH_TOKEN` (for publishing releases). **No signing secrets in v1** — explicitly documented so we don't accidentally leave unsigned builds in place after adding certs later.

### Release workflow

1. Bump `version` in `package.json`, commit.
2. `git tag v0.3.0 && git push --tags`.
3. CI builds and publishes a draft GitHub Release with artifacts for all three platforms.
4. Manually review + publish.
5. Existing installs pick up the update on next launch.

### User-facing install notes

README gets a **Desktop install** section explaining the unsigned-build warnings:

- Windows: "More info → Run anyway" on SmartScreen prompt.
- macOS: right-click the app in Applications, choose **Open**, confirm.
- Linux: `chmod +x` the AppImage, double-click.

## Risks & open items

- **Next.js 16 programmatic server API.** Verify `next({ customServer: true })` with an ephemeral port works under v16.2.4 before committing to this shape. If it doesn't, fall back to spawning `next start` as a child process — worse but still viable.
- **Unsigned builds friction.** Users will report "Windows says it's a virus." Mitigate with clear README + release notes. Revisit signing if user complaints become common.
- **Data migration edge cases.** If the user has customized `SCRIPTR_DATA_DIR`, the migration dialog should detect and respect it. Spec's current flow handles the "default location" case; unusual setups may need manual intervention.
- **Linux AppImage sandboxing quirks.** Some distros have FUSE issues; fallback is the `.deb`. Out of scope to solve for every distro.

## Deferred enhancements

- Code signing (Windows + macOS).
- Notarization (macOS).
- Mac App Store / Microsoft Store builds.
- Keychain integration for API key.
- UI to change data directory post-install.
- Flatpak / snap / rpm.
- Auto-update delta packages.
- Offline mode indicator (since `api.x.ai` is required for generation).
