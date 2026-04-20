"use client";

import { useState, useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useAutoSave } from "@/hooks/useAutoSave";
import { SummaryField } from "@/components/editor/SummaryField";
import { BeatList } from "@/components/editor/BeatList";
import { PromptField } from "@/components/editor/PromptField";
import { RecapField } from "@/components/editor/RecapField";
import type { Chapter } from "@/lib/types";

// ─── Fetcher ──────────────────────────────────────────────────────────────────

const fetcher = async (url: string): Promise<Chapter> => {
  const res = await fetch(url);
  const json = (await res.json()) as { ok: boolean; data?: Chapter; error?: string };
  if (!json.ok) throw new Error(json.error ?? "request failed");
  return json.data!;
};

// ─── Word count header ────────────────────────────────────────────────────────

interface WordCountHeaderProps {
  slug: string;
  chapterId: string;
  wordCount: number;
  /** Mount-time initial value only; chapter switches handled by key on parent. */
  initialTarget: number | undefined;
  mutate: () => Promise<unknown>;
  mutateList: () => Promise<unknown>;
}

function WordCountHeader({
  slug,
  chapterId,
  wordCount,
  initialTarget,
  mutate,
  mutateList,
}: WordCountHeaderProps) {
  const [localTarget, setLocalTarget] = useState(
    initialTarget !== undefined ? String(initialTarget) : "",
  );

  const save = useCallback(
    async (v: string) => {
      const parsed = parseInt(v, 10);
      // Skip save if empty or not a positive integer — see known limitation in report.
      if (v.trim() === "" || isNaN(parsed) || parsed <= 0) return;
      const res = await fetch(`/api/stories/${slug}/chapters/${chapterId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetWords: parsed }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "save failed");
      await mutate();
      await mutateList();
    },
    [slug, chapterId, mutate, mutateList],
  );

  useAutoSave(localTarget, save);

  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-2">
      <span className="text-xs text-muted-foreground tabular-nums">
        {wordCount.toLocaleString()} {wordCount === 1 ? "word" : "words"}
      </span>
      <div className="flex items-center gap-1.5">
        <Label htmlFor="chapter-target-words" className="text-xs text-muted-foreground">
          Target
        </Label>
        <Input
          id="chapter-target-words"
          type="number"
          min={1}
          value={localTarget}
          onChange={(e) => setLocalTarget(e.target.value)}
          placeholder="—"
          className="h-6 w-20 text-right text-xs"
        />
      </div>
    </div>
  );
}

// ─── Inner pane (rendered only when data is available) ────────────────────────

interface InnerPaneProps {
  slug: string;
  chapterId: string;
  data: Chapter;
  mutate: () => Promise<unknown>;
  mutateList: () => Promise<unknown>;
}

function InnerPane({ slug, chapterId, data, mutate, mutateList }: InnerPaneProps) {
  // Recap key: remount RecapField when recap transitions empty ↔ non-empty.
  // This ensures the textarea initialises with the server value after a retry
  // without using useEffect to sync state.
  const recapKey = `${chapterId}:${data.recap.trim() === "" ? "empty" : "has-value"}`;

  return (
    <div className="flex flex-col">
      {/* Word count + target words — keyed to chapterId for remount on switch */}
      <WordCountHeader
        key={chapterId}
        slug={slug}
        chapterId={chapterId}
        wordCount={data.wordCount}
        initialTarget={data.targetWords}
        mutate={mutate}
        mutateList={mutateList}
      />

      <div className="flex flex-col gap-5 px-4 py-4">
        <SummaryField
          key={chapterId}
          slug={slug}
          chapterId={chapterId}
          value={data.summary}
          mutate={mutate}
          mutateList={mutateList}
        />

        <BeatList
          key={chapterId}
          slug={slug}
          chapterId={chapterId}
          value={data.beats}
          mutate={mutate}
          mutateList={mutateList}
        />

        <PromptField
          key={chapterId}
          slug={slug}
          chapterId={chapterId}
          value={data.prompt}
          mutate={mutate}
          mutateList={mutateList}
        />

        <RecapField
          key={recapKey}
          slug={slug}
          chapterId={chapterId}
          chapter={data}
          mutate={mutate}
          mutateList={mutateList}
        />
      </div>
    </div>
  );
}

// ─── MetadataPane ─────────────────────────────────────────────────────────────

interface MetadataPaneProps {
  slug: string;
  chapterId: string | null;
}

export function MetadataPane({ slug, chapterId }: MetadataPaneProps) {
  const singleKey = chapterId ? `/api/stories/${slug}/chapters/${chapterId}` : null;
  const listKey = `/api/stories/${slug}/chapters`;

  const { data, isLoading, error, mutate } = useSWR<Chapter>(singleKey, fetcher);
  const { mutate: globalMutate } = useSWRConfig();

  const mutateList = useCallback(
    () => globalMutate(listKey),
    [globalMutate, listKey],
  );

  if (chapterId === null) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-xs text-muted-foreground">No chapter selected.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-xs text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-xs text-muted-foreground">Chapter not found.</p>
      </div>
    );
  }

  return (
    <InnerPane
      slug={slug}
      chapterId={chapterId}
      data={data}
      mutate={mutate}
      mutateList={mutateList}
    />
  );
}
