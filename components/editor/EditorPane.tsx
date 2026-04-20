"use client";

import { useEffect, useRef } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { ChapterHeader } from "@/components/editor/ChapterHeader";
import { SectionList } from "@/components/editor/SectionList";
import { GenerateChapterButton } from "@/components/editor/GenerateChapterButton";
import { useGenerationStore } from "@/components/editor/generation-store";
import { useStreamGenerate } from "@/hooks/useStreamGenerate";
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
  const listKey = `/api/stories/${slug}/chapters`;

  const { data, isLoading, error } = useSWR<Chapter>(singleKey, fetcher);
  const { mutate: globalMutate } = useSWRConfig();

  // Host the streaming hook at the EditorPane level so both SectionList
  // (via the Zustand store) and the future StreamOverlay (task 7.3) can
  // share the same hook instance.
  const stream = useStreamGenerate();
  const { status, sections: streamSections, error: streamError, start } = stream;

  const startGeneration = useGenerationStore((s) => s.startGeneration);
  const setLiveText = useGenerationStore((s) => s.setLiveText);
  const flushLiveSection = useGenerationStore((s) => s.flushLiveSection);
  const endGeneration = useGenerationStore((s) => s.endGeneration);
  const activeChapterId = useGenerationStore((s) => s.activeChapterId);
  const isStreaming = useGenerationStore((s) => s.isStreaming);

  // Mirror the hook's last-section text into the store. Only the tail section
  // is "live"; earlier sections are already persisted on disk and will appear
  // via SWR revalidation on each section-break.
  const prevSectionCountRef = useRef(0);
  useEffect(() => {
    if (!isStreaming) return;
    const count = streamSections.length;
    if (count === 0) return;

    const last = streamSections[count - 1];

    // section-break detection: count increased since last tick. The prior
    // section's final text is already on disk — revalidate SWR and clear
    // the live buffer for the next section.
    if (count > prevSectionCountRef.current && prevSectionCountRef.current > 0) {
      flushLiveSection();
      if (singleKey) void globalMutate(singleKey);
    }
    prevSectionCountRef.current = count;

    setLiveText(last.text);
  }, [isStreaming, streamSections, setLiveText, flushLiveSection, globalMutate, singleKey]);

  // Handle terminal stream states: done / error / stopped. Revalidate SWR so
  // the final persisted sections appear, then reset the store.
  useEffect(() => {
    if (status !== "done" && status !== "error" && status !== "stopped") return;

    if (status === "error" && streamError) {
      toast.error(streamError.message || "Generation failed");
    }

    // Server saves partial content on error/stop too, so always revalidate.
    if (singleKey) void globalMutate(singleKey);
    void globalMutate(listKey);

    endGeneration();
    prevSectionCountRef.current = 0;
  }, [status, streamError, globalMutate, singleKey, listKey, endGeneration]);

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

  const anotherChapterStreaming = isStreaming && activeChapterId !== chapterId;
  const generateDisabled =
    isStreaming || status === "requesting" || anotherChapterStreaming;

  const handleGenerate = () => {
    if (generateDisabled) return;
    startGeneration(chapterId);
    start({ storySlug: slug, chapterId, mode: "full" });
  };

  return (
    <div className="max-w-[72ch] mx-auto py-8 px-4">
      <ChapterHeader key={chapterId} slug={slug} chapter={data} />
      <div className="mt-6">
        <SectionList
          slug={slug}
          chapterId={chapterId}
          sections={data.sections}
          generateSlot={
            <GenerateChapterButton
              onGenerate={handleGenerate}
              disabled={generateDisabled}
            />
          }
        />
      </div>
    </div>
  );
}
