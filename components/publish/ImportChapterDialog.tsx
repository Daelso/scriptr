"use client";

import { useMemo, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import { BookmarkPlus, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cleanPaste, type CleanupOptions } from "@/lib/publish/cleanup";
import { renderChapterPreviewHtml, EPUB_STYLESHEET } from "@/lib/publish/epub-preview";
import { SafeHtml } from "@/lib/publish/safe-html";
import type { Chapter } from "@/lib/types";

type Props = {
  slug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (chapters: Chapter[]) => void;
};

type DraftOptions = Required<CleanupOptions>;

const DEFAULT_OPTIONS: DraftOptions = {
  normalizeLineEndings: true,
  stripChatCruft: true,
  trimTrailingWhitespace: true,
  collapseInternalSpaces: true,
  normalizeQuotes: true,
  normalizeSceneBreaks: true,
  normalizeDashes: true,
  preserveMarkdownEmphasis: true,
  collapseBlankLines: true,
  splitIntoSections: true,
};

export function ImportChapterDialog({
  slug,
  open,
  onOpenChange,
  onImported,
}: Props) {
  const [raw, setRaw] = useState("");
  const [title, setTitle] = useState("");
  const [options, setOptions] = useState<DraftOptions>(DEFAULT_OPTIONS);
  const [generateRecap, setGenerateRecap] = useState(false);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function insertAtCursor(marker: string) {
    const el = textareaRef.current;
    if (!el) {
      setRaw((prev) => prev + marker);
      return;
    }
    const start = el.selectionStart ?? raw.length;
    const end = el.selectionEnd ?? raw.length;
    const before = raw.slice(0, start);
    const after = raw.slice(end);

    // Trim redundant blank lines around the cursor so the marker doesn't pile up.
    const trimmedBefore = before.replace(/\n*$/, "");
    const trimmedAfter = after.replace(/^\n*/, "");
    const spliced = `${trimmedBefore}${marker}${trimmedAfter}`;
    setRaw(spliced);

    // Restore focus and place cursor at end of inserted marker.
    requestAnimationFrame(() => {
      const newPos = (trimmedBefore + marker).length;
      el.focus();
      el.setSelectionRange(newPos, newPos);
    });
  }

  const insertSceneBreak = () => insertAtCursor("\n\n* * *\n\n");
  const insertChapterBreak = () => insertAtCursor("\n\n=== CHAPTER ===\n\n");

  const cleaned = useMemo(() => cleanPaste(raw, options), [raw, options]);

  const previewChapter: Chapter | null = useMemo(() => {
    if (cleaned.sections.length === 0) return null;
    return {
      id: "preview",
      title: title || "Untitled",
      summary: "",
      beats: [],
      prompt: "",
      recap: "",
      sections: cleaned.sections.map((c, i) => ({ id: `p${i}`, content: c })),
      wordCount: 0,
    };
  }, [cleaned, title]);

  const previewHtml = useMemo(
    () => (previewChapter ? renderChapterPreviewHtml(previewChapter) : ""),
    [previewChapter],
  );

  const handleSave = useCallback(async () => {
    if (!raw.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/stories/${slug}/chapters/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          raw,
          cleanupOptions: options,
          title: title || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        toast.error(body.error ?? `Import failed (${res.status})`);
        return;
      }
      const chapters = body.data.chapters as Chapter[];
      if (chapters.length === 1) {
        toast.success(`Imported "${chapters[0].title}".`);
      } else {
        toast.success(`Imported ${chapters.length} chapters.`);
      }
      onImported(chapters);

      if (generateRecap && chapters.length === 1) {
        const chapter = chapters[0];
        // Fire-and-forget; recap runs async via the existing route.
        // Body shape matches app/api/generate/recap/route.ts.
        fetch("/api/generate/recap", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ storySlug: slug, chapterId: chapter.id }),
        }).catch(() => {
          toast.error("Recap failed to start; you can regenerate later.");
        });
      }
      // Multi-chapter recap: see Task 6.

      onOpenChange(false);
      setRaw("");
      setTitle("");
    } finally {
      setSaving(false);
    }
  }, [raw, options, title, slug, generateRecap, onImported, onOpenChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-stretch justify-center">
      <div className="bg-background border border-border rounded w-full max-w-[1400px] m-4 flex flex-col">
        <div className="border-b border-border px-4 py-2 text-sm font-semibold">
          Import chapter from paste
        </div>
        <div className="grid grid-cols-[1fr_280px_1fr] flex-1 min-h-0">
          <div className="p-4 border-r border-border flex flex-col gap-2">
            <div className="text-xs uppercase text-muted-foreground">
              Paste raw prose
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={insertSceneBreak}
                title="Insert scene break (* * *)"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Scene break
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={insertChapterBreak}
                title="Insert chapter break (=== CHAPTER ===)"
              >
                <BookmarkPlus className="w-3.5 h-3.5" />
                Chapter break
              </Button>
            </div>
            <Textarea
              ref={textareaRef}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              className="flex-1 font-mono text-xs p-2 bg-muted resize-none"
              placeholder="Paste a chapter from Grok web UI here."
              data-testid="import-paste"
            />
          </div>

          <div className="p-4 bg-muted/30 border-r border-border overflow-auto flex flex-col gap-4">
            <div>
              <div className="text-xs uppercase text-muted-foreground mb-2">
                Cleanup
              </div>
              <div className="flex flex-col gap-1 text-xs">
                {(
                  [
                    ["stripChatCruft", "Strip chat cruft"],
                    ["normalizeQuotes", "Curly quotes"],
                    ["normalizeDashes", "Em-dashes"],
                    ["normalizeSceneBreaks", "Normalize scene breaks"],
                    ["collapseBlankLines", "Collapse blank lines"],
                    ["preserveMarkdownEmphasis", "Preserve markdown emphasis"],
                  ] as [keyof DraftOptions, string][]
                ).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={options[key]}
                      onChange={(e) =>
                        setOptions((prev) => ({
                          ...prev,
                          [key]: e.target.checked,
                        }))
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            {cleaned.warnings.length > 0 && (
              <div>
                <div className="text-xs uppercase text-muted-foreground mb-1">
                  Warnings
                </div>
                <ul className="text-xs text-muted-foreground flex flex-col gap-0.5">
                  {cleaned.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <label className="text-xs text-muted-foreground">
                Chapter title
              </label>
              <Input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="text-sm"
                placeholder="Auto-detected if blank"
                data-testid="import-title"
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
          </div>

          <div className="p-4 flex flex-col gap-2 overflow-auto">
            <div className="text-xs uppercase text-muted-foreground">
              EPUB preview
            </div>
            <style>{EPUB_STYLESHEET}</style>
            <SafeHtml
              html={previewHtml}
              className="flex-1 overflow-auto border border-border rounded p-4 bg-background"
            />
            <div className="text-xs text-muted-foreground">
              {cleaned.sections.length} section
              {cleaned.sections.length === 1 ? "" : "s"}
            </div>
          </div>
        </div>

        <div className="border-t border-border px-4 py-3 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving || !raw.trim()}
            data-testid="import-save"
          >
            {saving ? "Saving\u2026" : "Save chapter"}
          </Button>
        </div>
      </div>
    </div>
  );
}
