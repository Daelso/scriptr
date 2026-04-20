"use client";

import { useEffect, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
  const startSectionRegen = useGenerationStore((s) => s.startSectionRegen);
  const endSectionRegen = useGenerationStore((s) => s.endSectionRegen);
  const activeChapterId = useGenerationStore((s) => s.activeChapterId);
  const regeneratingChapterId = useGenerationStore(
    (s) => s.regeneratingChapterId,
  );
  const isStreaming = useGenerationStore((s) => s.isStreaming);
  const lastRunMode = useGenerationStore((s) => s.lastRunMode);

  // Section-delete confirm dialog. Keeps the destructive action gated behind
  // a shadcn Dialog to mirror ChapterList's pattern.
  const [pendingDeleteSectionId, setPendingDeleteSectionId] = useState<
    string | null
  >(null);
  const [deletingSection, setDeletingSection] = useState(false);

  // Revalidate the chapter that is actively streaming, not the chapter the
  // user is currently viewing — they can diverge if the user switches the
  // nav pane mid-stream.
  const activeSingleKey = activeChapterId
    ? `/api/stories/${slug}/chapters/${activeChapterId}`
    : null;

  // Section-mode analogue: the chapter that owns the section being
  // regenerated. `activeChapterId` is intentionally null during section regen,
  // so we can't reuse `activeSingleKey` — we'd fall back to the viewer's
  // `singleKey`, which points to a different chapter if the user navigated
  // away mid-stream, leaving the real target chapter's SWR cache stale.
  const regenChapterKey = regeneratingChapterId
    ? `/api/stories/${slug}/chapters/${regeneratingChapterId}`
    : null;

  // Mirror the hook's last-section text into the store. Only the tail section
  // is "live"; earlier sections are already persisted on disk and will appear
  // via SWR revalidation on each section-break.
  //
  // Chapter-mode only: section-mode regen uses a skeleton shimmer and does not
  // display tokens in real time, so we skip the mirror entirely when
  // `lastRunMode === "section"`. The server never emits `section-break` for
  // section mode either — it's a single accumulated run, replaced on `done`.
  const prevSectionCountRef = useRef(0);
  useEffect(() => {
    if (!isStreaming) return;
    if (lastRunMode !== "chapter") return;
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
  }, [isStreaming, lastRunMode, streamSections, setLiveText, flushLiveSection, globalMutate, activeSingleKey]);

  // Handle terminal stream states: done / error / stopped. Revalidate SWR so
  // the final persisted sections appear, then reset the store.
  //
  // IMPORTANT: we await the single-key revalidation BEFORE calling
  // end*Generation(). End actions zero isStreaming, which unmounts the
  // relevant live UI. If SWR hasn't settled yet, the viewport briefly renders
  // stale cached sections that lack the just-streamed final section — a
  // visible flicker. listKey only feeds the sidebar word count and can stay
  // fire-and-forget.
  //
  // Mode routing: `lastRunMode` tells us whether to call endGeneration()
  // (chapter mode) or endSectionRegen() (section mode). For section regen,
  // the relevant SWR key is derived from `regeneratingChapterId` — the
  // chapter that owned the section when the regen started. We can't use
  // the viewer's `singleKey` because the user may have navigated to a
  // different chapter mid-stream; revalidating the viewed chapter would
  // leave the real target's client cache stale until the user returns.
  useEffect(() => {
    if (status !== "done" && status !== "error" && status !== "stopped") return;

    if (status === "error" && streamError) {
      toast.error(streamError.message || "Generation failed");
    }

    const modeAtTerminal = lastRunMode;

    const run = async () => {
      if (modeAtTerminal === "section") {
        // Section regen was scoped to `regeneratingChapterId`. Revalidate
        // that chapter so the replaced section content (or the untouched
        // original on error) appears — even if the user has since navigated
        // to a different chapter.
        if (regenChapterKey) await globalMutate(regenChapterKey);
        // Word count may have shifted if the replacement is a different
        // length — refresh the sidebar.
        void globalMutate(listKey);
        endSectionRegen();
      } else {
        // Chapter mode (or a stop issued with no prior start — shouldn't
        // happen, but falls through to chapter cleanup safely since
        // endGeneration is idempotent).
        //
        // Server saves partial content on error/stop too, so always revalidate.
        if (activeSingleKey) await globalMutate(activeSingleKey);
        void globalMutate(listKey);
        endGeneration();
        prevSectionCountRef.current = 0;
      }
    };
    void run();
  }, [
    status,
    streamError,
    globalMutate,
    activeSingleKey,
    regenChapterKey,
    listKey,
    endGeneration,
    endSectionRegen,
    lastRunMode,
  ]);

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

  // ── Section regen / delete orchestration ────────────────────────────────

  const handleSectionRegenerate = (sectionId: string) => {
    if (isStreaming || !chapterId) return;
    startSectionRegen(sectionId, chapterId);
    start({ storySlug: slug, chapterId, mode: "section", sectionId });
  };

  const handleSectionRegenerateWithNote = (sectionId: string, note: string) => {
    if (isStreaming || !chapterId) return;
    startSectionRegen(sectionId, chapterId);
    start({
      storySlug: slug,
      chapterId,
      mode: "section",
      sectionId,
      regenNote: note,
    });
  };

  const handleSectionDeleteRequest = (sectionId: string) => {
    if (isStreaming) return;
    setPendingDeleteSectionId(sectionId);
  };

  const handleConfirmSectionDelete = async () => {
    if (!pendingDeleteSectionId || !data || !chapterId) return;
    setDeletingSection(true);
    const nextSections = data.sections.filter((s) => s.id !== pendingDeleteSectionId);
    try {
      const res = await fetch(`/api/stories/${slug}/chapters/${chapterId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections: nextSections }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "delete failed");
      setPendingDeleteSectionId(null);
      if (singleKey) await globalMutate(singleKey);
      void globalMutate(listKey);
    } catch {
      toast.error("Failed to delete section");
    } finally {
      setDeletingSection(false);
    }
  };

  const pendingDeleteSection =
    pendingDeleteSectionId !== null
      ? data.sections.find((s) => s.id === pendingDeleteSectionId) ?? null
      : null;

  // Inline-edit save handler. Overlays the new body onto the current
  // `data.sections` and PATCHes the chapter. Throws on server error so the
  // SectionEditor's useAutoSave surfaces an "error" status and the toast
  // fires. SWR revalidation keeps the sidebar word-count fresh.
  const handleSectionSaveBody = async (
    sectionId: string,
    newContent: string,
  ) => {
    if (!chapterId) return;
    // Read the current sections at call time — `data` is the freshest SWR
    // value since the parent re-renders on every revalidation, which updates
    // this closure (and the autosave hook's `saveRef`).
    const nextSections = data.sections.map((s) =>
      s.id === sectionId ? { ...s, content: newContent } : s,
    );
    let res: Response;
    try {
      res = await fetch(`/api/stories/${slug}/chapters/${chapterId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections: nextSections }),
      });
    } catch {
      toast.error("Failed to save edit");
      throw new Error("network error");
    }
    const json = (await res.json()) as { ok: boolean; error?: string };
    if (!json.ok) {
      toast.error("Failed to save edit");
      throw new Error(json.error ?? "save failed");
    }
    if (singleKey) await globalMutate(singleKey);
    void globalMutate(listKey);
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
          onSectionRegenerate={handleSectionRegenerate}
          onSectionRegenerateWithNote={handleSectionRegenerateWithNote}
          onSectionDelete={handleSectionDeleteRequest}
          onSectionSaveBody={handleSectionSaveBody}
        />
      </div>
      {overlayActive ? (
        <StreamOverlay onStop={handleStop} onSteer={handleSteer} />
      ) : null}

      <Dialog
        open={pendingDeleteSectionId !== null}
        onOpenChange={(open) => {
          if (!open && !deletingSection) setPendingDeleteSectionId(null);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete this section?</DialogTitle>
            <DialogDescription>
              {pendingDeleteSection
                ? "The section text will be removed from this chapter. This cannot be undone."
                : "This cannot be undone."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingDeleteSectionId(null)}
              disabled={deletingSection}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmSectionDelete}
              disabled={deletingSection}
            >
              {deletingSection ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
