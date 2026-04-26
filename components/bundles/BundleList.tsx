"use client";

import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { toast } from "sonner";
import { MoreHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NewBundleDialog } from "@/components/bundles/NewBundleDialog";
import type { BundleSummary } from "@/lib/types";

const fetcher = async (url: string): Promise<BundleSummary[]> => {
  const res = await fetch(url);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "request failed");
  return json.data as BundleSummary[];
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function BundleList() {
  const { data, mutate } = useSWR<BundleSummary[]>("/api/bundles", fetcher);
  const [newOpen, setNewOpen] = useState(false);
  const [pendingDeleteSlug, setPendingDeleteSlug] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleConfirmDelete() {
    if (!pendingDeleteSlug) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/bundles/${pendingDeleteSlug}`, { method: "DELETE" });
      const body = await res.json();
      if (!body.ok) {
        toast.error(body.error ?? "Delete failed");
        return;
      }
      setPendingDeleteSlug(null);
      void mutate();
    } finally {
      setDeleting(false);
    }
  }

  if (!data) {
    return <div className="text-sm text-muted-foreground">Loading bundles…</div>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Bundles</h1>
        <Button onClick={() => setNewOpen(true)} data-testid="bundle-new">
          New bundle
        </Button>
      </div>

      {data.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          No bundles yet. Create one to combine stories into a single EPUB.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {data.map((b) => (
            <Card key={b.slug} className="hover:bg-muted/40 transition-colors">
              <CardHeader>
                <CardTitle>
                  <Link
                    href={`/bundles/${b.slug}`}
                    className="hover:underline"
                    data-testid={`bundle-card-${b.slug}`}
                  >
                    {b.title}
                  </Link>
                </CardTitle>
                <CardDescription>
                  {b.storyCount} {b.storyCount === 1 ? "story" : "stories"} ·
                  {" "}
                  {relativeTime(b.updatedAt)}
                </CardDescription>
                <CardAction>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button variant="ghost" size="icon" aria-label="bundle actions" />
                      }
                    >
                      <MoreHorizontal className="size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => setPendingDeleteSlug(b.slug)}
                        data-testid={`bundle-delete-${b.slug}`}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardAction>
              </CardHeader>
              <CardContent />
            </Card>
          ))}
        </div>
      )}

      <NewBundleDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreated={() => void mutate()}
      />

      <Dialog
        open={pendingDeleteSlug !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteSlug(null);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete this bundle?</DialogTitle>
            <DialogDescription>
              This removes <code>data/bundles/{pendingDeleteSlug}/</code> recursively, including any built EPUB files. The member stories themselves are not affected. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingDeleteSlug(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleConfirmDelete()}
              disabled={deleting}
              data-testid="bundle-delete-confirm"
            >
              {deleting ? "Deleting…" : "Delete bundle"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
