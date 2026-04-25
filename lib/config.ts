import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { StyleRules } from "@/lib/style";

export type UpdatesConfig = {
  checkOnLaunch: boolean;
  lastCheckedAt?: string; // ISO timestamp
};

export type PenNameProfile = {
  email?: string;
  mailingListUrl?: string;
  defaultMessageHtml?: string;
};

export type Config = {
  apiKey?: string;
  defaultModel: string;
  bindHost: "127.0.0.1" | "0.0.0.0";
  bindPort: number;
  theme: "light" | "dark" | "system";
  autoRecap: boolean;
  includeLastChapterFullText: boolean;
  styleDefaults?: StyleRules;
  updates?: UpdatesConfig;
  penNameProfiles?: Record<string, PenNameProfile>;
};

export const DEFAULT_CONFIG: Config = {
  defaultModel: process.env.SCRIPTR_DEFAULT_MODEL ?? "grok-4-latest",
  bindHost: "127.0.0.1",
  bindPort: 3000,
  theme: "system",
  autoRecap: true,
  includeLastChapterFullText: false,
  updates: { checkOnLaunch: true },
};

export async function loadConfig(dataDir: string): Promise<Config> {
  let fromFile: Partial<Config> = {};
  try {
    const raw = await readFile(join(dataDir, "config.json"), "utf8");
    fromFile = JSON.parse(raw);
  } catch {
    // no config.json — fine
  }
  const merged: Config = { ...DEFAULT_CONFIG, ...fromFile };
  if (process.env.XAI_API_KEY) merged.apiKey = process.env.XAI_API_KEY;
  return merged;
}

export async function saveConfig(dataDir: string, partial: Partial<Config>): Promise<Config> {
  await mkdir(dataDir, { recursive: true });
  const current = await loadConfig(dataDir);
  const next = { ...current, ...partial };
  await writeFile(join(dataDir, "config.json"), JSON.stringify(next, null, 2));
  return next;
}

export function effectiveDataDir(): string {
  return process.env.SCRIPTR_DATA_DIR ?? join(process.cwd(), "data");
}
