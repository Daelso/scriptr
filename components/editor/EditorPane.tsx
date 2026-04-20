"use client";

import useSWR from "swr";
import { ChapterHeader } from "@/components/editor/ChapterHeader";
import { SectionList } from "@/components/editor/SectionList";
import type { Chapter } from "@/lib/types";

// ─── Fetcher ──────────────────────────────────────────────────────────────────

const fetcher = async (url: string): Promise<Chapter> => {
  const res = await fetch(url);
  const json = (await res.json()) as { ok: boolean; data?: Chapter; error?: string };
  if (!json.ok) throw new Error(json.error ?? "request failed");
  return json.data!;
};

// ─── EditorPane ───────────────────────────────────────────────────────────────

interface EditorPaneProps {
  slug: string;
  chapterId: string | null;
}

export function EditorPane({ slug, chapterId }: EditorPaneProps) {
  const singleKey = chapterId ? `/api/stories/${slug}/chapters/${chapterId}` : null;

  const { data, isLoading, error } = useSWR<Chapter>(singleKey, fetcher);

  if (chapterId === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">Add a chapter to start writing.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xs text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xs text-muted-foreground">Chapter not found.</p>
      </div>
    );
  }

  return (
    <div className="max-w-[72ch] mx-auto py-8 px-4">
      <ChapterHeader key={chapterId} slug={slug} chapter={data} />
      <div className="mt-6">
        <SectionList slug={slug} chapterId={chapterId} sections={data.sections} />
      </div>
    </div>
  );
}
