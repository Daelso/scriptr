"use client";

import { useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import type { PenNameProfile } from "@/lib/config";

const CUSTOM_SENTINEL = "__custom__";
const PLACEHOLDER_SENTINEL = "";

interface PenNamePickerProps {
  /** Profile map from /api/settings; undefined while loading. */
  profiles: Record<string, PenNameProfile> | undefined;
  /** Current pen name on the parent's StoryFormState. */
  value: string;
  /** Emits the new pen name string. Empty string is allowed. */
  onChange: (next: string) => void;
}

function deriveInitialMode(
  profiles: Record<string, PenNameProfile> | undefined,
  value: string,
): "saved" | "custom" {
  if (!value) return "saved";
  if (profiles && Object.prototype.hasOwnProperty.call(profiles, value)) {
    return "saved";
  }
  return "custom";
}

export function PenNamePicker({
  profiles,
  value,
  onChange,
}: PenNamePickerProps) {
  const profileNames = profiles ? Object.keys(profiles).sort() : [];
  const hasProfiles = profileNames.length > 0;
  const [mode, setMode] = useState<"saved" | "custom">(() =>
    deriveInitialMode(profiles, value),
  );

  if (!hasProfiles) {
    return (
      <div className="flex flex-col gap-1">
        <Input
          aria-label="Author pen name"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          data-testid="pen-name-input"
        />
        <p className="text-xs text-muted-foreground">
          No saved profiles —{" "}
          <Link href="/settings" className="underline">
            set one up
          </Link>{" "}
          so the author note can be enabled for this story.
        </p>
      </div>
    );
  }

  if (mode === "custom") {
    return (
      <div className="flex flex-col gap-1">
        <Input
          aria-label="Author pen name"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          data-testid="pen-name-input"
        />
        <button
          type="button"
          className="text-xs underline text-muted-foreground self-start"
          onClick={() => {
            setMode("saved");
            onChange("");
          }}
        >
          Use saved profile
        </button>
      </div>
    );
  }

  const selectValue = profileNames.includes(value)
    ? value
    : PLACEHOLDER_SENTINEL;

  return (
    <select
      aria-label="Author pen name"
      data-testid="pen-name-select"
      value={selectValue}
      onChange={(e) => {
        const v = e.target.value;
        if (v === CUSTOM_SENTINEL) {
          setMode("custom");
          onChange("");
          return;
        }
        onChange(v);
      }}
      className="border border-input rounded px-2 py-1 text-sm bg-background"
    >
      <option value={PLACEHOLDER_SENTINEL} disabled>
        Choose pen name…
      </option>
      {profileNames.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
      <option value={CUSTOM_SENTINEL}>Custom…</option>
    </select>
  );
}
