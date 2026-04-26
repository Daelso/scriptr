#!/usr/bin/env node
// Launch the packaged Electron binary briefly and fail if it emits any
// FATAL log line or exits early. Catches startup crashes that don't
// surface in unit tests because nothing else in CI actually executes a
// packaged build.
//
// Why this exists: in v0.3.0 we shipped a fuse misconfiguration that
// made the browser process abort on startup with "Error loading V8
// startup snapshot file". The fuses unit test passed (it just locks in
// the configured value), the build job succeeded, every artifact was
// uploaded — and every install on every platform was broken.
//
// Run from the repo root after `electron-builder` has produced the
// per-platform unpacked tree under release/. On Linux this needs a
// virtual display (the release.yml step wraps it in xvfb-run).

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { dirname, join } from "node:path";

const SMOKE_TIMEOUT_MS = 8000;
const POST_KILL_GRACE_MS = 1500;

const FATAL_PATTERNS = [
  /\bFATAL\b/,
  /Error loading V8 startup snapshot file/,
  /Cannot find module/,
];

function resolveBinary() {
  switch (platform()) {
    case "linux":
      return "release/linux-unpacked/scriptr";
    case "win32":
      return "release/win-unpacked/scriptr.exe";
    case "darwin": {
      // electron-builder.yml ships arch:[x64,arm64] without a universal
      // target, so both `release/mac/` and `release/mac-arm64/` may
      // exist. Run whichever the host can execute — macos-latest
      // runners are arm64 by default.
      const candidates = [
        "release/mac-arm64/scriptr.app/Contents/MacOS/scriptr",
        "release/mac/scriptr.app/Contents/MacOS/scriptr",
      ];
      const found = candidates.find((p) => existsSync(p));
      if (!found) {
        throw new Error(
          `No scriptr.app under release/. Tried: ${candidates.join(", ")}`,
        );
      }
      return found;
    }
    default:
      throw new Error(`Unsupported platform: ${platform()}`);
  }
}

const bin = resolveBinary();
if (!existsSync(bin)) {
  console.error(`::error ::Packaged binary not found at ${bin}`);
  process.exit(1);
}

console.log(`[smoke-launch] launching ${bin} for ${SMOKE_TIMEOUT_MS}ms`);

// Isolate userData under a fresh temp HOME so a previous run's state
// doesn't taint this one (and so we don't leave files in the runner's
// real HOME). The first-launch decision tree picks `kind: "fresh"`
// when nothing exists, so no migration dialog blocks startup.
const tmpHome = mkdtempSync(join(tmpdir(), "scriptr-smoke-"));
const env = { ...process.env };
// Defensively scrub ELECTRON_RUN_AS_NODE — if it's set in the parent
// shell (developers often have it from local debugging), the binary
// launches as a Node interpreter and rejects every Chromium flag with
// "bad option: ...", which we'd misread as a smoke-test failure.
delete env.ELECTRON_RUN_AS_NODE;
if (platform() === "win32") {
  env.APPDATA = tmpHome;
  env.LOCALAPPDATA = tmpHome;
} else {
  env.HOME = tmpHome;
  env.XDG_CONFIG_HOME = join(tmpHome, ".config");
  env.XDG_DATA_HOME = join(tmpHome, ".local", "share");
}

// Electron writes FATAL log lines to stderr by default on POSIX and to
// `debug.log` next to the binary on Windows; we capture both. Don't
// pass `--enable-logging` — Electron's argv preprocessor rejects the
// flag form on some builds, and we don't need verbose logging anyway.
// Linux non-root needs `--no-sandbox` because chrome-sandbox isn't
// SUID in the unpacked tree (electron-builder doesn't apply SUID at
// build time; only the .deb install step does).
const args = platform() === "linux" ? ["--no-sandbox"] : [];
const child = spawn(bin, args, {
  env,
  stdio: ["ignore", "pipe", "pipe"],
});

let combined = "";
child.stdout.on("data", (b) => {
  combined += b.toString();
});
child.stderr.on("data", (b) => {
  combined += b.toString();
});

let earlyExit = null;
child.once("exit", (code, signal) => {
  earlyExit = { code, signal };
});

await new Promise((r) => setTimeout(r, SMOKE_TIMEOUT_MS));

if (child.exitCode === null && child.signalCode === null) {
  child.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, POST_KILL_GRACE_MS));
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
  }
}

// Fall back to the on-disk debug.log too — defense in depth in case a
// Chromium build elects to file-only logging.
let debugLog = "";
try {
  debugLog = readFileSync(join(dirname(bin), "debug.log"), "utf-8");
} catch {
  // no debug.log; rely on captured stderr/stdout
}

const allOutput = `${combined}\n${debugLog}`;
console.log("[smoke-launch] captured output:");
console.log(allOutput);

for (const pat of FATAL_PATTERNS) {
  if (pat.test(allOutput)) {
    console.error(`::error ::Smoke test detected fatal output matching ${pat}`);
    process.exit(1);
  }
}

// An early non-zero exit (before the smoke window elapsed) without a
// matching FATAL line still means the binary failed to stay alive —
// fail loudly rather than silently passing.
if (earlyExit && earlyExit.code !== null && earlyExit.code !== 0) {
  console.error(
    `::error ::Binary exited prematurely with code=${earlyExit.code} signal=${earlyExit.signal}`,
  );
  process.exit(1);
}

console.log("[smoke-launch] OK — no fatal output, process stayed alive");
