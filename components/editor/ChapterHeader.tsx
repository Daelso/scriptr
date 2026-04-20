"use client";

import { useState, useCallback } from "react";
import { useSWRConfig } from "swr";
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

// ─── ChapterHeader ────────────────────────────────────────────────────────────

interface ChapterHeaderProps {
  slug: string;
  chapter: Chapter;
}

export function ChapterHeader({ slug, chapter }: ChapterHeaderProps) {
  const [local, setLocal] = useState(chapter.title);
  const { mutate: globalMutate } = useSWRConfig();

  const singleKey = `/api/stories/${slug}/chapters/${chapter.id}`;
  const listKey = `/api/stories/${slug}/chapters`;

  const save = useCallback(
    async (v: string) => {
      const trimmed = v.trim();
      // Don't save an empty title.
      if (trimmed === "") return;
      const res = await fetch(singleKey, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "save failed");
      await globalMutate(singleKey);
      await globalMutate(listKey);
    },
    [singleKey, listKey, globalMutate],
  );

  const { status } = useAutoSave(local, save, { debounceMs: 500 });

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <input
          type="text"
          aria-label="Chapter title"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              setLocal(chapter.title);
              e.currentTarget.blur();
            }
          }}
          placeholder="Untitled chapter"
          className="text-3xl font-semibold tracking-tight bg-transparent border-0 px-0 focus-visible:ring-0 focus-visible:outline-none placeholder:text-muted-foreground w-full"
        />
        <SaveStatus status={status} />
      </div>
    </div>
  );
}
