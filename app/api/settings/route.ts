import { type NextRequest } from "next/server";
import { fail, JsonParseError, ok, readJson } from "@/lib/api";
import {
  loadConfig,
  saveConfig,
  effectiveDataDir,
  type Config,
  type PenNameProfile,
  type UpdatesConfig,
} from "@/lib/config";
import type { StyleRules } from "@/lib/style";
import { probeWritableDir } from "@/lib/storage/dir-probe";

function mask(key?: string) {
  if (!key) return undefined;
  const last4 = key.slice(-4);
  return `xai-••••${last4}`;
}

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

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function parseStyleDefaults(value: unknown): ParseResult<StyleRules | undefined> {
  if (value === null) return { ok: true, value: undefined };
  if (!isPlainObject(value)) {
    return { ok: false, error: "styleDefaults must be an object" };
  }
  const out: StyleRules = {};
  for (const [key, raw] of Object.entries(value)) {
    if ((STYLE_BOOL_KEYS as string[]).includes(key)) {
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
          error: "styleDefaults.explicitness must be one of fade/suggestive/explicit/graphic",
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
      if (raw === null || raw === undefined) {
        continue;
      }
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

function parseUpdates(value: unknown): ParseResult<UpdatesConfig | undefined> {
  if (value === null) return { ok: true, value: undefined };
  if (!isPlainObject(value)) return { ok: false, error: "updates must be an object" };
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
      if (raw === null || raw === undefined) {
        continue;
      }
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

function parsePenNameProfiles(
  value: unknown,
): ParseResult<Record<string, PenNameProfile>> {
  if (!isPlainObject(value)) {
    return { ok: false, error: "penNameProfiles must be an object" };
  }
  const out = Object.create(null) as Record<string, PenNameProfile>;
  for (const [penName, raw] of Object.entries(value)) {
    if (isReservedObjectKey(penName)) {
      return { ok: false, error: `penNameProfiles contains reserved key: ${penName}` };
    }
    if (!isPlainObject(raw)) {
      return { ok: false, error: `penNameProfiles.${penName} must be an object` };
    }
    const profile: PenNameProfile = {};

    if (hasOwn(raw, "email")) {
      if (raw.email === null || raw.email === undefined) {
        // clear
      } else if (typeof raw.email === "string") {
        profile.email = raw.email;
      } else {
        return { ok: false, error: `penNameProfiles.${penName}.email must be a string` };
      }
    }

    if (hasOwn(raw, "mailingListUrl")) {
      if (raw.mailingListUrl === null || raw.mailingListUrl === undefined) {
        // clear
      } else if (typeof raw.mailingListUrl === "string") {
        profile.mailingListUrl = raw.mailingListUrl;
      } else {
        return {
          ok: false,
          error: `penNameProfiles.${penName}.mailingListUrl must be a string`,
        };
      }
    }

    if (hasOwn(raw, "defaultMessageHtml")) {
      if (raw.defaultMessageHtml === null || raw.defaultMessageHtml === undefined) {
        // clear
      } else if (typeof raw.defaultMessageHtml === "string") {
        profile.defaultMessageHtml = raw.defaultMessageHtml;
      } else {
        return {
          ok: false,
          error: `penNameProfiles.${penName}.defaultMessageHtml must be a string`,
        };
      }
    }

    out[penName] = profile;
  }
  return { ok: true, value: out };
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
    penNameProfiles: cfg.penNameProfiles,
    defaultExportDir: cfg.defaultExportDir,
    isElectron: Boolean(process.versions.electron),
  });
}

export async function PUT(req: NextRequest) {
  let body: unknown;
  try {
    body = await readJson<unknown>(req);
  } catch (err) {
    if (err instanceof JsonParseError) return fail(err.message, 400);
    throw err;
  }

  if (!isPlainObject(body)) {
    return fail("request body must be an object", 400);
  }

  const patch: Partial<Config> = {};

  if (hasOwn(body, "apiKey")) {
    if (body.apiKey === null || body.apiKey === "") {
      patch.apiKey = undefined;
    } else if (typeof body.apiKey === "string") {
      patch.apiKey = body.apiKey;
    } else {
      return fail("apiKey must be a string", 400);
    }
  }

  if (hasOwn(body, "defaultModel")) {
    if (typeof body.defaultModel !== "string" || body.defaultModel.trim() === "") {
      return fail("defaultModel must be a non-empty string", 400);
    }
    patch.defaultModel = body.defaultModel.trim();
  }

  if (hasOwn(body, "theme")) {
    if (body.theme !== "light" && body.theme !== "dark" && body.theme !== "system") {
      return fail("theme must be 'light', 'dark', or 'system'", 400);
    }
    patch.theme = body.theme;
  }

  if (hasOwn(body, "autoRecap")) {
    if (typeof body.autoRecap !== "boolean") {
      return fail("autoRecap must be a boolean", 400);
    }
    patch.autoRecap = body.autoRecap;
  }

  if (hasOwn(body, "includeLastChapterFullText")) {
    if (typeof body.includeLastChapterFullText !== "boolean") {
      return fail("includeLastChapterFullText must be a boolean", 400);
    }
    patch.includeLastChapterFullText = body.includeLastChapterFullText;
  }

  if (hasOwn(body, "styleDefaults")) {
    const parsed = parseStyleDefaults(body.styleDefaults);
    if (!parsed.ok) return fail(parsed.error, 400);
    patch.styleDefaults = parsed.value;
  }

  if (hasOwn(body, "updates")) {
    const parsed = parseUpdates(body.updates);
    if (!parsed.ok) return fail(parsed.error, 400);
    patch.updates = parsed.value;
  }

  if (hasOwn(body, "penNameProfiles")) {
    const parsed = parsePenNameProfiles(body.penNameProfiles);
    if (!parsed.ok) return fail(parsed.error, 400);
    patch.penNameProfiles = parsed.value;
  }

  if (hasOwn(body, "defaultExportDir")) {
    if (body.defaultExportDir === null || body.defaultExportDir === "") {
      patch.defaultExportDir = undefined;
    } else if (typeof body.defaultExportDir === "string") {
      const probe = await probeWritableDir(body.defaultExportDir);
      if (!probe.ok) {
        const detail =
          probe.reason === "not-absolute"
            ? "must be an absolute path"
            : probe.reason === "not-found"
            ? "directory does not exist"
            : probe.reason === "not-a-directory"
            ? "path is not a directory"
            : "directory is not writable";
        return fail(`defaultExportDir ${detail}`, 400);
      }
      patch.defaultExportDir = body.defaultExportDir;
    } else {
      return fail("defaultExportDir must be a string or null", 400);
    }
  }

  const next = await saveConfig(effectiveDataDir(), patch);
  return ok({
    hasKey: Boolean(next.apiKey),
    keyPreview: mask(next.apiKey),
    defaultExportDir: next.defaultExportDir ?? null,
  });
}
