import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { createUpdateController } from "@/electron/update-controller";

// Fake autoUpdater: an EventEmitter with stubbed methods. The real
// electron-updater module exports a long-lived singleton with this same
// shape (on/off + checkForUpdates + quitAndInstall + autoDownload +
// autoInstallOnAppQuit).
function makeFakeUpdater() {
  const ee = new EventEmitter();
  return Object.assign(ee, {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    checkForUpdates: vi.fn(async () => ({ updateInfo: { version: "0.0.0" } })),
    quitAndInstall: vi.fn(),
  });
}

describe("UpdateController", () => {
  let dir: string;
  let fakeUpdater: ReturnType<typeof makeFakeUpdater>;
  let broadcasts: unknown[];
  let controller: ReturnType<typeof createUpdateController>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "scriptr-update-controller-"));
    fakeUpdater = makeFakeUpdater();
    broadcasts = [];
    controller = createUpdateController({
      dataDir: dir,
      autoUpdater: fakeUpdater,
      getCurrentVersion: () => "0.3.0",
      broadcast: (s) => broadcasts.push(s),
    });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("starts in idle with no lastCheckedAt and the current version", () => {
    const s = controller.getState();
    expect(s).toEqual({ kind: "idle", lastCheckedAt: null, currentVersion: "0.3.0" });
  });

  it("configures autoDownload + autoInstallOnAppQuit on creation", () => {
    expect(fakeUpdater.autoDownload).toBe(true);
    expect(fakeUpdater.autoInstallOnAppQuit).toBe(true);
  });

  it("checking → idle on update-not-available, stamps lastCheckedAt", async () => {
    const p = controller.checkNow();
    expect(controller.getState().kind).toBe("checking");
    fakeUpdater.emit("update-not-available", { version: "0.3.0" });
    await p;
    const s = controller.getState();
    expect(s.kind).toBe("idle");
    if (s.kind === "idle") {
      expect(s.lastCheckedAt).not.toBeNull();
    }
    // Persisted to config.json
    const cfg = JSON.parse(await readFile(join(dir, "config.json"), "utf8"));
    expect(typeof cfg.updates.lastCheckedAt).toBe("string");
  });

  it("checking → downloading on update-available; downloading → downloaded on update-downloaded; lastCheckedAt stamped at downloaded", async () => {
    const p = controller.checkNow();
    fakeUpdater.emit("update-available", { version: "0.3.1" });
    expect(controller.getState()).toEqual({ kind: "downloading", version: "0.3.1" });
    fakeUpdater.emit("update-downloaded", { version: "0.3.1" });
    await p;
    expect(controller.getState()).toEqual({ kind: "downloaded", version: "0.3.1" });
    const cfg = JSON.parse(await readFile(join(dir, "config.json"), "utf8"));
    expect(typeof cfg.updates.lastCheckedAt).toBe("string");
  });

  it("checking → error does NOT stamp lastCheckedAt", async () => {
    const p = controller.checkNow();
    fakeUpdater.emit("error", new Error("offline"));
    await p;
    const s = controller.getState();
    expect(s.kind).toBe("error");
    // No config.json should have been written
    await expect(readFile(join(dir, "config.json"), "utf8")).rejects.toThrow();
  });

  it("downloading → error transitions when error event fires mid-download", async () => {
    const p = controller.checkNow();
    fakeUpdater.emit("update-available", { version: "0.3.1" });
    expect(controller.getState().kind).toBe("downloading");
    fakeUpdater.emit("error", new Error("download truncated"));
    await p;
    const s = controller.getState();
    expect(s.kind).toBe("error");
    if (s.kind === "error") expect(s.message).toContain("download truncated");
  });

  it("error → checking on next checkNow (recovery path)", async () => {
    const p1 = controller.checkNow();
    fakeUpdater.emit("error", new Error("offline"));
    await p1;
    expect(controller.getState().kind).toBe("error");

    const p2 = controller.checkNow();
    expect(controller.getState().kind).toBe("checking");
    fakeUpdater.emit("update-not-available", {});
    await p2;
    expect(controller.getState().kind).toBe("idle");
  });

  it("checkNow while checking is a no-op (no second checkForUpdates call)", async () => {
    const p1 = controller.checkNow();
    expect(fakeUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    // The no-op call resolves to the *current* state ({ kind: "checking" }) —
    // it does NOT wait for the in-flight check to settle.
    const p2 = controller.checkNow();
    expect(fakeUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(await p2).toEqual({ kind: "checking" });
    fakeUpdater.emit("update-not-available", {});
    await p1;
  });

  it("checkNow while downloading is a no-op", async () => {
    const p = controller.checkNow();
    fakeUpdater.emit("update-available", { version: "0.3.1" });
    expect(controller.getState().kind).toBe("downloading");
    const before = fakeUpdater.checkForUpdates.mock.calls.length;
    await controller.checkNow();
    expect(fakeUpdater.checkForUpdates.mock.calls.length).toBe(before);
    expect(controller.getState().kind).toBe("downloading");
    fakeUpdater.emit("update-downloaded", { version: "0.3.1" });
    await p;
  });

  it("checkNow while downloaded is a no-op (returns downloaded unchanged)", async () => {
    const p = controller.checkNow();
    fakeUpdater.emit("update-available", { version: "0.3.1" });
    fakeUpdater.emit("update-downloaded", { version: "0.3.1" });
    await p;
    expect(controller.getState().kind).toBe("downloaded");
    const before = fakeUpdater.checkForUpdates.mock.calls.length;
    await controller.checkNow();
    expect(fakeUpdater.checkForUpdates.mock.calls.length).toBe(before);
    expect(controller.getState().kind).toBe("downloaded");
  });

  it("installNow from downloaded calls quitAndInstall", async () => {
    const p = controller.checkNow();
    fakeUpdater.emit("update-available", { version: "0.3.1" });
    fakeUpdater.emit("update-downloaded", { version: "0.3.1" });
    await p;
    await controller.installNow();
    expect(fakeUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it("installNow from non-downloaded states is a no-op", async () => {
    // From idle
    await controller.installNow();
    expect(fakeUpdater.quitAndInstall).not.toHaveBeenCalled();

    // From error
    const p = controller.checkNow();
    fakeUpdater.emit("error", new Error("offline"));
    await p;
    await controller.installNow();
    expect(fakeUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("broadcasts state on every transition; not on no-op calls", async () => {
    broadcasts.length = 0;
    const p = controller.checkNow();
    expect(broadcasts.at(-1)).toMatchObject({ kind: "checking" });

    // No-op while checking — should NOT push another broadcast
    const before = broadcasts.length;
    await controller.checkNow();
    expect(broadcasts.length).toBe(before);

    fakeUpdater.emit("update-not-available", {});
    await p;
    expect(broadcasts.at(-1)).toMatchObject({ kind: "idle" });
  });

  it("uses the version from update-downloaded event, not the prior downloading state", async () => {
    const p = controller.checkNow();
    fakeUpdater.emit("update-available", { version: "0.3.1" });
    // Simulate electron-updater swapping the version (rare but defensive)
    fakeUpdater.emit("update-downloaded", { version: "0.3.2" });
    await p;
    expect(controller.getState()).toEqual({ kind: "downloaded", version: "0.3.2" });
  });

  it("treats update-downloaded fired during checking (cached) as downloaded + stamps lastCheckedAt", async () => {
    const p = controller.checkNow();
    fakeUpdater.emit("update-downloaded", { version: "0.3.1" });
    await p;
    expect(controller.getState()).toEqual({ kind: "downloaded", version: "0.3.1" });
    const cfg = JSON.parse(await readFile(join(dir, "config.json"), "utf8"));
    expect(typeof cfg.updates.lastCheckedAt).toBe("string");
  });

  // ── Logging + error surfacing (added with the v0.7.x update-debug fix) ──

  it("error during checking surfaces the [code] suffix and 'while checking for updates'", async () => {
    const p = controller.checkNow();
    fakeUpdater.emit("error", Object.assign(new Error("getaddrinfo failed"), { code: "ENOTFOUND" }));
    await p;
    const s = controller.getState();
    expect(s.kind).toBe("error");
    if (s.kind === "error") {
      expect(s.message).toContain("getaddrinfo failed");
      expect(s.message).toContain("[ENOTFOUND]");
      expect(s.message).toContain("while checking for updates");
    }
  });

  it("error during downloading surfaces 'while downloading' so user sees the phase", async () => {
    const p = controller.checkNow();
    fakeUpdater.emit("update-available", { version: "9.9.9" });
    expect(controller.getState().kind).toBe("downloading");
    fakeUpdater.emit(
      "error",
      Object.assign(new Error("connection reset"), { code: "ECONNRESET" }),
    );
    await p;
    const s = controller.getState();
    expect(s.kind).toBe("error");
    if (s.kind === "error") {
      expect(s.message).toContain("connection reset");
      expect(s.message).toContain("[ECONNRESET]");
      expect(s.message).toContain("while downloading");
    }
  });

  it("forwards every transition to the optional logger", async () => {
    const lines: Array<{ level: string; msg: unknown }> = [];
    const logger = {
      info: (m: unknown) => lines.push({ level: "info", msg: m }),
      warn: (m: unknown) => lines.push({ level: "warn", msg: m }),
      error: (m: unknown) => lines.push({ level: "error", msg: m }),
    };
    const c = createUpdateController({
      dataDir: dir,
      autoUpdater: fakeUpdater,
      getCurrentVersion: () => "0.3.0",
      broadcast: () => {},
      logger,
    });

    const p = c.checkNow();
    fakeUpdater.emit("update-available", { version: "0.4.0" });
    fakeUpdater.emit("download-progress", { percent: 50, transferred: 50, total: 100 });
    fakeUpdater.emit("update-downloaded", { version: "0.4.0" });
    await p;

    const dump = lines.map((l) => `${l.level}: ${l.msg}`).join("\n");
    expect(dump).toMatch(/info: checkNow starting/);
    expect(dump).toMatch(/info: event: update-available/);
    expect(dump).toMatch(/info: event: download-progress/);
    expect(dump).toMatch(/info: event: update-downloaded/);
  });

  it("logs errors that arrive after settling (debugging breadcrumb), without re-transitioning", async () => {
    const errors: unknown[] = [];
    const c = createUpdateController({
      dataDir: dir,
      autoUpdater: fakeUpdater,
      getCurrentVersion: () => "0.3.0",
      broadcast: () => {},
      logger: { info: () => {}, warn: () => {}, error: (m) => errors.push(m) },
    });
    const p = c.checkNow();
    fakeUpdater.emit("update-not-available", { version: "0.3.0" });
    await p;
    // Late error after we've already settled to idle. Used to be silently
    // swallowed; we now log it so the user has a breadcrumb when they
    // open the log file.
    fakeUpdater.emit("error", new Error("orphan late error"));
    expect(c.getState().kind).toBe("idle");
    expect(errors.some((e) => e instanceof Error && e.message === "orphan late error")).toBe(true);
  });
});
