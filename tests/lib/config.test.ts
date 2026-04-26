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

  it("saveConfig does not persist env apiKey when saving unrelated fields", async () => {
    await withTemp(async (dir) => {
      process.env.XAI_API_KEY = "xai-from-env";
      await saveConfig(dir, { theme: "dark" });

      const { readFile } = await import("node:fs/promises");
      const raw = JSON.parse(await readFile(join(dir, "config.json"), "utf8"));
      expect(raw.theme).toBe("dark");
      expect(raw.apiKey).toBeUndefined();
    });
  });

  it("persists and reloads styleDefaults", async () => {
    await withTemp(async (dir) => {
      await saveConfig(dir, { styleDefaults: { tense: "present", noEmDashes: false } });
      delete process.env.XAI_API_KEY;
      const cfg = await loadConfig(dir);
      expect(cfg.styleDefaults).toEqual({ tense: "present", noEmDashes: false });
    });
  });

  it("leaves styleDefaults undefined when not saved", async () => {
    await withTemp(async (dir) => {
      delete process.env.XAI_API_KEY;
      const cfg = await loadConfig(dir);
      expect(cfg.styleDefaults).toBeUndefined();
    });
  });
});

describe("config — updates settings", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "scriptr-config-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("defaults updates.checkOnLaunch to true", () => {
    expect(DEFAULT_CONFIG.updates?.checkOnLaunch).toBe(true);
  });

  it("defaults updates.lastCheckedAt to undefined", () => {
    expect(DEFAULT_CONFIG.updates?.lastCheckedAt).toBeUndefined();
  });

  it("persists updates.checkOnLaunch false across save/load", async () => {
    await saveConfig(dir, { updates: { checkOnLaunch: false } });
    const loaded = await loadConfig(dir);
    expect(loaded.updates?.checkOnLaunch).toBe(false);
  });

  it("persists updates.lastCheckedAt across save/load", async () => {
    const ts = "2026-04-24T10:00:00.000Z";
    await saveConfig(dir, { updates: { checkOnLaunch: true, lastCheckedAt: ts } });
    const loaded = await loadConfig(dir);
    expect(loaded.updates?.lastCheckedAt).toBe(ts);
  });

  it("round-trips penNameProfiles through saveConfig/loadConfig", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scriptr-config-"));
    try {
      await saveConfig(dir, {
        penNameProfiles: {
          "Jane Doe": {
            email: "jane@example.com",
            mailingListUrl: "https://list.example.com/jane",
            defaultMessageHtml: "<p>Thanks!</p>",
          },
        },
      });
      const loaded = await loadConfig(dir);
      expect(loaded.penNameProfiles).toEqual({
        "Jane Doe": {
          email: "jane@example.com",
          mailingListUrl: "https://list.example.com/jane",
          defaultMessageHtml: "<p>Thanks!</p>",
        },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("serializes concurrent saveConfig calls so fields are not lost", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scriptr-config-race-"));
    try {
      for (let i = 0; i < 20; i += 1) {
        await saveConfig(dir, { theme: "system", defaultModel: "grok-4-latest" });
        await Promise.all([
          saveConfig(dir, { theme: "dark" }),
          saveConfig(dir, { defaultModel: `grok-4-fast-${i}` }),
        ]);
        const loaded = await loadConfig(dir);
        expect(loaded.theme).toBe("dark");
        expect(loaded.defaultModel).toBe(`grok-4-fast-${i}`);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
