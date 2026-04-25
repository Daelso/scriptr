"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextEditor } from "@/components/editor/RichTextEditor";
import { toSlug } from "@/lib/slug";
import type { PenNameProfile } from "@/lib/config";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  /** Profiles currently stored on the server, keyed by pen name. */
  profiles: Record<string, PenNameProfile>;
  /**
   * Union of profile keys + Story.authorPenName values from existing stories.
   * The section renders a card for each unique entry — even if it doesn't
   * have a saved profile yet.
   */
  knownPenNames: string[];
  /** Save handler — called with the FULL updated profiles object (not a delta). */
  onSave: (next: Record<string, PenNameProfile>) => void | Promise<void>;
  /** Optional delete handler — called with the pen name string. */
  onDelete?: (penName: string) => void | Promise<void>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PenNameProfilesSection({
  profiles,
  knownPenNames,
  onSave,
  onDelete,
}: Props) {
  // Locally-added pen names that haven't been saved yet. Combined with
  // knownPenNames at render time so the user can stack additions before
  // saving any of them.
  const [newPenNames, setNewPenNames] = useState<string[]>([]);
  const [newPenNameDraft, setNewPenNameDraft] = useState("");

  // De-dup while preserving the order: known first, then locally-added.
  const seen = new Set<string>();
  const allPenNames: string[] = [];
  for (const name of [...knownPenNames, ...newPenNames]) {
    if (!seen.has(name)) {
      seen.add(name);
      allPenNames.push(name);
    }
  }

  function handleAddNew() {
    const trimmed = newPenNameDraft.trim();
    if (!trimmed) return;
    if (allPenNames.includes(trimmed)) {
      // Already present — clear the input but don't add a dup.
      setNewPenNameDraft("");
      return;
    }
    setNewPenNames((prev) => [...prev, trimmed]);
    setNewPenNameDraft("");
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Pen Name Profiles
        </h2>
        <p className="text-xs text-muted-foreground">
          Configure email, mailing-list URL, and a default rich-text message
          per pen name. Used to populate the author-note card on each story.
        </p>
      </div>

      {allPenNames.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No pen names yet. Add one below to create your first profile.
        </p>
      )}

      {allPenNames.map((name) => (
        <PenNameCard
          key={name}
          name={name}
          initial={profiles[name] ?? {}}
          hasSavedProfile={Boolean(profiles[name])}
          onSaveProfile={(profile) => {
            const next = { ...profiles, [name]: profile };
            return onSave(next);
          }}
          onDeleteProfile={onDelete ? () => onDelete(name) : undefined}
        />
      ))}

      <div className="flex flex-col gap-2 rounded-md border border-dashed p-3">
        <Label htmlFor="pen-name-new">Add profile for new pen name</Label>
        <div className="flex items-center gap-2">
          <Input
            id="pen-name-new"
            data-testid="pen-name-new"
            placeholder="Pen name"
            value={newPenNameDraft}
            onChange={(e) => setNewPenNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddNew();
              }
            }}
          />
          <Button
            type="button"
            data-testid="pen-name-add"
            onClick={handleAddNew}
          >
            Add
          </Button>
        </div>
      </div>
    </section>
  );
}

// ─── Per-pen-name card ────────────────────────────────────────────────────────

function PenNameCard({
  name,
  initial,
  hasSavedProfile,
  onSaveProfile,
  onDeleteProfile,
}: {
  name: string;
  initial: PenNameProfile;
  hasSavedProfile: boolean;
  onSaveProfile: (profile: PenNameProfile) => void | Promise<void>;
  onDeleteProfile?: () => void | Promise<void>;
}) {
  const [local, setLocal] = useState<PenNameProfile>({ ...initial });
  const [saving, setSaving] = useState(false);
  const slug = toSlug(name);

  async function handleSave() {
    setSaving(true);
    try {
      await onSaveProfile(local);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{name}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`pen-email-${slug}`}>Email</Label>
          <Input
            id={`pen-email-${slug}`}
            data-testid={`pen-email-${slug}`}
            type="email"
            placeholder="author@example.com"
            value={local.email ?? ""}
            onChange={(e) => setLocal({ ...local, email: e.target.value })}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`pen-mailing-${slug}`}>Mailing list URL</Label>
          <Input
            id={`pen-mailing-${slug}`}
            data-testid={`pen-mailing-${slug}`}
            type="url"
            placeholder="https://example.com/subscribe"
            value={local.mailingListUrl ?? ""}
            onChange={(e) =>
              setLocal({ ...local, mailingListUrl: e.target.value })
            }
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Default message</Label>
          <div data-testid={`pen-message-${slug}`}>
            <RichTextEditor
              initialHtml={local.defaultMessageHtml ?? ""}
              onChange={(html) =>
                setLocal({ ...local, defaultMessageHtml: html })
              }
              ariaLabel={`Default message for ${name}`}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <Button
            type="button"
            data-testid={`pen-save-${slug}`}
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving…" : `Save ${name}`}
          </Button>
          {hasSavedProfile && onDeleteProfile && (
            <Button
              type="button"
              variant="ghost"
              data-testid={`pen-delete-${slug}`}
              onClick={() => onDeleteProfile()}
            >
              Delete profile
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
