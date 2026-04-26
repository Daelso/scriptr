import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { FuseV1Options, FuseVersion } from "@electron/fuses";

// Load the afterPack hook to inspect the FUSE_VALUES it will apply at
// packaging time. require() goes through Node's CommonJS loader, which is
// what electron-builder uses to invoke the hook in CI — so we're testing
// the same module path that runs in production.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const afterPack = require(join(process.cwd(), "electron/afterPack.cjs")) as {
  FUSE_VALUES: Record<string | number, boolean | FuseVersion>;
};

describe("electron/afterPack.cjs — FUSE_VALUES", () => {
  it("targets fuse wire V1", () => {
    expect(afterPack.FUSE_VALUES.version).toBe(FuseVersion.V1);
  });

  it.each([
    [FuseV1Options.RunAsNode, "RunAsNode", true],
    [FuseV1Options.OnlyLoadAppFromAsar, "OnlyLoadAppFromAsar", true],
    [FuseV1Options.EnableNodeCliInspectArguments, "EnableNodeCliInspectArguments", false],
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable, "EnableNodeOptionsEnvironmentVariable", false],
    [FuseV1Options.EnableCookieEncryption, "EnableCookieEncryption", true],
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot, "LoadBrowserProcessSpecificV8Snapshot", false],
  ] as const)("sets FuseV1Options.%s (key=%s) to %s", (key, _label, value) => {
    expect(afterPack.FUSE_VALUES[key]).toBe(value);
  });

  // resetAdHocDarwinSignature is only set true on macOS hosts because
  // flipFuses() shells out to `codesign` for the resign, and codesign
  // only exists on macOS. On CI's macos-latest runner this evaluates
  // true (so the .app gets resigned post-flip and arm64 doesn't reject
  // it). On Linux/Windows runners building for their own platforms,
  // .app paths never appear so it doesn't matter; on cross-builds, this
  // gate prevents flipFuses from crashing on a missing codesign.
  it("gates resetAdHocDarwinSignature on the build host being macOS", () => {
    expect(afterPack.FUSE_VALUES.resetAdHocDarwinSignature).toBe(process.platform === "darwin");
  });
});

describe("electron-builder.yml — afterPack hook", () => {
  // Confirm the YAML actually points at the .cjs file we tested above —
  // a renamed/moved hook would silently bypass the fuse step.
  const config = load(
    readFileSync(join(process.cwd(), "electron-builder.yml"), "utf-8"),
  ) as { afterPack?: string };

  it("references electron/afterPack.cjs", () => {
    expect(config.afterPack).toBe("./electron/afterPack.cjs");
  });
});
