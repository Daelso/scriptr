"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ChapterEditList } from "@/components/import/ChapterEditList";
import type { ParsedStory, ProposedChapter, ProposedWrite, SplitResult } from "@/lib/novelai/types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type ParseOk = {
  ok: true;
  data: {
    parsed: ParsedStory;
    split: SplitResult;
    proposed: ProposedWrite;
  };
};
type ParseErr = { ok: false; error: string };

type Stage =
  | { kind: "idle" }
  | { kind: "parsing" }
  | { kind: "error"; message: string }
  | { kind: "preview"; data: ParseOk["data"] };

export function NewStoryFromNovelAIDialog({ open, onOpenChange }: Props) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [keywords, setKeywords] = useState("");
  const [chapters, setChapters] = useState<ProposedChapter[]>([]);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  const reset = useCallback(() => {
    setStage({ kind: "idle" });
    setTitle("");
    setDescription("");
    setKeywords("");
    setChapters([]);
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
      setStage({ kind: "preview", data: body.data });
      setTitle(body.data.proposed.story.title);
      setDescription(body.data.proposed.story.description);
      setKeywords(body.data.proposed.story.keywords.join(", "));
      setChapters(body.data.split.chapters);
    } catch (err) {
      setStage({
        kind: "error",
        message: err instanceof Error ? err.message : "Import failed — try again.",
      });
    }
  }, []);

  const onCommit = useCallback(async () => {
    if (stage.kind !== "preview") return;
    setSaving(true);
    try {
      const res = await fetch("/api/import/novelai/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target: "new-story",
          story: {
            title: title.trim() || stage.data.proposed.story.title,
            description,
            keywords: keywords
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          },
          bible: stage.data.proposed.bible,
          chapters,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        toast.error(body.error ?? `Import failed (${res.status})`);
        return;
      }
      toast.success(`Created "${title}" (${chapters.length} chapters).`);
      onOpenChange(false);
      reset();
      router.push(`/s/${body.data.slug}`);
    } finally {
      setSaving(false);
    }
  }, [stage, title, description, keywords, chapters, router, onOpenChange, reset]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-stretch justify-center">
      <div className="bg-background border border-border rounded w-full max-w-[1400px] m-4 flex flex-col">
        <div className="border-b border-border px-4 py-2 text-sm font-semibold">
          Import from NovelAI
        </div>

        {stage.kind === "idle" && (
          <div className="p-8 flex-1 flex flex-col items-center justify-center gap-3">
            <p className="text-sm text-muted-foreground">
              Choose a NovelAI <code>.story</code> file to import.
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
          <div className="grid grid-cols-[320px_1fr_320px] flex-1 min-h-0">
            <div className="p-4 border-r border-border flex flex-col gap-3">
              <div>
                <div className="text-xs uppercase text-muted-foreground mb-1">Title</div>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground mb-1">Description</div>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="min-h-[100px] text-sm"
                />
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground mb-1">
                  Keywords (comma-separated)
                </div>
                <Input value={keywords} onChange={(e) => setKeywords(e.target.value)} />
              </div>
            </div>

            <div className="p-4 overflow-auto">
              <ChapterEditList
                chapters={chapters}
                splitSource={stage.data.split.splitSource}
                onChange={setChapters}
              />
            </div>

            <div className="p-4 border-l border-border overflow-auto flex flex-col gap-3">
              <div className="text-xs uppercase text-muted-foreground">Proposed Bible</div>
              <div>
                <div className="text-xs font-semibold mb-1">Characters</div>
                {stage.data.proposed.bible.characters.length === 0 ? (
                  <div className="text-xs text-muted-foreground italic">None</div>
                ) : (
                  <ul className="text-xs flex flex-col gap-1">
                    {stage.data.proposed.bible.characters.map((c, i) => (
                      <li key={i}>
                        <strong>{c.name}</strong>: {c.description.slice(0, 80)}
                        {c.description.length > 80 ? "…" : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <div className="text-xs font-semibold mb-1">Setting</div>
                <pre className="text-xs text-muted-foreground whitespace-pre-wrap">
                  {stage.data.proposed.bible.setting || "(empty)"}
                </pre>
              </div>
              <div>
                <div className="text-xs font-semibold mb-1">Style notes</div>
                <pre className="text-xs text-muted-foreground whitespace-pre-wrap">
                  {stage.data.proposed.bible.styleNotes || "(empty)"}
                </pre>
              </div>
              <p className="text-xs text-muted-foreground italic">
                Edit these in the Bible editor after import.
              </p>
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
            {saving ? "Creating…" : "Create story"}
          </Button>
        </div>
      </div>
    </div>
  );
}
