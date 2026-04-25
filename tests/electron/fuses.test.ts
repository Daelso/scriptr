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
