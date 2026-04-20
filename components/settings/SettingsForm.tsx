"use client";

import { useCallback, useState } from "react";
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
import { DEFAULT_STYLE, type StyleRules } from "@/lib/style";

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
}

interface FormState {
  apiKey: string;
  modelSelect: string;
  customModel: string;
  theme: "light" | "dark" | "system";
  autoRecap: boolean;
  includeLastChapter: boolean;
  style: Required<StyleRules>;
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
      toast.success("Settings saved");
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
