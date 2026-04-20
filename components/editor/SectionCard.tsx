"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Section } from "@/lib/types";

interface SectionCardProps {
  section: Section;
  /** True while this section is mid-regen: hide body and show shimmer. */
  isRegenerating?: boolean;
  /**
   * True while any generation (chapter or section) is active. Disables the
   * kebab menu so the user can't queue a second run — the hook is single-
   * instance and would clobber the in-flight stream.
   */
  disableActions?: boolean;
  onRegenerate?: (sectionId: string) => void;
  onRegenerateWithNote?: (sectionId: string, note: string) => void;
  onDelete?: (sectionId: string) => void;
}

/**
 * Renders a single persisted section. Hosts the kebab menu (Regenerate /
 * Regenerate with note… / Delete) and the inline note input. Heavy lifting
 * (actually starting the stream, deleting via PATCH) lives in EditorPane —
 * this component is presentational + local UI state only.
 */
export function SectionCard({
  section,
  isRegenerating = false,
  disableActions = false,
  onRegenerate,
  onRegenerateWithNote,
  onDelete,
}: SectionCardProps) {
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [note, setNote] = useState("");
  const noteRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus the textarea when it opens.
  useEffect(() => {
    if (showNoteInput && noteRef.current) {
      noteRef.current.focus();
    }
  }, [showNoteInput]);

  const handleRegenerateClick = () => {
    if (disableActions || !onRegenerate) return;
    onRegenerate(section.id);
  };

  const handleOpenNote = () => {
    if (disableActions) return;
    setShowNoteInput(true);
  };

  const handleDeleteClick = () => {
    if (disableActions || !onDelete) return;
    onDelete(section.id);
  };

  const submitNote = () => {
    const trimmed = note.trim();
    if (!trimmed || !onRegenerateWithNote) return;
    onRegenerateWithNote(section.id, trimmed);
    setShowNoteInput(false);
    setNote("");
  };

  const cancelNote = () => {
    setShowNoteInput(false);
    setNote("");
  };

  const handleNoteKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cancelNote();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submitNote();
    }
  };

  return (
    <article className="py-4 border-b border-border last:border-b-0">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {section.regenNote && !isRegenerating && (
            <p className="mb-2 text-xs text-muted-foreground italic">
              {section.regenNote}
            </p>
          )}
          {isRegenerating ? (
            <div
              role="status"
              aria-live="polite"
              aria-label="Regenerating section"
              className="space-y-2"
            >
              <p className="text-xs italic text-muted-foreground">
                Regenerating…
              </p>
              <div className="h-4 w-full rounded bg-muted animate-pulse" />
              <div className="h-4 w-[92%] rounded bg-muted animate-pulse" />
              <div className="h-4 w-[85%] rounded bg-muted animate-pulse" />
              <div className="h-4 w-[70%] rounded bg-muted animate-pulse" />
            </div>
          ) : (
            <p className="text-base leading-relaxed text-foreground whitespace-pre-wrap">
              {section.content}
            </p>
          )}
        </div>
        {!isRegenerating && (
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={disableActions}
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Section options"
                  disabled={disableActions}
                  className={cn("mt-0.5 shrink-0")}
                />
              }
            >
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={handleRegenerateClick}
                disabled={disableActions}
              >
                Regenerate
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleOpenNote}
                disabled={disableActions}
              >
                Regenerate with note…
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={handleDeleteClick}
                disabled={disableActions}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {showNoteInput && !isRegenerating && (
        <div className="mt-3 flex flex-col gap-2">
          <Textarea
            ref={noteRef}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={handleNoteKeyDown}
            placeholder="What should change? e.g. slow the pacing, add more inner thought…"
            aria-label="Regen note"
            className="min-h-[72px] text-sm"
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={cancelNote}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={submitNote}
              disabled={note.trim().length === 0}
            >
              Apply
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}
