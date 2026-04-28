import { loadConfig } from "../lib/config";

export async function isCheckEnabled(dataDir: string): Promise<boolean> {
  const cfg = await loadConfig(dataDir);
  return cfg.updates?.checkOnLaunch !== false;
}
