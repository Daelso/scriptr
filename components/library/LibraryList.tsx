"use client";

import { useState } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MoreHorizontal, BookOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { NewStoryDialog } from "@/components/library/NewStoryDialog";
import { NewStoryFromNovelAIDialog } from "@/components/import/NewStoryFromNovelAIDialog";
import type { Story } from "@/lib/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  return `${Math.floor(months / 12)}y ago`;
}

// ─── Fetcher ──────────────────────────────────────────────────────────────────

const fetcher = async (url: string): Promise<Story[]> => {
  const res = await fetch(url);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "request failed");
  return json.data as Story[];
};

// ─── Sub-components ───────────────────────────────────────────────────────────

interface StoryCardProps {
  story: Story;
  onDeleteClick: (story: Story) => void;
}

function StoryCard({ story, onDeleteClick }: StoryCardProps) {
  const router = useRouter();
  const chapterCount = story.chapterOrder.length;

  return (
    <Card
      className="cursor-pointer transition-shadow hover:shadow-md focus-within:ring-2 focus-within:ring-ring"
      onClick={() => router.push(`/s/${story.slug}`)}
    >
      <CardHeader>
        <CardTitle className="truncate">{story.title}</CardTitle>
        {story.authorPenName && (
          <CardDescription className="truncate">{story.authorPenName}</CardDescription>
        )}
        <CardAction>
          {/* Intercept click so card nav doesn't fire when opening the menu */}
          <DropdownMenu>
            <DropdownMenuTrigger
              onClick={(e) => e.stopPropagation()}
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Options for "${story.title}"`}
                />
              }
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              onClick={(e) => e.stopPropagation()}
              align="end"
            >
              <DropdownMenuItem
                variant="destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteClick(story);
                }}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">
          {chapterCount} {chapterCount === 1 ? "chapter" : "chapters"} · edited {relativeTime(story.updatedAt)}
        </p>
      </CardContent>
    </Card>
  );
}

interface DeleteConfirmDialogProps {
  story: Story | null;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  deleting: boolean;
}

function DeleteConfirmDialog({ story, onClose, onConfirm, deleting }: DeleteConfirmDialogProps) {
  return (
    <Dialog open={story !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Delete &ldquo;{story?.title}&rdquo;?</DialogTitle>
          <DialogDescription>This cannot be undone.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={deleting}>
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function LibraryList() {
  const { data, isLoading, mutate } = useSWR<Story[]>("/api/stories", fetcher);

  const [newStoryOpen, setNewStoryOpen] = useState(false);
  const [novelaiOpen, setNovelaiOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Story | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleConfirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/stories/${pendingDelete.slug}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "delete failed");
      toast.success("Story deleted");
      setPendingDelete(null);
      await mutate();
    } catch {
      toast.error("Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  if (isLoading || !data) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }

  const isEmpty = data.length === 0;

  return (
    <>
      {isEmpty ? (
        /* ── Empty state ───────────────────────────────────────────────── */
        <div className="flex flex-col items-center justify-center gap-6 py-24 text-center">
          <BookOpen className="size-12 text-muted-foreground/40" strokeWidth={1.25} />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">No stories yet. Create one to get going.</p>
          </div>
          <Button onClick={() => setNewStoryOpen(true)}>New story</Button>
          <Button variant="outline" onClick={() => setNovelaiOpen(true)}>
            Import from NovelAI
          </Button>
        </div>
      ) : (
        /* ── Populated state ───────────────────────────────────────────── */
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Your stories
            </h2>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => setNewStoryOpen(true)}>
                New story
              </Button>
              <Button size="sm" variant="outline" onClick={() => setNovelaiOpen(true)}>
                Import from NovelAI
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.map((story) => (
              <StoryCard
                key={story.slug}
                story={story}
                onDeleteClick={setPendingDelete}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── New story dialog ──────────────────────────────────────────── */}
      <NewStoryDialog
        open={newStoryOpen}
        onOpenChange={setNewStoryOpen}
      />

      {/* ── Import from NovelAI dialog ────────────────────────────────── */}
      <NewStoryFromNovelAIDialog open={novelaiOpen} onOpenChange={setNovelaiOpen} />

      {/* ── Delete confirm dialog ─────────────────────────────────────── */}
      <DeleteConfirmDialog
        story={pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={handleConfirmDelete}
        deleting={deleting}
      />
    </>
  );
}
