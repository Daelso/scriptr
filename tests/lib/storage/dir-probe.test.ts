import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, chmod, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeWritableDir } from "@/lib/storage/dir-probe";

describe("probeWritableDir", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "scriptr-probe-"));
  });
  afterEach(async () => {
    await chmod(tmp, 0o755).catch(() => {});
    await rm(tmp, { recursive: true, force: true });
  });

  it("returns ok for an absolute, existing, writable directory", async () => {
    const result = await probeWritableDir(tmp);
    expect(result).toEqual({ ok: true });
  });

  it("returns 'not-absolute' for a relative path", async () => {
    const result = await probeWritableDir("./relative/path");
    expect(result).toEqual({ ok: false, reason: "not-absolute" });
  });

  it("returns 'not-found' when the directory does not exist", async () => {
    const result = await probeWritableDir(join(tmp, "missing"));
    expect(result).toEqual({ ok: false, reason: "not-found" });
  });

  it("returns 'not-a-directory' when the path is a file", async () => {
    const file = join(tmp, "afile");
    await writeFile(file, "x");
    const result = await probeWritableDir(file);
    expect(result).toEqual({ ok: false, reason: "not-a-directory" });
  });

  it("returns 'not-writable' when chmod 555 makes the dir read-only (POSIX)", async () => {
    if (process.platform === "win32") return; // chmod semantics differ on Windows
    const ro = join(tmp, "readonly");
    await mkdir(ro);
    await chmod(ro, 0o555);
    const result = await probeWritableDir(ro);
    expect(result).toEqual({ ok: false, reason: "not-writable" });
  });

  it("cleans up the probe file even on success (no leftover .scriptr-write-probe-* files)", async () => {
    await probeWritableDir(tmp);
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(tmp);
    expect(entries.filter((e) => e.startsWith(".scriptr-write-probe-"))).toEqual([]);
  });
});
