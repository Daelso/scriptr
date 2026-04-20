"use client";

import { useState, useCallback } from "react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAutoSave } from "@/hooks/useAutoSave";
import type { Chapter } from "@/lib/types";

// ─── Save status indicator ────────────────────────────────────────────────────

function SaveStatus({ status }: { status: "idle" | "saving" | "saved" | "error" }) {
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

// ─── RecapField ───────────────────────────────────────────────────────────────

interface RecapFieldProps {
  slug: string;
  chapterId: string;
  /** Full chapter object — needed for the recap-failure hint condition. */
  chapter: Chapter;
  mutate: () => Promise<unknown>;
  mutateList: () => Promise<unknown>;
}

/**
 * Controlled by external `chapter.recap` at mount only. External recap changes
 * (e.g. after a retry) are handled by remounting via `key` in MetadataPane
 * (keyed to whether recap is empty).
 */
export function RecapField({ slug, chapterId, chapter, mutate, mutateList }: RecapFieldProps) {
  const [local, setLocal] = useState(chapter.recap);
  const [retrying, setRetrying] = useState(false);

  const save = useCallback(
    async (v: string) => {
      const res = await fetch(`/api/stories/${slug}/chapters/${chapterId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recap: v }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "save failed");
      await mutate();
      await mutateList();
    },
    [slug, chapterId, mutate, mutateList],
  );

  const { status } = useAutoSave(local, save);

  // Show the failure hint when: sections have content AND recap is blank.
  const hasSectionContent = chapter.sections.some((s) => s.content.trim() !== "");
  const showHint = hasSectionContent && chapter.recap.trim() === "";

  async function handleRetry() {
    setRetrying(true);
    try {
      const res = await fetch("/api/generate/recap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storySlug: slug, chapterId }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { recap: string };
        error?: string;
      };
      if (!json.ok) throw new Error(json.error ?? "recap failed");
      // Server saved the recap. Mutating causes MetadataPane to re-fetch,
      // which changes the `key` on RecapField (recap: empty → has-value),
      // triggering a remount with the new recap value.
      await mutate();
    } catch {
      toast.error("Recap failed again — try once more or write your own.");
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor="chapter-recap" className="text-xs font-medium">
          Recap
        </Label>
        <SaveStatus status={status} />
      </div>

      {showHint && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Recap failed — write one?</span>
          <Button
            type="button"
            variant="link"
            size="sm"
            disabled={retrying}
            onClick={handleRetry}
            className="h-auto p-0 text-xs"
          >
            {retrying ? "Retrying…" : "Retry"}
          </Button>
        </div>
      )}

      <Textarea
        id="chapter-recap"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder="Brief recap of this chapter for context in subsequent chapters."
        rows={4}
        className="resize-none text-sm"
      />
    </div>
  );
}
