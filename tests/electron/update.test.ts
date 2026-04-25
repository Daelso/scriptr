import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isCheckEnabled } from "@/electron/update";

// This file's job: assert that when the user has updates disabled, the
// main process never enters the code path that contacts api.github.com.
// configureUpdater() is the only function that wires electron-updater up;
// main.ts gates that call behind isCheckEnabled(). So an unambiguous
// "isCheckEnabled returns false → configureUpdater is never called" is the
// cleanest privacy assertion we can make without spinning up Electron.

describe("update — isCheckEnabled (privacy gate)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "scriptr-update-gate-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns true when no config.json exists (default-on per DEFAULT_CONFIG)", async () => {
    expect(await isCheckEnabled(dir)).toBe(true);
  });

  it("returns true when config.json explicitly opts in", async () => {
    await writeFile(
      join(dir, "config.json"),
      JSON.stringify({ updates: { checkOnLaunch: true } }),
      "utf-8",
    );
    expect(await isCheckEnabled(dir)).toBe(true);
  });

  it("returns FALSE when config.json sets checkOnLaunch:false", async () => {
    await writeFile(
      join(dir, "config.json"),
      JSON.stringify({ updates: { checkOnLaunch: false } }),
      "utf-8",
    );
    expect(await isCheckEnabled(dir)).toBe(false);
  });

  it("treats absent updates field as opt-in (matches default)", async () => {
    await writeFile(join(dir, "config.json"), JSON.stringify({}), "utf-8");
    expect(await isCheckEnabled(dir)).toBe(true);
  });

  it("only `false` disables — any other value leaves updates on", async () => {
    // Defensive: catches a future regression where someone "fixes" the
    // !== false check to truthy-coerce and accidentally turns updates off
    // for users whose config has e.g. `checkOnLaunch: undefined` after a
    // partial settings PUT.
    for (const v of [undefined, null, 0, ""]) {
      await writeFile(
        join(dir, "config.json"),
        JSON.stringify({ updates: { checkOnLaunch: v } }),
        "utf-8",
      );
      expect(await isCheckEnabled(dir)).toBe(true);
    }
  });
});
