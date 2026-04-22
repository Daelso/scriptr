"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";

type Meta = {
  chapterIndex: number;
  priorRecapCount: number;
  includesLastChapterFullText: boolean;
  model: string;
};

type PromptData = { system: string; user: string; meta: Meta };

type FetchState =
  | { status: "loading" }
  | { status: "success"; data: PromptData }
  | { status: "error"; error: string };

interface CopyPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  chapterId: string;
}

async function fetchPrompt(
  slug: string,
  chapterId: string,
): Promise<FetchState> {
  try {
    const res = await fetch(`/api/stories/${slug}/chapters/${chapterId}/prompt`);
    const json = (await res.json()) as
      | { ok: true; data: PromptData }
      | { ok: false; error: string };
    if (json.ok) return { status: "success", data: json.data };
    return { status: "error", error: json.error };
  } catch {
    return { status: "error", error: "network error" };
  }
}

export function CopyPromptDialog({
  open,
  onOpenChange,
  slug,
  chapterId,
}: CopyPromptDialogProps) {
  const [state, setState] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState({ status: "loading" });
    (async () => {
      const next = await fetchPrompt(slug, chapterId);
      if (!cancelled) setState(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, slug, chapterId]);

  const pasteable =
    state.status === "success"
      ? `${state.data.system}\n\n${state.data.user}`
      : "";

  async function handleCopy() {
    if (!pasteable) return;
    try {
      await navigator.clipboard.writeText(pasteable);
      toast.success("Prompt copied");
    } catch {
      toast.message("Select and copy manually (Cmd/Ctrl+C)");
    }
  }

  async function handleRetry() {
    setState({ status: "loading" });
    setState(await fetchPrompt(slug, chapterId));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Copy chapter prompt</DialogTitle>
          <DialogDescription>
            The exact prompt scriptr would send to Grok for this chapter.
            Paste it into the Grok web UI chat, then bring the prose back via
            Import chapter.
          </DialogDescription>
        </DialogHeader>

        {state.status === "loading" && (
          <div className="py-8 text-sm text-muted-foreground">Building prompt…</div>
        )}

        {state.status === "error" && (
          <div className="py-4">
            <div className="text-sm text-destructive">Error: {state.error}</div>
            <Button variant="outline" onClick={handleRetry} className="mt-3">
              Retry
            </Button>
          </div>
        )}

        {state.status === "success" && (
          <>
            <div className="text-xs text-muted-foreground">
              Chapter {state.data.meta.chapterIndex} ·{" "}
              {state.data.meta.priorRecapCount}{" "}
              {state.data.meta.priorRecapCount === 1
                ? "prior recap"
                : "prior recaps"}{" "}
              · last-chapter full text:{" "}
              {state.data.meta.includesLastChapterFullText ? "on" : "off"} ·
              model: {state.data.meta.model}
            </div>
            <ScrollArea className="h-96 rounded border bg-muted/40">
              <pre className="p-3 text-xs font-mono whitespace-pre-wrap break-words">
                {pasteable}
              </pre>
            </ScrollArea>
            <div className="text-xs text-muted-foreground">
              ~{pasteable.length} chars · ~{Math.ceil(pasteable.length / 4)} tokens (rough)
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={handleCopy} disabled={state.status !== "success"}>
            Copy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
