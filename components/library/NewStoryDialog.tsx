"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Story } from "@/lib/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface NewStoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (story: Story) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function NewStoryDialog({ open, onOpenChange, onCreated }: NewStoryDialogProps) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [authorPenName, setAuthorPenName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function resetForm() {
    setTitle("");
    setAuthorPenName("");
    setSubmitting(false);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) resetForm();
    onOpenChange(nextOpen);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/stories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmedTitle, authorPenName: authorPenName.trim() }),
      });

      const json = await res.json();
      if (!json.ok) {
        toast.error(json.error ?? "Failed to create story");
        return;
      }

      const story = json.data as Story;
      onOpenChange(false);
      resetForm();
      onCreated?.(story);
      router.push(`/s/${story.slug}`);
    } catch {
      toast.error("Failed to create story");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton>
        <DialogHeader>
          <DialogTitle>New story</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-story-title">Title</Label>
            <Input
              id="new-story-title"
              placeholder="e.g. The Dark Garden"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              required
              minLength={1}
              autoComplete="off"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-story-pen-name">
              Author pen name{" "}
              <span className="text-xs text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              id="new-story-pen-name"
              placeholder="e.g. J. Hightower"
              value={authorPenName}
              onChange={(e) => setAuthorPenName(e.target.value)}
              autoComplete="off"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !title.trim()}>
              {submitting ? "Creating…" : "Create story"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
