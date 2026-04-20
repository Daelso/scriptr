import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, saveConfig, DEFAULT_CONFIG } from "@/lib/config";

async function withTemp(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "scriptr-"));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

describe("config", () => {
  const originalEnv = process.env;
  beforeEach(() => { process.env = { ...originalEnv }; });
  afterEach(() => { process.env = originalEnv; });

  it("returns defaults when no file or env exists", async () => {
    await withTemp(async (dir) => {
      delete process.env.XAI_API_KEY;
      const cfg = await loadConfig(dir);
      expect(cfg).toMatchObject(DEFAULT_CONFIG);
      expect(cfg.apiKey).toBeUndefined();
    });
  });

  it("reads apiKey from env when set", async () => {
    await withTemp(async (dir) => {
      process.env.XAI_API_KEY = "xai-fromenv";
      const cfg = await loadConfig(dir);
      expect(cfg.apiKey).toBe("xai-fromenv");
    });
  });

  it("env wins over config.json when both present", async () => {
    await withTemp(async (dir) => {
      await writeFile(join(dir, "config.json"), JSON.stringify({ apiKey: "xai-fromfile" }));
      process.env.XAI_API_KEY = "xai-fromenv";
      const cfg = await loadConfig(dir);
      expect(cfg.apiKey).toBe("xai-fromenv");
    });
  });

  it("config.json is used when env is absent", async () => {
    await withTemp(async (dir) => {
      await writeFile(join(dir, "config.json"), JSON.stringify({ apiKey: "xai-fromfile", defaultModel: "grok-4-fast" }));
      delete process.env.XAI_API_KEY;
      const cfg = await loadConfig(dir);
      expect(cfg.apiKey).toBe("xai-fromfile");
      expect(cfg.defaultModel).toBe("grok-4-fast");
    });
  });

  it("saveConfig persists provided fields", async () => {
    await withTemp(async (dir) => {
      await saveConfig(dir, { defaultModel: "grok-4-fast", apiKey: "xai-abc1234567890ab" });
      const { readFile } = await import("node:fs/promises");
      const raw = JSON.parse(await readFile(join(dir, "config.json"), "utf8"));
      expect(raw.defaultModel).toBe("grok-4-fast");
      expect(raw.apiKey).toBe("xai-abc1234567890ab");
    });
  });
});
