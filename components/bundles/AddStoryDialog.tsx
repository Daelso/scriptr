"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Story } from "@/lib/types";

const fetcher = async (url: string): Promise<Story[]> => {
  const res = await fetch(url);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "request failed");
  return json.data as Story[];
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  excludeSlugs: string[];
  onAdd: (slugs: string[]) => void | Promise<void>;
};

export function AddStoryDialog({ open, onOpenChange, excludeSlugs, onAdd }: Props) {
  const { data } = useSWR<Story[]>("/api/stories", fetcher);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const eligible = (data ?? []).filter((s) => !excludeSlugs.includes(s.slug));

  function toggle(slug: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  async function handleAdd() {
    await onAdd(Array.from(selected));
    handleOpenChange(false);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) setSelected(new Set());
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add stories</DialogTitle>
          <DialogDescription>
            Select stories to append to this bundle.
          </DialogDescription>
        </DialogHeader>
        {eligible.length === 0 ? (
          <div className="text-sm text-muted-foreground py-3">
            All stories are already in this bundle.
          </div>
        ) : (
          <ul className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto">
            {eligible.map((s) => (
              <li key={s.slug}>
                <label className="flex items-center gap-3 p-2 hover:bg-muted/40 rounded cursor-pointer">
                  <input
                    type="checkbox"
                    className="size-4 cursor-pointer"
                    checked={selected.has(s.slug)}
                    onChange={() => toggle(s.slug)}
                    data-testid={`add-story-check-${s.slug}`}
                  />
                  <div>
                    <div className="text-sm font-medium">{s.title}</div>
                    <div className="text-xs text-muted-foreground">{s.authorPenName || "—"}</div>
                  </div>
                </label>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button
            disabled={selected.size === 0}
            onClick={() => void handleAdd()}
            data-testid="add-story-confirm"
          >
            Add {selected.size > 0 ? `(${selected.size})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
