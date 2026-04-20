"use client";

import { useState, useCallback } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Plus } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChapterListItem } from "@/components/editor/ChapterListItem";
import type { Chapter } from "@/lib/types";

// ─── Fetcher ──────────────────────────────────────────────────────────────────

const fetcher = async (url: string): Promise<Chapter[]> => {
  const res = await fetch(url);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "request failed");
  return json.data as Chapter[];
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChapterListProps {
  slug: string;
  selectedChapterId: string | null;
  onSelect: (id: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ChapterList({ slug, selectedChapterId, onSelect }: ChapterListProps) {
  const { data, mutate } = useSWR<Chapter[]>(
    `/api/stories/${slug}/chapters`,
    fetcher,
  );

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [newChapterTitle, setNewChapterTitle] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // ── DnD sensors ───────────────────────────────────────────────────────────

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // ── Drag end (reorder) ────────────────────────────────────────────────────

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id || !data) return;

      const oldIndex = data.findIndex((c) => c.id === active.id);
      const newIndex = data.findIndex((c) => c.id === over.id);
      const reordered = arrayMove(data, oldIndex, newIndex);

      // Optimistic update
      await mutate(reordered, { revalidate: false });

      try {
        const res = await fetch(`/api/stories/${slug}/chapters/reorder`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order: reordered.map((c) => c.id) }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error ?? "reorder failed");
        await mutate();
      } catch {
        // Revert
        await mutate(data, { revalidate: false });
        toast.error("Failed to reorder chapters");
      }
    },
    [data, mutate, slug],
  );

  // ── New chapter ───────────────────────────────────────────────────────────

  async function handleCreateChapter(title: string) {
    const trimmed = title.trim();
    if (!trimmed) {
      setNewChapterTitle(null);
      return;
    }
    setCreating(true);
    try {
      const res = await fetch(`/api/stories/${slug}/chapters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "create failed");
      const created = json.data as Chapter;
      await mutate();
      onSelect(created.id);
      setNewChapterTitle(null);
    } catch {
      toast.error("Failed to create chapter");
    } finally {
      setCreating(false);
    }
  }

  function handleNewChapterKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      const val = (e.target as HTMLInputElement).value;
      void handleCreateChapter(val);
    } else if (e.key === "Escape") {
      setNewChapterTitle(null);
    }
  }

  function handleNewChapterBlur(e: React.FocusEvent<HTMLInputElement>) {
    // Cancel on blur (don't create)
    const val = e.target.value.trim();
    if (val) {
      void handleCreateChapter(val);
    } else {
      setNewChapterTitle(null);
    }
  }

  // ── Rename ────────────────────────────────────────────────────────────────

  async function handleRenameCommit(id: string, title: string) {
    const trimmed = title.trim();
    if (!trimmed) {
      setRenamingId(null);
      return;
    }
    setRenamingId(null);
    try {
      const res = await fetch(`/api/stories/${slug}/chapters/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "rename failed");
      await mutate();
    } catch {
      toast.error("Failed to rename chapter");
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async function handleConfirmDelete() {
    if (!pendingDeleteId || !data) return;
    setDeleting(true);
    const deletedId = pendingDeleteId;

    // Determine which chapter to select after deletion
    const idx = data.findIndex((c) => c.id === deletedId);
    const nextSelected =
      selectedChapterId === deletedId
        ? (data[idx - 1]?.id ?? data[idx + 1]?.id ?? null)
        : selectedChapterId;

    try {
      const res = await fetch(`/api/stories/${slug}/chapters/${deletedId}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "delete failed");
      setPendingDeleteId(null);
      await mutate();
      if (selectedChapterId === deletedId && nextSelected) {
        onSelect(nextSelected);
      }
    } catch {
      toast.error("Failed to delete chapter");
    } finally {
      setDeleting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const chapters = data ?? [];

  return (
    <>
      {/* ── Section heading ──────────────────────────────────────────────── */}
      <div className="px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Chapters
        </h2>
      </div>

      {/* ── Chapter list ─────────────────────────────────────────────────── */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={chapters.map((c) => c.id)}
          strategy={verticalListSortingStrategy}
        >
          {chapters.map((chapter, idx) => (
            <ChapterListItem
              key={chapter.id}
              chapter={chapter}
              ordinal={idx + 1}
              isSelected={chapter.id === selectedChapterId}
              isRenaming={chapter.id === renamingId}
              onSelect={() => onSelect(chapter.id)}
              onRenameStart={() => setRenamingId(chapter.id)}
              onRenameCommit={(title) => handleRenameCommit(chapter.id, title)}
              onRenameCancel={() => setRenamingId(null)}
              onDelete={() => setPendingDeleteId(chapter.id)}
            />
          ))}
        </SortableContext>
      </DndContext>

      {/* ── Empty state ──────────────────────────────────────────────────── */}
      {chapters.length === 0 && data !== undefined && (
        <p className="px-3 text-xs text-muted-foreground">No chapters yet.</p>
      )}

      {/* ── New chapter input / button ────────────────────────────────────── */}
      <div className="px-2 py-1.5">
        {newChapterTitle !== null ? (
          <Input
            autoFocus
            placeholder="Chapter title…"
            value={newChapterTitle}
            onChange={(e) => setNewChapterTitle(e.target.value)}
            onKeyDown={handleNewChapterKeyDown}
            onBlur={handleNewChapterBlur}
            className="h-7 text-xs"
            disabled={creating}
          />
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setNewChapterTitle("")}
            className="w-full justify-start gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <Plus className="size-3.5" />
            New chapter
          </Button>
        )}
      </div>

      {/* ── Delete confirm dialog ─────────────────────────────────────────── */}
      {(() => {
        const chapter = chapters.find((c) => c.id === pendingDeleteId);
        return (
          <Dialog
            open={pendingDeleteId !== null}
            onOpenChange={(open) => {
              if (!open) setPendingDeleteId(null);
            }}
          >
            <DialogContent showCloseButton={false}>
              <DialogHeader>
                <DialogTitle>
                  Delete &ldquo;{chapter?.title ?? "this chapter"}&rdquo;?
                </DialogTitle>
                <DialogDescription>This cannot be undone.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setPendingDeleteId(null)}
                  disabled={deleting}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleConfirmDelete}
                  disabled={deleting}
                >
                  {deleting ? "Deleting…" : "Delete"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}
    </>
  );
}
