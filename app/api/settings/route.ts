import { type NextRequest } from "next/server";
import { ok, readJson } from "@/lib/api";
import { loadConfig, saveConfig, effectiveDataDir, type Config } from "@/lib/config";

function mask(key?: string) {
  if (!key) return undefined;
  const last4 = key.slice(-4);
  return `xai-••••${last4}`;
}

export async function GET() {
  const cfg = await loadConfig(effectiveDataDir());
  return ok({
    hasKey: Boolean(cfg.apiKey),
    keyPreview: mask(cfg.apiKey),
    defaultModel: cfg.defaultModel,
    bindHost: cfg.bindHost,
    theme: cfg.theme,
    autoRecap: cfg.autoRecap,
    includeLastChapterFullText: cfg.includeLastChapterFullText,
    styleDefaults: cfg.styleDefaults,
    updates: cfg.updates,
    isElectron: Boolean(process.versions.electron),
  });
}

export async function PUT(req: NextRequest) {
  const body = await readJson<Partial<Config>>(req);
  const allowed: (keyof Config)[] = [
    "apiKey", "defaultModel", "theme", "autoRecap", "includeLastChapterFullText", "styleDefaults", "updates",
  ];
  const patch: Partial<Config> = {};
  for (const k of allowed) if (k in body) (patch as Record<keyof Config, Config[keyof Config]>)[k] = body[k] as Config[keyof Config];
  // Empty-string apiKey means clear
  if (patch.apiKey === "") patch.apiKey = undefined;
  const next = await saveConfig(effectiveDataDir(), patch);
  return ok({ hasKey: Boolean(next.apiKey), keyPreview: mask(next.apiKey) });
}
