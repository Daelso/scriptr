"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Trash2, ArrowDownToLine } from "lucide-react";
import type { ProposedChapter, SplitSource } from "@/lib/novelai/types";

type Props = {
  chapters: ProposedChapter[];
  splitSource: SplitSource;
  onChange: (next: ProposedChapter[]) => void;
};

const SPLIT_LABEL: Record<SplitSource, string> = {
  marker: "Split by //// markers",
  heading: "Split by chapter headings",
  "scenebreak-fallback": "Split by scene breaks (verify)",
  none: "Single chapter",
};

function wordCount(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

export function ChapterEditList({ chapters, splitSource, onChange }: Props) {
  function updateAt(i: number, patch: Partial<ProposedChapter>) {
    onChange(chapters.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
  function deleteAt(i: number) {
    onChange(chapters.filter((_, idx) => idx !== i));
  }
  function mergeWithNext(i: number) {
    if (i >= chapters.length - 1) return;
    const merged: ProposedChapter = {
      title: chapters[i].title,
      body: `${chapters[i].body}\n\n${chapters[i + 1].body}`.trim(),
    };
    const next: ProposedChapter[] = [
      ...chapters.slice(0, i),
      merged,
      ...chapters.slice(i + 2),
    ];
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs uppercase text-muted-foreground">
        {SPLIT_LABEL[splitSource]} · {chapters.length} chapter
        {chapters.length === 1 ? "" : "s"}
      </div>
      {chapters.map((ch, i) => (
        <div
          key={i}
          className="border border-border rounded p-3 flex flex-col gap-2"
        >
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground tabular-nums w-8">
              {String(i + 1).padStart(2, "0")}
            </span>
            <Input
              value={ch.title}
              onChange={(e) => updateAt(i, { title: e.target.value })}
              placeholder="Untitled"
              className="flex-1 text-sm"
            />
            <span className="text-xs text-muted-foreground tabular-nums">
              {wordCount(ch.body).toLocaleString()} words
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Merge with next"
              title="Merge with next chapter"
              onClick={() => mergeWithNext(i)}
              disabled={i >= chapters.length - 1}
            >
              <ArrowDownToLine className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Delete chapter ${i + 1}`}
              onClick={() => deleteAt(i)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
          <Textarea
            value={ch.body}
            onChange={(e) => updateAt(i, { body: e.target.value })}
            className="font-mono text-xs min-h-[120px]"
          />
        </div>
      ))}
    </div>
  );
}
