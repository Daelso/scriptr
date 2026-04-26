"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
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

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
};

export function NewBundleDialog({ open, onOpenChange, onCreated }: Props) {
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  async function submit() {
    const t = title.trim();
    if (!t) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/bundles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: t }),
      });
      const body = await res.json();
      if (!body.ok) {
        toast.error(body.error ?? "Create failed");
        return;
      }
      onCreated();
      onOpenChange(false);
      setTitle("");
      router.push(`/bundles/${body.data.slug}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New bundle</DialogTitle>
          <DialogDescription>
            A bundle combines multiple stories into a single EPUB.
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          placeholder="Bundle title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          data-testid="new-bundle-title"
        />
        <DialogFooter>
          <Button
            onClick={() => void submit()}
            disabled={submitting || title.trim() === ""}
            data-testid="new-bundle-create"
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
