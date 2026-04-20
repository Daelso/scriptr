"use client";

import { useEffect, useRef } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { ChapterHeader } from "@/components/editor/ChapterHeader";
import { SectionList } from "@/components/editor/SectionList";
import { GenerateChapterButton } from "@/components/editor/GenerateChapterButton";
import { StreamOverlay } from "@/components/editor/StreamOverlay";
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
  const { status, sections: streamSections, error: streamError, start, stop } = stream;

  const startGeneration = useGenerationStore((s) => s.startGeneration);
  const setLiveText = useGenerationStore((s) => s.setLiveText);
  const flushLiveSection = useGenerationStore((s) => s.flushLiveSection);
  const endGeneration = useGenerationStore((s) => s.endGeneration);
  const activeChapterId = useGenerationStore((s) => s.activeChapterId);
  const isStreaming = useGenerationStore((s) => s.isStreaming);

  // Revalidate the chapter that is actively streaming, not the chapter the
  // user is currently viewing — they can diverge if the user switches the
  // nav pane mid-stream.
  const activeSingleKey = activeChapterId
    ? `/api/stories/${slug}/chapters/${activeChapterId}`
    : null;

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
      if (activeSingleKey) void globalMutate(activeSingleKey);
    }
    prevSectionCountRef.current = count;

    setLiveText(last.text);
  }, [isStreaming, streamSections, setLiveText, flushLiveSection, globalMutate, activeSingleKey]);

  // Handle terminal stream states: done / error / stopped. Revalidate SWR so
  // the final persisted sections appear, then reset the store.
  //
  // IMPORTANT: we await the single-key revalidation BEFORE calling
  // endGeneration(). endGeneration zeros activeChapterId/isStreaming, which
  // unmounts SectionList's live <article>. If SWR hasn't settled yet, the
  // viewport briefly renders stale cached sections that lack the just-
  // streamed final section — a visible flicker. listKey only feeds the
  // sidebar word count and can stay fire-and-forget.
  useEffect(() => {
    if (status !== "done" && status !== "error" && status !== "stopped") return;

    if (status === "error" && streamError) {
      toast.error(streamError.message || "Generation failed");
    }

    const run = async () => {
      // Server saves partial content on error/stop too, so always revalidate.
      if (activeSingleKey) await globalMutate(activeSingleKey);
      void globalMutate(listKey);

      endGeneration();
      prevSectionCountRef.current = 0;
    };
    void run();
  }, [status, streamError, globalMutate, activeSingleKey, listKey, endGeneration]);

  // Pending-steer orchestration (Task 7.3 "Steer" button).
  //
  // `onSteer(note)` stores the note here and calls stop(). The terminal-state
  // effect above then awaits SWR revalidation (so `data.sections` reflects any
  // partial content the server persisted) before calling endGeneration(),
  // which flips `isStreaming` to false.
  //
  // This effect observes that transition: when we are no longer streaming and
  // a pending note is present, read the freshly revalidated chapter, pick the
  // last persisted section id, and dispatch a `continue`-mode generation using
  // that id as the pivot. The key invariant: the pivot is the last section
  // ID AFTER server-side persistence — never the pre-stop id.
  const pendingSteerNoteRef = useRef<string | null>(null);
  useEffect(() => {
    if (isStreaming) return;
    const note = pendingSteerNoteRef.current;
    if (note === null) return;
    if (!data || data.sections.length === 0) {
      // Nothing persisted yet — cannot continue without a pivot. Drop the
      // request rather than silently misbehaving.
      pendingSteerNoteRef.current = null;
      toast.error("No content to steer from yet.");
      return;
    }
    const lastSectionId = data.sections[data.sections.length - 1].id;
    pendingSteerNoteRef.current = null;
    startGeneration(chapterId!);
    start({
      storySlug: slug,
      chapterId: chapterId!,
      mode: "continue",
      sectionId: lastSectionId,
      regenNote: note,
    });
  }, [isStreaming, data, chapterId, slug, startGeneration, start]);

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

  const overlayActive = isStreaming && activeChapterId === chapterId;

  const handleStop = () => {
    stop();
  };

  const handleSteer = (note: string) => {
    // Record the note, then stop. The secondary effect above picks up the
    // transition to !isStreaming and dispatches a continue-mode generation
    // using the freshly revalidated last-section id as the pivot.
    pendingSteerNoteRef.current = note;
    stop();
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
      {overlayActive ? (
        <StreamOverlay onStop={handleStop} onSteer={handleSteer} />
      ) : null}
    </div>
  );
}
