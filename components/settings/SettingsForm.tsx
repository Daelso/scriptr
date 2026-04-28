"use client";

import { useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { StyleRulesPreview } from "@/components/settings/StyleRulesPreview";
import { DEFAULT_STYLE, type StyleRules } from "@/lib/style";
import { useUpdates } from "@/hooks/useUpdates";
import type { UpdateState } from "@/lib/update-state";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SettingsData {
  hasKey: boolean;
  keyPreview?: string;
  defaultModel: string;
  bindHost: string;
  theme: "light" | "dark" | "system";
  autoRecap: boolean;
  includeLastChapterFullText: boolean;
  styleDefaults?: StyleRules;
  updates?: { checkOnLaunch: boolean; lastCheckedAt?: string };
  isElectron?: boolean;
}

interface FormState {
  apiKey: string;
  modelSelect: string;
  customModel: string;
  theme: "light" | "dark" | "system";
  autoRecap: boolean;
  includeLastChapter: boolean;
  style: Required<StyleRules>;
  updateCheckOnLaunch: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const KNOWN_MODELS = ["grok-4-latest", "grok-4-fast", "grok-3-latest", "grok-beta"] as const;

function isKnownModel(v: string): v is typeof KNOWN_MODELS[number] {
  return (KNOWN_MODELS as readonly string[]).includes(v);
}

const DEFAULT_FORM: FormState = {
  apiKey: "",
  modelSelect: "grok-4-latest",
  customModel: "",
  theme: "system",
  autoRecap: true,
  includeLastChapter: false,
  style: { ...DEFAULT_STYLE },
  updateCheckOnLaunch: true,
};

function formFromData(data: SettingsData): FormState {
  return {
    apiKey: "",
    modelSelect: isKnownModel(data.defaultModel) ? data.defaultModel : "custom",
    customModel: isKnownModel(data.defaultModel) ? "" : data.defaultModel,
    theme: data.theme,
    autoRecap: data.autoRecap,
    includeLastChapter: data.includeLastChapterFullText,
    style: { ...DEFAULT_STYLE, ...(data.styleDefaults ?? {}) },
    updateCheckOnLaunch: data.updates?.checkOnLaunch !== false, // default true
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function diffAgainstDefault(current: Required<StyleRules>): StyleRules {
  const out: StyleRules = {};
  for (const k of Object.keys(DEFAULT_STYLE) as (keyof StyleRules)[]) {
    if (current[k] !== DEFAULT_STYLE[k]) {
      (out as Record<string, unknown>)[k] = current[k];
    }
  }
  return out;
}

function renderUpdateStatus(state: UpdateState, justFinishedNoUpdate: boolean): string {
  switch (state.kind) {
    case "checking":
      return "Checking…";
    case "downloading":
      return `Downloading version ${state.version}…`;
    case "downloaded":
      return `Version ${state.version} downloaded. Restart to install.`;
    case "error":
      return `Update check failed: ${sanitizeUpdateError(state.message)}`;
    case "idle":
      if (justFinishedNoUpdate) {
        return `You're on the latest version (${state.currentVersion}).`;
      }
      if (!state.lastCheckedAt) return "Never checked.";
      return `Last checked: ${formatRelativeTime(state.lastCheckedAt)}.`;
  }
}

// electron-updater error messages can embed full filesystem paths
// (`C:\Users\<name>\AppData\...`, `/home/<name>/...`) and serialized
// HTTP response headers. We surface the message so users can self-diagnose,
// but redact home-directory paths to avoid leaking the OS username, and cap
// length so a multi-KB headers blob doesn't trash the layout.
function sanitizeUpdateError(message: string): string {
  return message
    .replace(/[A-Za-z]:\\Users\\[^\\/"'\s]+/g, "~")
    .replace(/\/(?:Users|home)\/[^/"'\s]+/g, "~")
    .slice(0, 200);
}

function formatRelativeTime(iso: string): string {
  // Minimal relative formatter — avoids pulling in date-fns. Falls back
  // to the ISO string if anything goes sideways.
  try {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return iso;
    const diffMs = Date.now() - then;
    const m = Math.round(diffMs / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
    const d = Math.round(h / 24);
    return `${d} day${d === 1 ? "" : "s"} ago`;
  } catch {
    return iso;
  }
}

// ─── Fetcher ──────────────────────────────────────────────────────────────────

const fetcher = async (url: string): Promise<SettingsData> => {
  const res = await fetch(url);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "request failed");
  return json.data as SettingsData;
};

// ─── Component ────────────────────────────────────────────────────────────────

export function SettingsForm() {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);

  // onSuccess fires outside render — safe place to sync form from server state
  const handleDataSuccess = useCallback(
    (incoming: SettingsData) => {
      setForm(formFromData(incoming));
    },
    [],
  );

  const { data, mutate } = useSWR<SettingsData>("/api/settings", fetcher, {
    onSuccess: handleDataSuccess,
    // Don't re-sync after the user has started editing (revalidate on focus would overwrite their changes)
    revalidateOnFocus: false,
  });

  const updates = useUpdates();

  const search = useSearchParams();
  const router = useRouter();
  const onboarding = search.get("onboarding") === "1";

  function patch(partial: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...partial }));
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  async function handleSave() {
    setSaving(true);
    try {
      const effectiveModel =
        form.modelSelect === "custom" ? form.customModel.trim() : form.modelSelect;

      const body: Record<string, unknown> = {
        defaultModel: effectiveModel,
        theme: form.theme,
        autoRecap: form.autoRecap,
        includeLastChapterFullText: form.includeLastChapter,
        styleDefaults: diffAgainstDefault(form.style),
      };

      // Only send the updates patch when running under Electron, to keep the web
      // build's behavior identical.
      if (data?.isElectron) {
        body.updates = {
          ...(data.updates ?? { checkOnLaunch: true }),
          checkOnLaunch: form.updateCheckOnLaunch,
        };
      }

      // Only include apiKey when the user typed something
      if (form.apiKey !== "") {
        body.apiKey = form.apiKey;
      }

      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "save failed");

      // mutate() triggers onSuccess which will re-seed form; clear apiKey field now
      patch({ apiKey: "" });
      await mutate();
      // If the user was in the onboarding flow and just saved their first key,
      // drop the ?onboarding=1 query param so the welcome banner stops showing.
      const justFinishedOnboarding =
        onboarding && form.apiKey !== "" && (data === undefined || !data.hasKey);
      if (justFinishedOnboarding) {
        router.replace("/settings");
        toast.success("Setup complete — welcome to scriptr");
      } else {
        toast.success("Settings saved");
      }
    } catch {
      toast.error("Save failed");
    } finally {
      setSaving(false);
    }
  }

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (!data) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }

  const keyPlaceholder = data.hasKey ? (data.keyPreview ?? "xai-••••") : "xai-…";

  return (
    <div className="flex flex-col gap-8">

      {onboarding && (
        <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-4">
          <h2 className="text-sm font-semibold">Welcome to scriptr</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Paste your xAI API key below to get started.{" "}
            <a
              href="https://console.x.ai"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Get a key →
            </a>
          </p>
        </div>
      )}

      {/* ── API Key ─────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-4">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          API
        </h2>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="api-key">xAI API key</Label>
          <div className="relative flex items-center">
            <Input
              id="api-key"
              type={showKey ? "text" : "password"}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder={keyPlaceholder}
              value={form.apiKey}
              onChange={(e) => patch({ apiKey: e.target.value })}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-2.5 flex items-center text-muted-foreground hover:text-foreground transition-colors"
              aria-label={showKey ? "Hide API key" : "Show API key"}
            >
              {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {data.hasKey && (
            <p className="text-xs text-muted-foreground">
              Key on file: {data.keyPreview}. Enter a new key to replace it.
            </p>
          )}
        </div>
      </section>

      <Separator />

      {/* ── Model ───────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-4">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Generation
        </h2>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="default-model">Default model</Label>
          <Select
            value={form.modelSelect}
            onValueChange={(v) => {
              if (typeof v === "string") patch({ modelSelect: v });
            }}
          >
            <SelectTrigger id="default-model" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="grok-4-latest">grok-4-latest</SelectItem>
              <SelectItem value="grok-4-fast">grok-4-fast</SelectItem>
              <SelectItem value="grok-3-latest">grok-3-latest</SelectItem>
              <SelectItem value="grok-beta">grok-beta</SelectItem>
              <SelectItem value="custom">custom</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {form.modelSelect === "custom" && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="custom-model">Custom model ID</Label>
            <Input
              id="custom-model"
              placeholder="e.g. grok-super-secret"
              value={form.customModel}
              onChange={(e) => patch({ customModel: e.target.value })}
            />
          </div>
        )}

        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <Label htmlFor="auto-recap">Auto-recap</Label>
            <p className="text-xs text-muted-foreground">
              Summarize each chapter after generation.
            </p>
          </div>
          <Switch
            id="auto-recap"
            checked={form.autoRecap}
            onCheckedChange={(v) => patch({ autoRecap: v })}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <Label htmlFor="include-last-chapter">Include last chapter full text</Label>
            <p className="text-xs text-muted-foreground">
              Send the complete previous chapter with each generation request.
            </p>
          </div>
          <Switch
            id="include-last-chapter"
            checked={form.includeLastChapter}
            onCheckedChange={(v) => patch({ includeLastChapter: v })}
          />
        </div>
      </section>

      <Separator />

      {/* ── Writing style defaults ─────────────────────────────────── */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Writing Style Defaults
          </h2>
          <p className="text-xs text-muted-foreground">
            Rules injected into every generation prompt. Individual stories can override these.
          </p>
        </div>

        <StyleToggle
          id="use-contractions"
          label="Use contractions"
          description="I'm, don't, won't — in narration and dialogue"
          checked={form.style.useContractions ?? DEFAULT_STYLE.useContractions}
          onChange={(v) => patch({ style: { ...form.style, useContractions: v } })}
        />
        <StyleToggle
          id="no-em-dashes"
          label="Avoid em-dashes"
          description="Use commas, periods, or parentheses instead"
          checked={form.style.noEmDashes ?? DEFAULT_STYLE.noEmDashes}
          onChange={(v) => patch({ style: { ...form.style, noEmDashes: v } })}
        />
        <StyleToggle
          id="no-semicolons"
          label="Avoid semicolons"
          checked={form.style.noSemicolons ?? DEFAULT_STYLE.noSemicolons}
          onChange={(v) => patch({ style: { ...form.style, noSemicolons: v } })}
        />
        <StyleToggle
          id="no-not-x-but-y"
          label={`Avoid "it wasn't X, it was Y"`}
          checked={form.style.noNotXButY ?? DEFAULT_STYLE.noNotXButY}
          onChange={(v) => patch({ style: { ...form.style, noNotXButY: v } })}
        />
        <StyleToggle
          id="no-rhetorical-questions"
          label="Avoid rhetorical questions in narration"
          checked={form.style.noRhetoricalQuestions ?? DEFAULT_STYLE.noRhetoricalQuestions}
          onChange={(v) => patch({ style: { ...form.style, noRhetoricalQuestions: v } })}
        />
        <StyleToggle
          id="sensory-grounding"
          label="Favor concrete sensory detail"
          checked={form.style.sensoryGrounding ?? DEFAULT_STYLE.sensoryGrounding}
          onChange={(v) => patch({ style: { ...form.style, sensoryGrounding: v } })}
        />

        <p className="mt-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Erotica craft &amp; ethics
        </p>
        <StyleToggle
          id="consent-beats"
          label="Require consent beats"
          description="Show active, enthusiastic participation as beats in the prose"
          checked={form.style.consentBeats ?? DEFAULT_STYLE.consentBeats}
          onChange={(v) => patch({ style: { ...form.style, consentBeats: v } })}
        />
        <StyleToggle
          id="adults-only"
          label="Adults only"
          description="All sexual participants are adults — never age down or imply minors"
          checked={form.style.adultsOnly ?? DEFAULT_STYLE.adultsOnly}
          onChange={(v) => patch({ style: { ...form.style, adultsOnly: v } })}
        />
        <StyleToggle
          id="bodies-directly-named"
          label="Name bodies directly"
          description={`Cock, clit, nipples — avoid "his manhood" and clinical register`}
          checked={form.style.bodiesDirectlyNamed ?? DEFAULT_STYLE.bodiesDirectlyNamed}
          onChange={(v) => patch({ style: { ...form.style, bodiesDirectlyNamed: v } })}
        />
        <StyleToggle
          id="ramp-arousal"
          label="Ramp arousal across beats"
          description="Tension, hesitation, caught breath before escalation"
          checked={form.style.rampArousal ?? DEFAULT_STYLE.rampArousal}
          onChange={(v) => patch({ style: { ...form.style, rampArousal: v } })}
        />
        <StyleToggle
          id="interior-pov-in-sex"
          label="Interior POV during sex"
          description="Felt sensation and intrusive thought, not camera-angle description"
          checked={form.style.interiorPOVInSex ?? DEFAULT_STYLE.interiorPOVInSex}
          onChange={(v) => patch({ style: { ...form.style, interiorPOVInSex: v } })}
        />
        <StyleToggle
          id="no-suddenly"
          label={`Avoid "suddenly" / "just then"`}
          description="Let cause and effect show through action and reaction"
          checked={form.style.noSuddenly ?? DEFAULT_STYLE.noSuddenly}
          onChange={(v) => patch({ style: { ...form.style, noSuddenly: v } })}
        />
        <StyleToggle
          id="dialogue-during-sex"
          label="Dialogue during sex"
          description="Interrupted, whispered — not porn-script, not total silence"
          checked={form.style.dialogueDuringSex ?? DEFAULT_STYLE.dialogueDuringSex}
          onChange={(v) => patch({ style: { ...form.style, dialogueDuringSex: v } })}
        />
        <StyleToggle
          id="kinks-as-lived"
          label="Play kinks, don't explain them"
          description="Narrator never explains what a character's preferences mean"
          checked={form.style.kinksAsLived ?? DEFAULT_STYLE.kinksAsLived}
          onChange={(v) => patch({ style: { ...form.style, kinksAsLived: v } })}
        />
        <StyleToggle
          id="mandatory-aftermath"
          label="Require aftermath"
          description="Close every sex scene with connective tissue before cutting away"
          checked={form.style.mandatoryAftermath ?? DEFAULT_STYLE.mandatoryAftermath}
          onChange={(v) => patch({ style: { ...form.style, mandatoryAftermath: v } })}
        />

        <p className="mt-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Prose polish (opt-in)
        </p>
        <StyleToggle
          id="no-began-to"
          label={`Avoid "began to X" / "started to X"`}
          checked={form.style.noBeganTo ?? DEFAULT_STYLE.noBeganTo}
          onChange={(v) => patch({ style: { ...form.style, noBeganTo: v } })}
        />
        <StyleToggle
          id="no-weather-mirror"
          label="Avoid weather-as-emotion"
          checked={form.style.noWeatherMirror ?? DEFAULT_STYLE.noWeatherMirror}
          onChange={(v) => patch({ style: { ...form.style, noWeatherMirror: v } })}
        />
        <StyleToggle
          id="one-pov-per-scene"
          label="One POV per scene"
          description="No head-hopping mid-scene"
          checked={form.style.onePOVPerScene ?? DEFAULT_STYLE.onePOVPerScene}
          onChange={(v) => patch({ style: { ...form.style, onePOVPerScene: v } })}
        />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tense">Tense</Label>
          <Select
            value={form.style.tense ?? DEFAULT_STYLE.tense}
            onValueChange={(v) => {
              if (v === "past" || v === "present") {
                patch({ style: { ...form.style, tense: v } });
              }
            }}
          >
            <SelectTrigger id="tense" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="past">Past</SelectItem>
              <SelectItem value="present">Present</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="explicitness">Explicitness</Label>
          <Select
            value={form.style.explicitness ?? DEFAULT_STYLE.explicitness}
            onValueChange={(v) => {
              if (v === "fade" || v === "suggestive" || v === "explicit" || v === "graphic") {
                patch({ style: { ...form.style, explicitness: v } });
              }
            }}
          >
            <SelectTrigger id="explicitness" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fade">Fade-to-black</SelectItem>
              <SelectItem value="suggestive">Suggestive</SelectItem>
              <SelectItem value="explicit">Explicit</SelectItem>
              <SelectItem value="graphic">Graphic</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dialogue-tags">Dialogue tags</Label>
          <Select
            value={form.style.dialogueTags ?? DEFAULT_STYLE.dialogueTags}
            onValueChange={(v) => {
              if (v === "prefer-said" || v === "vary") {
                patch({ style: { ...form.style, dialogueTags: v } });
              }
            }}
          >
            <SelectTrigger id="dialogue-tags" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="prefer-said">Prefer &quot;said&quot;</SelectItem>
              <SelectItem value="vary">Vary freely</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="custom-rules">Additional rules</Label>
          <textarea
            id="custom-rules"
            className="min-h-20 rounded-md border bg-transparent p-2 text-sm"
            placeholder={`e.g. "never start a paragraph with 'Meanwhile'"`}
            value={form.style.customRules ?? ""}
            onChange={(e) => patch({ style: { ...form.style, customRules: e.target.value } })}
          />
          <p className="text-xs text-muted-foreground">
            Free-text rules appended verbatim. Different from Bible → Style Notes, which describes the story&apos;s voice.
          </p>
        </div>

        <StyleRulesPreview rules={form.style} />

        <Button
          type="button"
          variant="ghost"
          className="self-start"
          onClick={() => patch({ style: { ...DEFAULT_STYLE } })}
        >
          Reset to built-in defaults
        </Button>
      </section>

      <Separator />

      {data.isElectron && (
        <>
          <Separator />
          <section className="flex flex-col gap-4">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Updates
            </h2>
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <Label htmlFor="update-check-on-launch">Auto-check on launch</Label>
                <p className="text-xs text-muted-foreground">
                  Queries GitHub Releases when the app starts. Disable to make
                  zero automatic network calls outside of generation.
                </p>
              </div>
              <Switch
                id="update-check-on-launch"
                checked={form.updateCheckOnLaunch}
                onCheckedChange={(v) => patch({ updateCheckOnLaunch: v })}
              />
            </div>

            {updates.checkNow && updates.state && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void updates.checkNow!()}
                    disabled={updates.state.kind === "checking" || updates.state.kind === "downloading"}
                  >
                    Check for updates
                  </Button>
                  <a
                    href="https://github.com/Daelso/scriptr/releases"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  >
                    View on GitHub ↗
                  </a>
                </div>

                <div className="text-xs text-muted-foreground" role="status" aria-live="polite">
                  {renderUpdateStatus(updates.state, updates.justFinishedNoUpdate)}
                </div>

                {updates.state.kind === "downloaded" && (
                  <Button
                    type="button"
                    variant="default"
                    className="self-start"
                    onClick={() => void updates.installNow!()}
                  >
                    Restart and install
                  </Button>
                )}
              </div>
            )}
          </section>
        </>
      )}

      {/* ── Appearance ──────────────────────────────────────────────── */}
      <section className="flex flex-col gap-4">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Appearance
        </h2>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="theme">Theme</Label>
          <Select
            value={form.theme}
            onValueChange={(v) => {
              if (v === "light" || v === "dark" || v === "system") patch({ theme: v });
            }}
          >
            <SelectTrigger id="theme" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
              <SelectItem value="system">System</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>

      {/* ── Save ────────────────────────────────────────────────────── */}
      <div className="flex justify-end pt-2">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function StyleToggle(props: {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={props.id}>{props.label}</Label>
        {props.description && (
          <p className="text-xs text-muted-foreground">{props.description}</p>
        )}
      </div>
      <Switch id={props.id} checked={props.checked} onCheckedChange={props.onChange} />
    </div>
  );
}
