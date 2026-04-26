import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { StyleRules } from "@/lib/style";

export type UpdatesConfig = {
  checkOnLaunch: boolean;
  lastCheckedAt?: string; // ISO timestamp
};

export type Config = {
  apiKey?: string;
  defaultModel: string;
  bindHost: "127.0.0.1" | "0.0.0.0";
  theme: "light" | "dark" | "system";
  autoRecap: boolean;
  includeLastChapterFullText: boolean;
  styleDefaults?: StyleRules;
  updates?: UpdatesConfig;
};

export const DEFAULT_CONFIG: Config = {
  defaultModel: process.env.SCRIPTR_DEFAULT_MODEL ?? "grok-4-latest",
  bindHost: "127.0.0.1",
  theme: "system",
  autoRecap: true,
  includeLastChapterFullText: false,
  updates: { checkOnLaunch: true },
};

async function readConfigFile(dataDir: string): Promise<Partial<Config>> {
  try {
    const raw = await readFile(join(dataDir, "config.json"), "utf8");
    return JSON.parse(raw) as Partial<Config>;
  } catch {
    // no config.json (or unreadable config) — use defaults
    return {};
  }
}

function withEnvOverrides(cfg: Config): Config {
  if (process.env.XAI_API_KEY) {
    return { ...cfg, apiKey: process.env.XAI_API_KEY };
  }
  return cfg;
}

export async function loadConfig(dataDir: string): Promise<Config> {
  const fromFile = await readConfigFile(dataDir);
  const merged: Config = { ...DEFAULT_CONFIG, ...fromFile };
  return withEnvOverrides(merged);
}

export async function saveConfig(dataDir: string, partial: Partial<Config>): Promise<Config> {
  await mkdir(dataDir, { recursive: true });
  // Read file-backed config directly (without env overlays) so we never
  // accidentally persist env-only secrets (e.g. XAI_API_KEY) to disk.
  const currentFromFile = await readConfigFile(dataDir);
  const current: Config = { ...DEFAULT_CONFIG, ...currentFromFile };
  const next: Config = { ...current, ...partial };
  await writeFile(join(dataDir, "config.json"), JSON.stringify(next, null, 2));
  return withEnvOverrides(next);
}

export function effectiveDataDir(): string {
  return process.env.SCRIPTR_DATA_DIR ?? join(process.cwd(), "data");
}
