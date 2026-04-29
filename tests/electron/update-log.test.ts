import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUpdateLogger, readUpdateLog } from "@/electron/update-log";
import { updatesLog } from "@/lib/storage/paths";

// The update logger writes to data/logs/updates.log. These tests pin the
// disk format (so a future "fix" doesn't quietly stop emitting the error
// code we depend on for diagnosis), the rotation behavior (so a stuck
// loop doesn't fill the disk), and the readUpdateLog helper used by the
// "View update log" affordance.


describe("createUpdateLogger", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "scriptr-update-log-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes ISO-timestamped TAB-separated lines under data/logs/updates.log", async () => {
    const log = createUpdateLogger(dir);
    log.info("hello");
    log.warn("careful");
    log.error("boom");
    log.debug("trace");
    await log.flush();

    const raw = await readFile(updatesLog(dir), "utf-8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(4);
    for (const line of lines) {
      expect(line).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\t(INFO|WARN|ERROR|DEBUG)\t/);
    }
    expect(lines[0]).toContain("\tINFO\thello");
    expect(lines[1]).toContain("\tWARN\tcareful");
    expect(lines[2]).toContain("\tERROR\tboom");
    expect(lines[3]).toContain("\tDEBUG\ttrace");
  });

  it("serialises Error instances with .message + .code suffix + stack", async () => {
    const log = createUpdateLogger(dir);
    const err = Object.assign(new Error("net unreachable"), { code: "ENOTFOUND" });
    log.error(err);
    await log.flush();

    const raw = await readFile(updatesLog(dir), "utf-8");
    expect(raw).toContain("net unreachable");
    expect(raw).toContain("[ENOTFOUND]");
    // Stack trace is multi-line; we don't pin contents, just presence.
    expect(raw.split("\n").length).toBeGreaterThan(1);
  });

  it("omits the [code] suffix when Error has no code", async () => {
    const log = createUpdateLogger(dir);
    log.error(new Error("bare"));
    await log.flush();
    const raw = await readFile(updatesLog(dir), "utf-8");
    expect(raw).toContain("bare");
    expect(raw).not.toMatch(/\[\]/);
  });

  it("exposes the path field as the path that will be written", () => {
    const log = createUpdateLogger(dir);
    expect(log.path).toBe(updatesLog(dir));
  });

  it("rotates to .1 once the file passes ~256KB", async () => {
    const log = createUpdateLogger(dir);
    // Each call writes >100 bytes (timestamp + payload + level + tab + nl).
    // ~3000 lines of a 100-byte payload sails past the 256KB cap and
    // forces a rotation. Use a fixed payload so the byte budget is
    // predictable across machines.
    const payload = "x".repeat(120);
    for (let i = 0; i < 3000; i += 1) {
      log.info(payload);
    }
    await log.flush();

    const main = await stat(updatesLog(dir));
    const rotated = await stat(`${updatesLog(dir)}.1`);
    expect(rotated.size).toBeGreaterThan(0);
    // The post-rotation main file holds only the writes that landed
    // after the rotation, so it must be smaller than the cap.
    expect(main.size).toBeLessThan(rotated.size + 200_000);
  });

  it("readUpdateLog returns '' before the first write", async () => {
    expect(await readUpdateLog(dir)).toBe("");
  });

  it("readUpdateLog returns the current log contents after writes", async () => {
    const log = createUpdateLogger(dir);
    log.info("one");
    log.info("two");
    await log.flush();
    const raw = await readUpdateLog(dir);
    expect(raw).toContain("one");
    expect(raw).toContain("two");
  });
});
