import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { StyleRules } from "@/lib/style";
import { withPathLock, writeJsonAtomic } from "@/lib/fs-atomic";

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
  theme: "system",
  autoRecap: true,
  includeLastChapterFullText: false,
  updates: { checkOnLaunch: true },
};

type StyleBooleanKey =
  | "useContractions"
  | "noEmDashes"
  | "noSemicolons"
  | "noNotXButY"
  | "noRhetoricalQuestions"
  | "sensoryGrounding"
  | "consentBeats"
  | "adultsOnly"
  | "bodiesDirectlyNamed"
  | "rampArousal"
  | "interiorPOVInSex"
  | "noSuddenly"
  | "dialogueDuringSex"
  | "kinksAsLived"
  | "mandatoryAftermath"
  | "noBeganTo"
  | "noWeatherMirror"
  | "onePOVPerScene";

const STYLE_BOOL_KEYS: StyleBooleanKey[] = [
  "useContractions",
  "noEmDashes",
  "noSemicolons",
  "noNotXButY",
  "noRhetoricalQuestions",
  "sensoryGrounding",
  "consentBeats",
  "adultsOnly",
  "bodiesDirectlyNamed",
  "rampArousal",
  "interiorPOVInSex",
  "noSuddenly",
  "dialogueDuringSex",
  "kinksAsLived",
  "mandatoryAftermath",
  "noBeganTo",
  "noWeatherMirror",
  "onePOVPerScene",
];

function hasOwn<T extends object, K extends PropertyKey>(
  obj: T,
  key: K,
): obj is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isReservedObjectKey(key: string): boolean {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

function normalizeStyleRulesLoose(value: unknown): StyleRules | undefined {
  if (!isPlainObject(value)) return undefined;
  const out: StyleRules = {};
  for (const key of STYLE_BOOL_KEYS) {
    if (hasOwn(value, key) && typeof value[key] === "boolean") {
      out[key] = value[key];
    }
  }
  if (hasOwn(value, "tense") && (value.tense === "past" || value.tense === "present")) {
    out.tense = value.tense;
  }
  if (
    hasOwn(value, "explicitness")
    && (value.explicitness === "fade"
      || value.explicitness === "suggestive"
      || value.explicitness === "explicit"
      || value.explicitness === "graphic")
  ) {
    out.explicitness = value.explicitness;
  }
  if (
    hasOwn(value, "dialogueTags")
    && (value.dialogueTags === "prefer-said" || value.dialogueTags === "vary")
  ) {
    out.dialogueTags = value.dialogueTags;
  }
  if (hasOwn(value, "customRules") && typeof value.customRules === "string") {
    out.customRules = value.customRules;
  }
  return out;
}

function normalizeUpdatesLoose(value: unknown): UpdatesConfig | undefined {
  if (!isPlainObject(value)) return undefined;
  const out: UpdatesConfig = {
    checkOnLaunch:
      typeof value.checkOnLaunch === "boolean"
        ? value.checkOnLaunch
        : DEFAULT_CONFIG.updates?.checkOnLaunch ?? true,
  };
  if (typeof value.lastCheckedAt === "string") {
    out.lastCheckedAt = value.lastCheckedAt;
  }
  return out;
}

function normalizePenNameProfilesLoose(
  value: unknown,
): Record<string, PenNameProfile> | undefined {
  if (!isPlainObject(value)) return undefined;
  const out = Object.create(null) as Record<string, PenNameProfile>;
  for (const [penName, rawProfile] of Object.entries(value)) {
    if (isReservedObjectKey(penName)) continue;
    if (!isPlainObject(rawProfile)) continue;
    const profile: PenNameProfile = {};
    if (typeof rawProfile.email === "string") {
      profile.email = rawProfile.email;
    }
    if (typeof rawProfile.mailingListUrl === "string") {
      profile.mailingListUrl = rawProfile.mailingListUrl;
    }
    if (typeof rawProfile.defaultMessageHtml === "string") {
      profile.defaultMessageHtml = rawProfile.defaultMessageHtml;
    }
    out[penName] = profile;
  }
  return out;
}

function normalizeConfigFromFile(value: unknown): Partial<Config> {
  if (!isPlainObject(value)) return {};
  const out: Partial<Config> = {};
  if (typeof value.apiKey === "string") out.apiKey = value.apiKey;
  if (typeof value.defaultModel === "string" && value.defaultModel.trim().length > 0) {
    out.defaultModel = value.defaultModel;
  }
  if (value.bindHost === "127.0.0.1" || value.bindHost === "0.0.0.0") {
    out.bindHost = value.bindHost;
  }
  if (value.theme === "light" || value.theme === "dark" || value.theme === "system") {
    out.theme = value.theme;
  }
  if (typeof value.autoRecap === "boolean") out.autoRecap = value.autoRecap;
  if (typeof value.includeLastChapterFullText === "boolean") {
    out.includeLastChapterFullText = value.includeLastChapterFullText;
  }

  const styleDefaults = normalizeStyleRulesLoose(value.styleDefaults);
  if (styleDefaults !== undefined) out.styleDefaults = styleDefaults;

  const updates = normalizeUpdatesLoose(value.updates);
  if (updates !== undefined) out.updates = updates;

  const profiles = normalizePenNameProfilesLoose(value.penNameProfiles);
  if (profiles !== undefined) out.penNameProfiles = profiles;

  return out;
}

async function readConfigFile(dataDir: string): Promise<Partial<Config>> {
  try {
    const raw = await readFile(join(dataDir, "config.json"), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return normalizeConfigFromFile(parsed);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && !(err instanceof SyntaxError)) {
      throw err;
    }
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
  const merged: Config = {
    ...DEFAULT_CONFIG,
    ...fromFile,
  };
  return withEnvOverrides(merged);
}

function mergeConfig(current: Config, partial: Partial<Config>): Config {
  const next: Config = { ...current };
  if (hasOwn(partial, "apiKey")) next.apiKey = partial.apiKey;
  if (hasOwn(partial, "defaultModel") && partial.defaultModel !== undefined) {
    next.defaultModel = partial.defaultModel;
  }
  if (hasOwn(partial, "bindHost") && partial.bindHost !== undefined) {
    next.bindHost = partial.bindHost;
  }
  if (hasOwn(partial, "theme") && partial.theme !== undefined) {
    next.theme = partial.theme;
  }
  if (hasOwn(partial, "autoRecap") && partial.autoRecap !== undefined) {
    next.autoRecap = partial.autoRecap;
  }
  if (
    hasOwn(partial, "includeLastChapterFullText")
    && partial.includeLastChapterFullText !== undefined
  ) {
    next.includeLastChapterFullText = partial.includeLastChapterFullText;
  }
  if (hasOwn(partial, "styleDefaults")) {
    next.styleDefaults = partial.styleDefaults;
  }
  if (hasOwn(partial, "updates")) {
    next.updates = partial.updates;
  }
  if (hasOwn(partial, "penNameProfiles")) {
    next.penNameProfiles = partial.penNameProfiles;
  }
  return next;
}

export async function saveConfig(dataDir: string, partial: Partial<Config>): Promise<Config> {
  await mkdir(dataDir, { recursive: true });
  const configPath = join(dataDir, "config.json");
  return withPathLock(configPath, async () => {
    // Read file-backed config directly (without env overlays) so we never
    // accidentally persist env-only secrets (e.g. XAI_API_KEY) to disk.
    const currentFromFile = await readConfigFile(dataDir);
    const current: Config = { ...DEFAULT_CONFIG, ...currentFromFile };
    const next = mergeConfig(current, partial);
    await writeJsonAtomic(configPath, next);
    return withEnvOverrides(next);
  });
}

export function effectiveDataDir(): string {
  return process.env.SCRIPTR_DATA_DIR ?? join(process.cwd(), "data");
}
