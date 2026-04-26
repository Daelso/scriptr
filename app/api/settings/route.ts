import { type NextRequest } from "next/server";
import { ok, readJson } from "@/lib/api";
import {
  loadConfig,
  saveConfig,
  effectiveDataDir,
  type Config,
  type PenNameProfile,
  type UpdatesConfig,
} from "@/lib/config";
import type { StyleRules } from "@/lib/style";

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

type ParseOk<T> = { ok: true; value: T };
type ParseErr = { ok: false; error: string };
type ParseResult<T> = ParseOk<T> | ParseErr;

function parseStyleDefaults(value: unknown): ParseResult<StyleRules | undefined> {
  if (value === null) return { ok: true, value: undefined };
  if (!isPlainObject(value)) {
    return { ok: false, error: "styleDefaults must be an object" };
  }
  const out: StyleRules = {};
  for (const key of STYLE_BOOL_KEYS) {
    if (!hasOwn(value, key)) continue;
    if (typeof value[key] !== "boolean") {
      return { ok: false, error: `styleDefaults.${String(key)} must be a boolean` };
    }
    out[key] = value[key];
  }
  if (hasOwn(value, "tense")) {
    if (value.tense !== "past" && value.tense !== "present") {
      return { ok: false, error: "styleDefaults.tense must be 'past' or 'present'" };
    }
    out.tense = value.tense;
  }
  if (hasOwn(value, "explicitness")) {
    if (
      value.explicitness !== "fade"
      && value.explicitness !== "suggestive"
      && value.explicitness !== "explicit"
      && value.explicitness !== "graphic"
    ) {
      return {
        ok: false,
        error: "styleDefaults.explicitness must be one of fade/suggestive/explicit/graphic",
      };
    }
    out.explicitness = value.explicitness;
  }
  if (hasOwn(value, "dialogueTags")) {
    if (value.dialogueTags !== "prefer-said" && value.dialogueTags !== "vary") {
      return { ok: false, error: "styleDefaults.dialogueTags must be 'prefer-said' or 'vary'" };
    }
    out.dialogueTags = value.dialogueTags;
  }
  if (hasOwn(value, "customRules")) {
    if (value.customRules === null || value.customRules === undefined) {
      // explicit null/undefined clears customRules
    } else if (typeof value.customRules === "string") {
      out.customRules = value.customRules;
    } else {
      return { ok: false, error: "styleDefaults.customRules must be a string" };
    }
  }
  return { ok: true, value: out };
}

function parseUpdates(value: unknown): ParseResult<UpdatesConfig | undefined> {
  if (value === null) return { ok: true, value: undefined };
  if (!isPlainObject(value)) return { ok: false, error: "updates must be an object" };
  if (!hasOwn(value, "checkOnLaunch") || typeof value.checkOnLaunch !== "boolean") {
    return { ok: false, error: "updates.checkOnLaunch must be a boolean" };
  }
  const out: UpdatesConfig = { checkOnLaunch: value.checkOnLaunch };
  if (hasOwn(value, "lastCheckedAt")) {
    if (value.lastCheckedAt === null || value.lastCheckedAt === undefined) {
      // explicit clear
    } else if (typeof value.lastCheckedAt === "string") {
      out.lastCheckedAt = value.lastCheckedAt;
    } else {
      return { ok: false, error: "updates.lastCheckedAt must be a string" };
    }
  }
  return { ok: true, value: out };
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
    isElectron: Boolean(process.versions.electron),
  });
}

export async function PUT(req: NextRequest) {
  const body = await readJson<unknown>(req);
  if (!isPlainObject(body)) {
    return Response.json({ ok: false, error: "invalid settings payload" }, { status: 400 });
  }
  const patch: Partial<Config> = {};
  if (hasOwn(body, "apiKey")) {
    if (body.apiKey === null || body.apiKey === "") {
      patch.apiKey = undefined;
    } else if (typeof body.apiKey === "string") {
      patch.apiKey = body.apiKey;
    } else {
      return Response.json({ ok: false, error: "apiKey must be a string" }, { status: 400 });
    }
  }
  if (hasOwn(body, "defaultModel")) {
    if (typeof body.defaultModel !== "string") {
      return Response.json({ ok: false, error: "defaultModel must be a string" }, { status: 400 });
    }
    patch.defaultModel = body.defaultModel;
  }
  if (hasOwn(body, "theme")) {
    if (body.theme !== "light" && body.theme !== "dark" && body.theme !== "system") {
      return Response.json({ ok: false, error: "theme must be light/dark/system" }, { status: 400 });
    }
    patch.theme = body.theme;
  }
  if (hasOwn(body, "autoRecap")) {
    if (typeof body.autoRecap !== "boolean") {
      return Response.json({ ok: false, error: "autoRecap must be a boolean" }, { status: 400 });
    }
    patch.autoRecap = body.autoRecap;
  }
  if (hasOwn(body, "includeLastChapterFullText")) {
    if (typeof body.includeLastChapterFullText !== "boolean") {
      return Response.json(
        { ok: false, error: "includeLastChapterFullText must be a boolean" },
        { status: 400 },
      );
    }
    patch.includeLastChapterFullText = body.includeLastChapterFullText;
  }
  if (hasOwn(body, "styleDefaults")) {
    const parsed = parseStyleDefaults(body.styleDefaults);
    if (!parsed.ok) return Response.json(parsed, { status: 400 });
    patch.styleDefaults = parsed.value;
  }
  if (hasOwn(body, "updates")) {
    const parsed = parseUpdates(body.updates);
    if (!parsed.ok) return Response.json(parsed, { status: 400 });
    patch.updates = parsed.value;
  }
  if (hasOwn(body, "penNameProfiles")) {
    const parsed = parsePenNameProfiles(body.penNameProfiles);
    if (!parsed.ok) return Response.json(parsed, { status: 400 });
    patch.penNameProfiles = parsed.value;
  }
  // Empty-string apiKey means clear
  if (patch.apiKey === "") patch.apiKey = undefined;
  const next = await saveConfig(effectiveDataDir(), patch);
  return ok({ hasKey: Boolean(next.apiKey), keyPreview: mask(next.apiKey) });
}
