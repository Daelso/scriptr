/* eslint-disable @typescript-eslint/no-require-imports -- this is a
   CommonJS hook electron-builder loads via require(); ESM is not an
   option here without changing electron-builder's invocation path. */

// electron-builder afterPack hook: bake compile-time security fuses into the
// packaged Electron binary. Called by electron-builder once per platform
// after it stages the app under release/<platform>-unpacked/ (or the .app
// bundle on macOS), before the final .exe/.dmg/.AppImage/.deb is produced.
//
// Why a JS .cjs hook instead of electron-builder's declarative `electronFuses`
// config: that key was added in electron-builder 26; we ship 25.1.8, which
// rejects it as an unknown property. The afterPack pattern is the canonical
// path documented by @electron/fuses and works on any electron-builder
// version. When/if we upgrade to 26+, we can switch to the declarative form.
//
// Authoritative value lock-in is in tests/electron/fuses.test.ts.

const path = require("node:path");
const { flipFuses, FuseVersion, FuseV1Options } = require("@electron/fuses");

// Exported so tests/electron/fuses.test.ts can assert each value without
// running flipFuses against a real binary.
const FUSE_VALUES = {
  version: FuseVersion.V1,
  // resetAdHocDarwinSignature toggles re-signing of the binary after the
  // fuse bytes change. Required on macOS arm64 — the OS rejects an
  // ad-hoc-signed binary whose code-page hashes no longer match the
  // signature. flipFuses shells out to `codesign`, which only exists on
  // macOS, so we gate this on the build host. On CI's macos-latest
  // runner this evaluates true and the resign happens. Cross-builds from
  // Linux/Windows skip it (the resulting .app wouldn't run on macOS
  // anyway without further signing).
  resetAdHocDarwinSignature: process.platform === "darwin",

  // MUST stay true. electron/server.ts spawns process.execPath with
  // ELECTRON_RUN_AS_NODE=1 to run Next's standalone server.js. Flipping
  // this off would break that spawn — packaged app would fail to boot.
  [FuseV1Options.RunAsNode]: true,

  // Refuse to load JavaScript from outside the asar archive. Tamper guard.
  [FuseV1Options.OnlyLoadAppFromAsar]: true,

  // Block --inspect / --remote-debugging-port from attaching a debugger to
  // the main process.
  [FuseV1Options.EnableNodeCliInspectArguments]: false,

  // Same hardening for NODE_OPTIONS. Must be paired with the
  // ENV_PASSTHROUGH allowlist gate in electron/server.ts which drops
  // NODE_OPTIONS before spawning the child Next process.
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,

  // Encrypt cookies at rest using OS-level keys.
  [FuseV1Options.EnableCookieEncryption]: true,

  // Default true. Set explicitly so future Electron upgrades don't
  // silently flip it.
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: true,
};

module.exports = async function afterPack(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  const productFilename = packager.appInfo.productFilename;

  // Resolve the path that flipFuses needs:
  // - macOS: the .app bundle directory (flipFuses descends to find the
  //   Mach-O binary inside).
  // - Windows: the .exe.
  // - Linux: the binary with no extension.
  let target;
  if (electronPlatformName === "darwin" || electronPlatformName === "mas") {
    target = path.join(appOutDir, `${productFilename}.app`);
  } else if (electronPlatformName === "win32") {
    target = path.join(appOutDir, `${productFilename}.exe`);
  } else {
    // linux + freebsd: lowercase the productName per electron-builder's
    // executableName convention. With productName: scriptr already
    // lowercase, this is a no-op.
    target = path.join(appOutDir, productFilename.toLowerCase());
  }

  // eslint-disable-next-line no-console
  console.log(`[afterPack] flipping fuses on ${target}`);
  await flipFuses(target, FUSE_VALUES);
};

// Re-export FUSE_VALUES so the unit test can verify config drift.
module.exports.FUSE_VALUES = FUSE_VALUES;
