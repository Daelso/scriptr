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
import { AuthorNoteCard } from "@/components/editor/AuthorNoteCard";
import type { Chapter, Story } from "@/lib/types";
import type { PenNameProfile } from "@/lib/config";

// ─── Fetcher ──────────────────────────────────────────────────────────────────

const fetcher = async (url: string): Promise<Chapter> => {
  const res = await fetch(url);
  const json = (await res.json()) as { ok: boolean; data?: Chapter; error?: string };
  if (!json.ok) throw new Error(json.error ?? "request failed");
  return json.data!;
};

// Generic fetcher for the story + settings endpoints used by the
// Author Note container below.
const jsonFetcher = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url);
  const json = (await res.json()) as { ok: boolean; data?: T; error?: string };
  if (!json.ok) throw new Error(json.error ?? "request failed");
  return json.data as T;
};

interface SettingsLite {
  penNameProfiles?: Record<string, PenNameProfile>;
}

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

// ─── Author Note container ────────────────────────────────────────────────────

/**
 * Story-level Author Note card — sits inside the per-chapter MetadataPane but
 * fetches its own story + settings data via SWR so its lifecycle is decoupled
 * from chapter switches.
 *
 * Save flow: local `authorNote` state → useAutoSave → PATCH /api/stories/[slug]
 * with `{ authorNote }` → SWR revalidate. Mirrors the autosave pattern in the
 * peer cards (SummaryField, RecapField).
 */
function AuthorNoteContainer({ slug }: { slug: string }) {
  const storyKey = `/api/stories/${slug}`;
  const { data: story, mutate: mutateStory } = useSWR<Story>(
    storyKey,
    jsonFetcher,
    { revalidateOnFocus: false },
  );
  const { data: settings } = useSWR<SettingsLite>(
    "/api/settings",
    jsonFetcher,
    { revalidateOnFocus: false },
  );

  if (!story || !settings) return null;

  const profile = settings.penNameProfiles?.[story.authorPenName];
  return (
    <AuthorNoteEditor
      slug={slug}
      story={story}
      profile={profile}
      mutateStory={mutateStory}
    />
  );
}

/**
 * Inner editor: only mounts once the story has loaded so the local mirror's
 * initial value is the real server-side authorNote, not a placeholder. This
 * avoids the seeding round-trip that would otherwise cause useAutoSave to
 * fire a redundant PATCH right after the initial fetch.
 */
function AuthorNoteEditor({
  slug,
  story,
  profile,
  mutateStory,
}: {
  slug: string;
  story: Story;
  profile: PenNameProfile | undefined;
  mutateStory: () => Promise<unknown>;
}) {
  const [local, setLocal] = useState<Story["authorNote"]>(story.authorNote);

  const save = useCallback(
    async (value: Story["authorNote"]) => {
      const res = await fetch(`/api/stories/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorNote: value }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "save failed");
      await mutateStory();
    },
    [slug, mutateStory],
  );

  useAutoSave(local, save);

  const effectiveStory: Story = { ...story, authorNote: local };

  return (
    <AuthorNoteCard
      story={effectiveStory}
      profile={profile}
      onChange={(next) => setLocal(next)}
    />
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
  return (
    <div className="flex flex-col">
      {/* Word count + target words — keyed to chapterId for remount on switch */}
      <WordCountHeader
        key={`word-count-${chapterId}`}
        slug={slug}
        chapterId={chapterId}
        wordCount={data.wordCount}
        initialTarget={data.targetWords}
        mutate={mutate}
        mutateList={mutateList}
      />

      <div className="flex flex-col gap-5 px-4 py-4">
        <SummaryField
          key={`summary-${chapterId}`}
          slug={slug}
          chapterId={chapterId}
          value={data.summary}
          mutate={mutate}
          mutateList={mutateList}
        />

        <BeatList
          key={`beats-${chapterId}`}
          slug={slug}
          chapterId={chapterId}
          value={data.beats}
          mutate={mutate}
          mutateList={mutateList}
        />

        <PromptField
          key={`prompt-${chapterId}`}
          slug={slug}
          chapterId={chapterId}
          value={data.prompt}
          mutate={mutate}
          mutateList={mutateList}
        />

        <RecapField
          key={`recap-${chapterId}`}
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

  // Story-level Author Note section is rendered above the chapter-keyed
  // cards so brand-new (chapterless) stories can still configure it. The
  // container owns its own SWR+autosave; chapter switches do not remount it.
  const authorNoteSection = (
    <div className="border-t border-border px-4 py-4">
      <AuthorNoteContainer slug={slug} />
    </div>
  );

  if (chapterId === null) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-center p-4">
          <p className="text-xs text-muted-foreground">No chapter selected.</p>
        </div>
        {authorNoteSection}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-center p-4">
          <p className="text-xs text-muted-foreground">Loading…</p>
        </div>
        {authorNoteSection}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-center p-4">
          <p className="text-xs text-muted-foreground">Chapter not found.</p>
        </div>
        {authorNoteSection}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <InnerPane
        slug={slug}
        chapterId={chapterId}
        data={data}
        mutate={mutate}
        mutateList={mutateList}
      />
      {authorNoteSection}
    </div>
  );
}
