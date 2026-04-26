"use client";

import useSWR from "swr";
import { toast } from "sonner";

import { PenNameProfilesSection } from "@/components/settings/PenNameProfilesSection";
import type { PenNameProfile } from "@/lib/config";
import type { Story } from "@/lib/types";

// ─── Fetcher ──────────────────────────────────────────────────────────────────

const fetcher = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "request failed");
  return json.data as T;
};

interface SettingsLite {
  penNameProfiles?: Record<string, PenNameProfile>;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Loads pen-name profiles from /api/settings, lists known pen names by
 * unioning saved profile keys with Story.authorPenName values, and renders
 * the PenNameProfilesSection. Save and delete go straight back through PUT
 * /api/settings with `{ penNameProfiles: next }`.
 *
 * Mirrors the SWR pattern used by SettingsForm and PrivacyPanel — same
 * fetcher shape, same `revalidateOnFocus: false` policy.
 */
export function PenNameProfilesContainer() {
  const { data: settings, mutate: mutateSettings } = useSWR<SettingsLite>(
    "/api/settings",
    fetcher,
    { revalidateOnFocus: false },
  );

  const { data: stories } = useSWR<Story[]>("/api/stories", fetcher, {
    revalidateOnFocus: false,
  });

  if (!settings) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }

  const profiles = settings.penNameProfiles ?? {};

  // Union of profile keys + Story.authorPenName values from existing stories.
  // Pen names that differ only by capitalization or whitespace are treated as
  // distinct keys — match the underlying Record<string, PenNameProfile>
  // semantics. No de-dup logic.
  const fromStories = (stories ?? [])
    .map((s) => s.authorPenName)
    .filter((n): n is string => typeof n === "string" && n.length > 0);
  const seen = new Set<string>();
  const knownPenNames: string[] = [];
  for (const name of [...Object.keys(profiles), ...fromStories]) {
    if (!seen.has(name)) {
      seen.add(name);
      knownPenNames.push(name);
    }
  }

  async function save(next: Record<string, PenNameProfile>) {
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ penNameProfiles: next }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "save failed");
      await mutateSettings();
      toast.success("Pen name profile saved");
    } catch {
      toast.error("Save failed");
    }
  }

  async function del(name: string) {
    const next = { ...profiles };
    delete next[name];
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ penNameProfiles: next }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "delete failed");
      await mutateSettings();
      toast.success(`Deleted profile for ${name}`);
    } catch {
      toast.error("Delete failed");
    }
  }

  return (
    <PenNameProfilesSection
      profiles={profiles}
      knownPenNames={knownPenNames}
      onSave={save}
      onDelete={del}
    />
  );
}
