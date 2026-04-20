"use client";

import { useState, useCallback, useMemo } from "react";
import { ChevronDown } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useAutoSave } from "@/hooks/useAutoSave";
import { BibleField } from "@/components/editor/BibleField";
import { CharactersSubform, type CharacterRow } from "@/components/editor/CharactersSubform";
import type { Bible } from "@/lib/types";

// ─── Collapsible ──────────────────────────────────────────────────────────────

interface CollapsibleProps {
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function Collapsible({ label, defaultOpen = true, children }: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      >
        <span>{label}</span>
        <ChevronDown
          className={cn("size-3 transition-transform", open && "rotate-180")}
        />
      </button>
      {open && <div className="pb-3">{children}</div>}
    </div>
  );
}

// ─── BibleSection ─────────────────────────────────────────────────────────────

interface BibleSectionProps {
  slug: string;
  bible: Bible;
}

/**
 * Converts CharacterRow[] → Character[] by stripping the client-only `id`.
 */
function stripIds(rows: CharacterRow[]): Bible["characters"] {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return rows.map(({ id: _id, ...rest }) => rest);
}

/**
 * Adds stable client-only UUIDs to incoming characters at mount time.
 */
function addIds(chars: Bible["characters"]): CharacterRow[] {
  return chars.map((c) => ({ ...c, id: crypto.randomUUID() }));
}

export function BibleSection({ slug, bible }: BibleSectionProps) {
  // ── Local state ────────────────────────────────────────────────────────────

  const [characters, setCharacters] = useState<CharacterRow[]>(() =>
    addIds(bible.characters),
  );
  const [setting, setSetting] = useState(bible.setting);
  const [pov, setPov] = useState(bible.pov);
  const [tone, setTone] = useState(bible.tone);
  const [styleNotes, setStyleNotes] = useState(bible.styleNotes);
  const [nsfwPreferences, setNsfwPreferences] = useState(bible.nsfwPreferences);

  // ── Derived bible for auto-save ────────────────────────────────────────────

  const currentBible = useMemo<Bible>(
    () => ({
      characters: stripIds(characters),
      setting,
      pov,
      tone,
      styleNotes,
      nsfwPreferences,
    }),
    [characters, setting, pov, tone, styleNotes, nsfwPreferences],
  );

  // ── Save callback ──────────────────────────────────────────────────────────

  const saveBible = useCallback(
    async (value: Bible) => {
      const res = await fetch(`/api/stories/${slug}/bible`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "save failed");
    },
    [slug],
  );

  const { status } = useAutoSave(currentBible, saveBible, { debounceMs: 500 });

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col px-3 py-2">
      {/* Section heading */}
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Bible
      </h2>

      {/* ── Characters ─────────────────────────────────────────────────── */}
      <Collapsible label="Characters">
        <CharactersSubform rows={characters} onChange={setCharacters} />
      </Collapsible>

      {/* ── Setting ────────────────────────────────────────────────────── */}
      <Collapsible label="Setting">
        <BibleField
          id="bible-setting"
          label="Setting"
          value={setting}
          onChange={setSetting}
          placeholder="Where and when does the story take place?"
          rows={3}
          saveStatus={status}
        />
      </Collapsible>

      {/* ── POV ────────────────────────────────────────────────────────── */}
      <Collapsible label="POV">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="bible-pov" className="text-xs font-medium">
              Point of View
            </Label>
          </div>
          <Select
            value={pov}
            onValueChange={(v) => {
              if (
                v === "first" ||
                v === "second" ||
                v === "third-limited" ||
                v === "third-omniscient"
              ) {
                setPov(v);
              }
            }}
          >
            <SelectTrigger id="bible-pov" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="first">First person</SelectItem>
              <SelectItem value="second">Second person</SelectItem>
              <SelectItem value="third-limited">Third limited</SelectItem>
              <SelectItem value="third-omniscient">Third omniscient</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Collapsible>

      {/* ── Tone ───────────────────────────────────────────────────────── */}
      <Collapsible label="Tone">
        <BibleField
          id="bible-tone"
          label="Tone"
          value={tone}
          onChange={setTone}
          placeholder="Dark, playful, romantic…"
          rows={2}
          saveStatus={status}
        />
      </Collapsible>

      {/* ── Style ──────────────────────────────────────────────────────── */}
      <Collapsible label="Style">
        <BibleField
          id="bible-style"
          label="Style Notes"
          value={styleNotes}
          onChange={setStyleNotes}
          placeholder="Sentence length, prose style, vocabulary…"
          rows={3}
          saveStatus={status}
        />
      </Collapsible>

      {/* ── NSFW ───────────────────────────────────────────────────────── */}
      <Collapsible label="NSFW">
        <BibleField
          id="bible-nsfw"
          label="NSFW Preferences"
          value={nsfwPreferences}
          onChange={setNsfwPreferences}
          placeholder="Explicit / tasteful fade-to-black / limits…"
          rows={3}
          saveStatus={status}
        />
      </Collapsible>
    </div>
  );
}
