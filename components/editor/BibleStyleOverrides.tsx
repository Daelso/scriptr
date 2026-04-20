"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { StyleRules } from "@/lib/style";

type Props = {
  /** The bible's styleOverrides (partial; undefined means "inherit all"). */
  overrides: StyleRules | undefined;
  /** The resolved effective style — used to show "Inherit (<value>)" labels. */
  resolved: Required<StyleRules>;
  /** Called with the new overrides partial. Pass `undefined` to clear. */
  onChange: (next: StyleRules | undefined) => void;
};

type BoolKey =
  | "useContractions"
  | "noEmDashes"
  | "noSemicolons"
  | "noNotXButY"
  | "noRhetoricalQuestions"
  | "sensoryGrounding";

const BOOL_ROWS: { key: BoolKey; label: string }[] = [
  { key: "useContractions", label: "Use contractions" },
  { key: "noEmDashes", label: "Avoid em-dashes" },
  { key: "noSemicolons", label: "Avoid semicolons" },
  { key: "noNotXButY", label: `Avoid "it wasn't X, it was Y"` },
  { key: "noRhetoricalQuestions", label: "Avoid rhetorical questions" },
  { key: "sensoryGrounding", label: "Favor sensory detail" },
];

function OverrideIndicator() {
  return (
    <span
      aria-label="Overridden"
      title="Overridden for this story"
      className="inline-block size-1.5 rounded-full bg-foreground/40"
    />
  );
}

function TriState({
  label,
  current,
  inherited,
  onChange,
}: {
  label: string;
  current: boolean | undefined;
  inherited: boolean;
  onChange: (v: boolean | undefined) => void;
}) {
  const overridden = current !== undefined;
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <Label className="text-xs">{label}</Label>
        {overridden && <OverrideIndicator />}
      </div>
      <div className="inline-flex rounded-md border text-xs">
        <button
          type="button"
          className={cn("px-2 py-1", current === undefined && "bg-muted font-medium")}
          onClick={() => onChange(undefined)}
        >
          Inherit ({inherited ? "on" : "off"})
        </button>
        <button
          type="button"
          className={cn("px-2 py-1 border-l", current === true && "bg-muted font-medium")}
          onClick={() => onChange(true)}
        >
          On
        </button>
        <button
          type="button"
          className={cn("px-2 py-1 border-l", current === false && "bg-muted font-medium")}
          onClick={() => onChange(false)}
        >
          Off
        </button>
      </div>
    </div>
  );
}

export function BibleStyleOverrides({ overrides, resolved, onChange }: Props) {
  const o = overrides ?? {};

  function set<K extends keyof StyleRules>(key: K, value: StyleRules[K] | undefined) {
    const next = { ...o };
    if (value === undefined) {
      delete next[key];
    } else {
      next[key] = value;
    }
    if (Object.keys(next).length === 0) {
      onChange(undefined);
    } else {
      onChange(next);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Override the Settings defaults for this story only.
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange(undefined)}
          className="h-7 text-xs"
        >
          Inherit all
        </Button>
      </div>

      {BOOL_ROWS.map((r) => (
        <TriState
          key={r.key}
          label={r.label}
          current={o[r.key]}
          inherited={resolved[r.key]}
          onChange={(v) => set(r.key, v)}
        />
      ))}

      {/* Tense */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Label className="text-xs" htmlFor="ov-tense">Tense</Label>
          {o.tense !== undefined && <OverrideIndicator />}
        </div>
        <Select
          value={o.tense ?? "__inherit"}
          onValueChange={(v) => {
            if (v === "__inherit") set("tense", undefined);
            else if (v === "past" || v === "present") set("tense", v);
          }}
        >
          <SelectTrigger id="ov-tense" className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__inherit">Inherit ({resolved.tense})</SelectItem>
            <SelectItem value="past">Past</SelectItem>
            <SelectItem value="present">Present</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Explicitness */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Label className="text-xs" htmlFor="ov-explicitness">Explicitness</Label>
          {o.explicitness !== undefined && <OverrideIndicator />}
        </div>
        <Select
          value={o.explicitness ?? "__inherit"}
          onValueChange={(v) => {
            if (v === "__inherit") set("explicitness", undefined);
            else if (v === "fade" || v === "suggestive" || v === "explicit" || v === "graphic") {
              set("explicitness", v);
            }
          }}
        >
          <SelectTrigger id="ov-explicitness" className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__inherit">Inherit ({resolved.explicitness})</SelectItem>
            <SelectItem value="fade">Fade-to-black</SelectItem>
            <SelectItem value="suggestive">Suggestive</SelectItem>
            <SelectItem value="explicit">Explicit</SelectItem>
            <SelectItem value="graphic">Graphic</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Dialogue tags */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Label className="text-xs" htmlFor="ov-tags">Dialogue tags</Label>
          {o.dialogueTags !== undefined && <OverrideIndicator />}
        </div>
        <Select
          value={o.dialogueTags ?? "__inherit"}
          onValueChange={(v) => {
            if (v === "__inherit") set("dialogueTags", undefined);
            else if (v === "prefer-said" || v === "vary") set("dialogueTags", v);
          }}
        >
          <SelectTrigger id="ov-tags" className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__inherit">Inherit ({resolved.dialogueTags})</SelectItem>
            <SelectItem value="prefer-said">Prefer &quot;said&quot;</SelectItem>
            <SelectItem value="vary">Vary freely</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Custom rules (additive) */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs" htmlFor="ov-custom">Additional rules (appended to global)</Label>
        <textarea
          id="ov-custom"
          className="min-h-16 rounded-md border bg-transparent p-2 text-sm"
          placeholder="Story-specific rules (combined with Settings → Additional rules)"
          value={o.customRules ?? ""}
          onChange={(e) => {
            const trimmed = e.target.value;
            set("customRules", trimmed === "" ? undefined : trimmed);
          }}
        />
      </div>
    </div>
  );
}
