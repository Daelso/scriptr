import { type NextRequest } from "next/server";
import { fail, JsonParseError, ok, readJson } from "@/lib/api";
import { loadConfig, saveConfig, effectiveDataDir, type Config } from "@/lib/config";
import type { StyleRules } from "@/lib/style";

function mask(key?: string) {
  if (!key) return undefined;
  const last4 = key.slice(-4);
  return `xai-••••${last4}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const BOOLEAN_STYLE_KEYS = new Set<keyof StyleRules>([
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
]);

function parseStyleRules(value: unknown): { ok: true; value: StyleRules } | { ok: false; error: string } {
  if (!isRecord(value)) {
    return { ok: false, error: "styleDefaults must be an object" };
  }
  const out: StyleRules = {};
  for (const [key, raw] of Object.entries(value)) {
    if (BOOLEAN_STYLE_KEYS.has(key as keyof StyleRules)) {
      if (typeof raw !== "boolean") {
        return { ok: false, error: `styleDefaults.${key} must be a boolean` };
      }
      (out as Record<string, unknown>)[key] = raw;
      continue;
    }
    if (key === "tense") {
      if (raw !== "past" && raw !== "present") {
        return { ok: false, error: "styleDefaults.tense must be 'past' or 'present'" };
      }
      out.tense = raw;
      continue;
    }
    if (key === "explicitness") {
      if (raw !== "fade" && raw !== "suggestive" && raw !== "explicit" && raw !== "graphic") {
        return {
          ok: false,
          error: "styleDefaults.explicitness must be 'fade', 'suggestive', 'explicit', or 'graphic'",
        };
      }
      out.explicitness = raw;
      continue;
    }
    if (key === "dialogueTags") {
      if (raw !== "prefer-said" && raw !== "vary") {
        return { ok: false, error: "styleDefaults.dialogueTags must be 'prefer-said' or 'vary'" };
      }
      out.dialogueTags = raw;
      continue;
    }
    if (key === "customRules") {
      if (typeof raw !== "string") {
        return { ok: false, error: "styleDefaults.customRules must be a string" };
      }
      out.customRules = raw;
      continue;
    }
    return { ok: false, error: `styleDefaults contains unknown field: ${key}` };
  }
  return { ok: true, value: out };
}

function parseUpdates(value: unknown): { ok: true; value: Config["updates"] } | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: "updates must be an object" };
  let checkOnLaunch: boolean | undefined;
  let lastCheckedAt: string | undefined;
  for (const [key, raw] of Object.entries(value)) {
    if (key === "checkOnLaunch") {
      if (typeof raw !== "boolean") {
        return { ok: false, error: "updates.checkOnLaunch must be a boolean" };
      }
      checkOnLaunch = raw;
      continue;
    }
    if (key === "lastCheckedAt") {
      if (typeof raw !== "string") {
        return { ok: false, error: "updates.lastCheckedAt must be a string" };
      }
      lastCheckedAt = raw;
      continue;
    }
    return { ok: false, error: `updates contains unknown field: ${key}` };
  }
  if (checkOnLaunch === undefined) {
    return { ok: false, error: "updates.checkOnLaunch is required when updates is provided" };
  }
  return { ok: true, value: { checkOnLaunch, lastCheckedAt } };
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
  let body: Partial<Config>;
  try {
    body = await readJson<Partial<Config>>(req);
  } catch (err) {
    if (err instanceof JsonParseError) return fail(err.message, 400);
    throw err;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail("request body must be an object", 400);
  }
  const allowed: (keyof Config)[] = [
    "apiKey", "defaultModel", "theme", "autoRecap", "includeLastChapterFullText", "styleDefaults", "updates",
  ];
  const patch: Partial<Config> = {};

  for (const k of allowed) {
    if (!(k in body)) continue;
    const value = body[k];
    if (k === "apiKey") {
      if (typeof value !== "string") return fail("apiKey must be a string", 400);
      patch.apiKey = value;
      continue;
    }
    if (k === "defaultModel") {
      if (typeof value !== "string" || value.trim() === "") {
        return fail("defaultModel must be a non-empty string", 400);
      }
      patch.defaultModel = value.trim();
      continue;
    }
    if (k === "theme") {
      if (value !== "light" && value !== "dark" && value !== "system") {
        return fail("theme must be 'light', 'dark', or 'system'", 400);
      }
      patch.theme = value;
      continue;
    }
    if (k === "autoRecap") {
      if (typeof value !== "boolean") return fail("autoRecap must be a boolean", 400);
      patch.autoRecap = value;
      continue;
    }
    if (k === "includeLastChapterFullText") {
      if (typeof value !== "boolean") {
        return fail("includeLastChapterFullText must be a boolean", 400);
      }
      patch.includeLastChapterFullText = value;
      continue;
    }
    if (k === "styleDefaults") {
      const parsed = parseStyleRules(value);
      if (!parsed.ok) return fail(parsed.error, 400);
      patch.styleDefaults = parsed.value;
      continue;
    }
    if (k === "updates") {
      const parsed = parseUpdates(value);
      if (!parsed.ok) return fail(parsed.error, 400);
      patch.updates = parsed.value;
      continue;
    }
  }
  // Empty-string apiKey means clear
  if (patch.apiKey === "") patch.apiKey = undefined;
  const next = await saveConfig(effectiveDataDir(), patch);
  return ok({ hasKey: Boolean(next.apiKey), keyPreview: mask(next.apiKey) });
}
