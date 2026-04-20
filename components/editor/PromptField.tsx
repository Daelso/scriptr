"use client";

import { useState, useCallback } from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAutoSave } from "@/hooks/useAutoSave";

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

// ─── PromptField ──────────────────────────────────────────────────────────────

interface PromptFieldProps {
  slug: string;
  chapterId: string;
  value: string;
  mutate: () => Promise<unknown>;
  mutateList: () => Promise<unknown>;
}

/**
 * Controlled by external `value` at mount only. External value changes are
 * handled by remounting via `key` in MetadataPane (on chapterId change).
 */
export function PromptField({ slug, chapterId, value, mutate, mutateList }: PromptFieldProps) {
  const [local, setLocal] = useState(value);

  const save = useCallback(
    async (v: string) => {
      const res = await fetch(`/api/stories/${slug}/chapters/${chapterId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: v }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "save failed");
      await mutate();
      await mutateList();
    },
    [slug, chapterId, mutate, mutateList],
  );

  const { status } = useAutoSave(local, save);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor="chapter-prompt" className="text-xs font-medium">
          Prompt
        </Label>
        <SaveStatus status={status} />
      </div>
      <Textarea
        id="chapter-prompt"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder="Generation seed — describe the scene, mood, or direction for this chapter."
        rows={6}
        className="resize-none text-sm"
      />
    </div>
  );
}
