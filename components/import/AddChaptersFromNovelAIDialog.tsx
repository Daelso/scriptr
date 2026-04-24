"use client";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ChapterEditList } from "@/components/import/ChapterEditList";
import { renderChapterPreviewHtml, EPUB_STYLESHEET } from "@/lib/publish/epub-preview";
import { SafeHtml } from "@/lib/publish/safe-html";
import type { Chapter } from "@/lib/types";
import type { ParsedStory, ProposedChapter, SplitResult } from "@/lib/novelai/types";

type Props = {
  slug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (chapterIds: string[]) => void;
};

type ParseOk = {
  ok: true;
  data: {
    parsed: ParsedStory;
    split: SplitResult;
    proposed: unknown; // not used in this mode
  };
};
type ParseErr = { ok: false; error: string };

type Stage =
  | { kind: "idle" }
  | { kind: "parsing" }
  | { kind: "error"; message: string }
  | { kind: "preview"; split: SplitResult };

function countWords(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

export function AddChaptersFromNovelAIDialog({
  slug,
  open,
  onOpenChange,
  onImported,
}: Props) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [chapters, setChapters] = useState<ProposedChapter[]>([]);
  const [generateRecap, setGenerateRecap] = useState(false);
  const [saving, setSaving] = useState(false);

  const reset = useCallback(() => {
    setStage({ kind: "idle" });
    setChapters([]);
    setGenerateRecap(false);
  }, []);

  const onFile = useCallback(async (f: File) => {
    setStage({ kind: "parsing" });
    const fd = new FormData();
    fd.append("file", f);
    try {
      const res = await fetch("/api/import/novelai/parse", {
        method: "POST",
        body: fd,
      });
      const body = (await res.json()) as ParseOk | ParseErr;
      if (!body.ok) {
        setStage({ kind: "error", message: body.error });
        return;
      }
      setStage({ kind: "preview", split: body.data.split });
      setChapters(body.data.split.chapters);
    } catch (err) {
      setStage({
        kind: "error",
        message: err instanceof Error ? err.message : "Import failed — try again.",
      });
    }
  }, []);

  const previewHtml = useMemo(() => {
    return chapters.map((ch, i) => {
      const title = ch.title.trim() || "Untitled";
      const stub: Chapter = {
        id: `preview-${i}`,
        title,
        summary: "",
        beats: [],
        prompt: "",
        recap: "",
        sections: [{ id: `s-${i}`, content: ch.body }],
        wordCount: countWords(ch.body),
      };
      return renderChapterPreviewHtml(stub, { chapterNumber: i + 1 });
    });
  }, [chapters]);

  const onCommit = useCallback(async () => {
    if (stage.kind !== "preview") return;
    setSaving(true);
    const committed = chapters.map((c) => ({ title: c.title.trim() || "Untitled", body: c.body }));
    try {
      const res = await fetch("/api/import/novelai/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target: "existing-story",
          slug,
          chapters: committed,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        toast.error(body.error ?? `Import failed (${res.status})`);
        return;
      }
      const chapterIds: string[] = body.data.chapterIds;
      toast.success(`Added ${committed.length} chapter${committed.length === 1 ? "" : "s"}.`);
      onImported(chapterIds);
      onOpenChange(false);
      reset();

      if (generateRecap) {
        void (async () => {
          for (let i = 0; i < chapterIds.length; i++) {
            const id = chapterIds[i];
            const title = committed[i]?.title ?? "Untitled";
            try {
              const recapRes = await fetch("/api/generate/recap", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ storySlug: slug, chapterId: id }),
              });
              if (!recapRes.ok) {
                toast.error(`Recap failed for "${title}".`);
              } else if (chapterIds.length > 1) {
                toast.success(`Recap ready for "${title}".`);
              }
            } catch {
              toast.error(`Recap failed for "${title}".`);
            }
          }
        })();
      }
    } finally {
      setSaving(false);
    }
  }, [stage, slug, chapters, generateRecap, onImported, onOpenChange, reset]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-stretch justify-center">
      <div className="bg-background border border-border rounded w-full max-w-[1400px] m-4 flex flex-col">
        <div className="border-b border-border px-4 py-2 text-sm font-semibold">
          Import chapters from .story
        </div>

        {stage.kind === "idle" && (
          <div className="p-8 flex-1 flex flex-col items-center justify-center gap-3">
            <p className="text-sm text-muted-foreground">
              Choose a NovelAI <code>.story</code> file to append as chapters.
            </p>
            <input
              type="file"
              accept=".story,application/json"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
              data-testid="novelai-file-input"
            />
          </div>
        )}

        {stage.kind === "parsing" && (
          <div className="p-8 flex-1 flex items-center justify-center text-sm text-muted-foreground">
            Parsing…
          </div>
        )}

        {stage.kind === "error" && (
          <div className="p-8 flex-1 flex flex-col items-center justify-center gap-3">
            <p className="text-sm text-destructive">{stage.message}</p>
            <Button type="button" variant="outline" onClick={reset}>
              Choose a different file
            </Button>
          </div>
        )}

        {stage.kind === "preview" && (
          <div className="grid grid-cols-[1fr_1fr] flex-1 min-h-0">
            <div className="p-4 border-r border-border flex flex-col gap-3 overflow-auto">
              <div className="border border-border rounded bg-muted/30 p-2 text-xs text-muted-foreground">
                Description, lorebook, and tags from this .story file are ignored in this mode.
                Use <em>Import from NovelAI</em> on the home page to import everything.
              </div>
              <ChapterEditList
                chapters={chapters}
                splitSource={stage.split.splitSource}
                onChange={setChapters}
              />
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={generateRecap}
                  onChange={(e) => setGenerateRecap(e.target.checked)}
                />
                Generate recap via Grok (sends prose to xAI)
              </label>
            </div>

            <div className="p-4 flex flex-col gap-2 overflow-auto">
              <div className="text-xs uppercase text-muted-foreground">EPUB preview</div>
              <style>{EPUB_STYLESHEET}</style>
              <div className="flex-1 overflow-auto border border-border rounded p-4 bg-background">
                {previewHtml.map((html, i) => (
                  <div key={i}>
                    {i > 0 && (
                      <div className="flex items-center gap-2 my-6 text-xs uppercase text-muted-foreground">
                        <div className="flex-1 border-t border-border" />
                        <span>Chapter {i + 1}</span>
                        <div className="flex-1 border-t border-border" />
                      </div>
                    )}
                    <SafeHtml html={html} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="border-t border-border px-4 py-3 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              reset();
            }}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onCommit}
            disabled={saving || stage.kind !== "preview" || chapters.length === 0}
          >
            {saving
              ? "Adding…"
              : `Add ${chapters.length} chapter${chapters.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
