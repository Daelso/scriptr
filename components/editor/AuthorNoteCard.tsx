"use client";

import Link from "next/link";

import { Label } from "@/components/ui/label";
import { RichTextEditor } from "@/components/editor/RichTextEditor";
import { SafeHtml } from "@/lib/publish/safe-html";
import { AUTHOR_NOTE_MESSAGE_SANITIZE_OPTS } from "@/lib/publish/author-note-shared";
import { cn } from "@/lib/utils";
import type { Story } from "@/lib/types";
import type { PenNameProfile } from "@/lib/config";

// ─── Save status indicator ────────────────────────────────────────────────────

// Mirrors the SaveStatus chip used by SummaryField/BeatList/PromptField/
// RecapField so the AuthorNote card shows the same idle/saving/saved/error
// feedback as the other autosave-backed cards. Caller passes the status
// returned from `useAutoSave`.
function SaveStatus({
  status,
}: {
  status: "idle" | "saving" | "saved" | "error";
}) {
  if (status === "idle") return null;
  const label =
    status === "saving" ? "Saving…" :
    status === "saved"  ? "Saved"   :
    "Save failed";
  return (
    <span
      className={cn(
        "text-xs",
        status === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  story: Story;
  /** Profile for `story.authorPenName`, or undefined when no match exists. */
  profile: PenNameProfile | undefined;
  /** Emits the new authorNote shape. Caller persists via PATCH + autosave. */
  onChange: (next: Story["authorNote"]) => void;
  /**
   * Autosave status from the parent container's `useAutoSave`. Optional so
   * the component remains usable without an autosave wrapper (tests, etc.).
   */
  saveStatus?: "idle" | "saving" | "saved" | "error";
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Per-story Author Note card. Lives on the right-hand metadata pane.
 *
 * Behaviour matrix:
 *  - profile === undefined: toggle is disabled; helper text links to settings.
 *  - profile && authorNote === undefined: toggle is checked (default-on);
 *    override editor is rendered empty; default-message preview is shown
 *    when `profile.defaultMessageHtml` is set.
 *  - profile && authorNote.enabled === false: toggle is unchecked; override
 *    editor and default preview are hidden. The previous `messageHtml` is
 *    preserved on the story so the user doesn't lose work when they toggle
 *    back on.
 *  - profile && authorNote.messageHtml is non-empty: default preview is
 *    suppressed (the user's override wins).
 *
 * The component is presentational. The parent (MetadataPane's container) is
 * responsible for fetching the profile by `story.authorPenName`, and for
 * persisting `onChange` payloads via PATCH /api/stories/[slug] + autosave.
 *
 * The data-testid strings (`author-note-card`, `author-note-toggle`,
 * `author-note-default-preview`, `author-note-override-editor`) are
 * load-bearing for the Task 7.2 Playwright e2e — do not rename.
 */
export function AuthorNoteCard({
  story,
  profile,
  onChange,
  saveStatus,
}: Props) {
  const hasProfile = profile !== undefined;
  const enabled = hasProfile ? story.authorNote?.enabled !== false : false;

  const overrideHtml = story.authorNote?.messageHtml ?? "";
  const overrideEmpty = overrideHtml.trim() === "";
  const defaultHtml = profile?.defaultMessageHtml ?? "";
  const showDefaultPreview =
    hasProfile && enabled && overrideEmpty && defaultHtml.trim() !== "";

  function handleToggle(next: boolean) {
    onChange({
      enabled: next,
      // Preserve any in-progress override message across toggles.
      messageHtml: story.authorNote?.messageHtml,
    });
  }

  return (
    <div data-testid="author-note-card" className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label htmlFor="author-note-toggle" className="text-xs font-medium">
          Author Note
        </Label>
        {saveStatus !== undefined && <SaveStatus status={saveStatus} />}
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          id="author-note-toggle"
          type="checkbox"
          data-testid="author-note-toggle"
          aria-label="Include author note in this story"
          disabled={!hasProfile}
          checked={enabled}
          onChange={(e) => handleToggle(e.target.checked)}
        />
        <span>Include author note in this story</span>
      </label>

      {!hasProfile && (
        <p className="text-xs text-muted-foreground">
          Set up a pen-name profile for{" "}
          <em>{story.authorPenName}</em> in{" "}
          <Link href="/settings" className="underline">
            settings
          </Link>{" "}
          to enable.
        </p>
      )}

      {hasProfile && enabled && (
        <>
          {showDefaultPreview && (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                Default message (from profile)
              </span>
              <div
                data-testid="author-note-default-preview"
                className="opacity-60 text-sm"
              >
                <SafeHtml
                  html={defaultHtml}
                  extra={AUTHOR_NOTE_MESSAGE_SANITIZE_OPTS}
                />
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">
              {showDefaultPreview ? "Override for this story" : "Message"}
            </span>
            <div data-testid="author-note-override-editor">
              <RichTextEditor
                initialHtml={overrideHtml}
                onChange={(html) =>
                  onChange({ enabled: true, messageHtml: html })
                }
                ariaLabel="Author note override message"
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
