"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import useSWR from "swr";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PenNamePicker } from "@/components/import/PenNamePicker";
import type { Bible } from "@/lib/types";
import type { PenNameProfile } from "@/lib/config";

interface SettingsLite {
  penNameProfiles?: Record<string, PenNameProfile>;
}

const jsonFetcher = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url);
  const json = (await res.json()) as { ok: boolean; data?: T; error?: string };
  if (!json.ok) throw new Error(json.error ?? "request failed");
  return json.data as T;
};

type ChapterRow = {
  navTitle: string;
  body: string;
  wordCount: number;
  source: "nav" | "spine";
  skippedByDefault: boolean;
  skipReason?: string;
  include: boolean;
  expanded: boolean;
};

type ParsedLite = {
  metadata: {
    title: string;
    creator: string;
    description: string;
    subjects: string[];
    language: string;
  };
  chapters: Array<{
    navTitle: string;
    body: string;
    wordCount: number;
    source: "nav" | "spine";
    skippedByDefault: boolean;
    skipReason?: string;
  }>;
  epubVersion: 2 | 3;
  hasCover: boolean;
};

type ProposedLite = {
  story: { title: string; description: string; keywords: string[]; authorPenName: string };
  bible: Bible;
  chapters: ParsedLite["chapters"];
  penNameMatch: "exact" | "case-insensitive" | "none";
  hasCover: boolean;
};

type ParseResponse = {
  ok: true;
  data: {
    parsed: ParsedLite;
    proposed: ProposedLite;
    coverPreview: string | null;
    sessionId: string;
  };
};

type Stage =
  | { kind: "idle" }
  | { kind: "parsing" }
  | { kind: "error"; message: string }
  | {
      kind: "preview";
      parsed: ParsedLite;
      proposed: ProposedLite;
      coverPreview: string | null;
      sessionId: string;
    };

type FormState = {
  title: string;
  description: string;
  keywords: string;
  authorPenName: string;
  importCover: boolean;
  chapters: ChapterRow[];
};

function toForm(p: ProposedLite): FormState {
  return {
    title: p.story.title,
    description: p.story.description,
    keywords: p.story.keywords.join(", "),
    authorPenName: p.story.authorPenName,
    importCover: p.hasCover,
    chapters: p.chapters.map((c) => ({
      ...c,
      include: !c.skippedByDefault,
      expanded: false,
    })),
  };
}

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

export function NewStoryFromEpubDialog({ open, onOpenChange }: Props) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  const { data: settings } = useSWR<SettingsLite>(
    open ? "/api/settings" : null,
    jsonFetcher,
    { revalidateOnFocus: false },
  );
  const profiles = settings?.penNameProfiles;

  const reset = useCallback(() => {
    setStage({ kind: "idle" });
    setForm(null);
    setSaving(false);
  }, []);

  const handleClose = useCallback(
    (next: boolean) => {
      if (saving) return;
      if (!next) reset();
      onOpenChange(next);
    },
    [onOpenChange, reset, saving],
  );

  async function handleFile(file: File) {
    setStage({ kind: "parsing" });
    const fd = new FormData();
    fd.set("file", file);
    try {
      const res = await fetch("/api/import/epub/parse", { method: "POST", body: fd });
      const json = (await res.json()) as ParseResponse | { ok: false; error: string };
      if (!json.ok) {
        setStage({ kind: "error", message: json.error });
        return;
      }
      setStage({
        kind: "preview",
        parsed: json.data.parsed,
        proposed: json.data.proposed,
        coverPreview: json.data.coverPreview,
        sessionId: json.data.sessionId,
      });
      setForm(toForm(json.data.proposed));
    } catch (err) {
      setStage({
        kind: "error",
        message: err instanceof Error ? err.message : "Unexpected error reading file.",
      });
    }
  }

  async function handleCommit() {
    if (stage.kind !== "preview" || !form) return;
    const includedChapters = form.chapters
      .filter((c) => c.include)
      .map((c) => ({ title: c.navTitle, body: c.body }));
    if (includedChapters.length === 0) return;

    setSaving(true);
    try {
      const res = await fetch("/api/import/epub/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: stage.sessionId || null,
          story: {
            title: form.title.trim(),
            description: form.description,
            keywords: form.keywords.split(",").map((s) => s.trim()).filter(Boolean),
            authorPenName: form.authorPenName,
          },
          importCover: form.importCover && stage.proposed.hasCover,
          chapters: includedChapters,
        }),
      });
      const json = (await res.json()) as
        | { ok: true; data: { slug: string; chapterIds: string[] } }
        | { ok: false; error: string };
      if (!json.ok) {
        toast.error(json.error);
        setSaving(false);
        return;
      }
      toast.success(`Imported "${form.title.trim()}" (${includedChapters.length} chapters)`);
      handleClose(false);
      router.push(`/s/${json.data.slug}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to import.");
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Import from EPUB</DialogTitle>
          <DialogDescription>
            Pull a published `.epub` into a new Scriptr story.
          </DialogDescription>
        </DialogHeader>

        {stage.kind === "idle" && <PickFileBlock onFile={handleFile} />}
        {stage.kind === "parsing" && (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Reading EPUB…
          </div>
        )}
        {stage.kind === "error" && (
          <div className="flex flex-col gap-3">
            <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {stage.message}
            </p>
            <Button variant="outline" onClick={reset}>
              Choose a different file
            </Button>
          </div>
        )}
        {stage.kind === "preview" && form && (
          <PreviewBlock
            form={form}
            setForm={setForm}
            coverPreview={stage.coverPreview}
            penNameMatch={stage.proposed.penNameMatch}
            creator={stage.parsed.metadata.creator}
            profiles={profiles}
          />
        )}

        <DialogFooter>
          {stage.kind === "preview" && (
            <Button
              onClick={handleCommit}
              disabled={
                saving ||
                !form ||
                !form.title.trim() ||
                form.chapters.filter((c) => c.include).length === 0
              }
            >
              {saving ? "Creating…" : "Create story"}
            </Button>
          )}
          <Button variant="outline" onClick={() => handleClose(false)} disabled={saving}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PickFileBlock({ onFile }: { onFile: (f: File) => void }) {
  return (
    <label
      htmlFor="epub-file-input"
      className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-12 text-center text-sm text-muted-foreground hover:bg-muted/40"
    >
      <span>Drop a .epub here, or click to choose</span>
      <input
        id="epub-file-input"
        type="file"
        accept=".epub,application/epub+zip"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
    </label>
  );
}

function PreviewBlock({
  form,
  setForm,
  coverPreview,
  penNameMatch,
  creator,
  profiles,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState | null>>;
  coverPreview: string | null;
  penNameMatch: ProposedLite["penNameMatch"];
  creator: string;
  profiles: Record<string, PenNameProfile> | undefined;
}) {
  const skippedCount = form.chapters.filter((c) => c.skippedByDefault).length;
  const includeCount = form.chapters.filter((c) => c.include).length;

  function update(patch: Partial<FormState>) {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  }
  function updateChapter(i: number, patch: Partial<ChapterRow>) {
    setForm((prev) =>
      prev
        ? {
            ...prev,
            chapters: prev.chapters.map((c, idx) => (idx === i ? { ...c, ...patch } : c)),
          }
        : prev,
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[280px,1fr]">
      <div className="flex flex-col gap-3">
        {coverPreview && (
          <div className="flex flex-col gap-2">
            <img
              src={coverPreview}
              alt="Cover"
              className={`w-32 rounded border ${form.importCover ? "" : "opacity-30"}`}
            />
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={form.importCover}
                onChange={(e) => update({ importCover: e.target.checked })}
                className="size-4"
              />
              Import cover from EPUB
            </label>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Title</label>
          <Input value={form.title} onChange={(e) => update({ title: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Description</label>
          <Textarea
            rows={4}
            value={form.description}
            onChange={(e) => update({ description: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Keywords (comma-separated)</label>
          <Input
            value={form.keywords}
            onChange={(e) => update({ keywords: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Pen name</label>
          <PenNamePicker
            profiles={profiles}
            value={form.authorPenName}
            onChange={(next) => update({ authorPenName: next })}
          />
          {penNameMatch === "case-insensitive" && (
            <p className="text-xs text-muted-foreground">
              Auto-matched to &ldquo;{form.authorPenName}&rdquo;.
            </p>
          )}
          {penNameMatch === "none" && creator && (
            <p className="text-xs text-muted-foreground">
              EPUB lists author as &ldquo;{creator}&rdquo; — pick a pen name or leave blank.
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          {form.chapters.length} chapters detected. {skippedCount} excluded by default
          (copyright pages, etc.) — check to include. {includeCount} will be imported.
        </p>
        <div className="flex flex-col divide-y rounded border">
          {form.chapters.map((ch, i) => (
            <EpubChapterRow
              key={`${ch.navTitle}-${i}`}
              row={ch}
              onChange={(patch) => updateChapter(i, patch)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function EpubChapterRow({
  row,
  onChange,
}: {
  row: ChapterRow;
  onChange: (patch: Partial<ChapterRow>) => void;
}) {
  return (
    <div className="flex flex-col gap-2 p-2">
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={row.include}
          onChange={(e) => onChange({ include: e.target.checked })}
          className="size-4"
        />
        <Input
          value={row.navTitle}
          onChange={(e) => onChange({ navTitle: e.target.value })}
          className="flex-1"
        />
        <span className="text-xs text-muted-foreground">{row.wordCount} words</span>
        <span
          className={`rounded border px-1.5 py-0.5 text-[10px] uppercase ${
            row.source === "nav" ? "" : "bg-muted"
          }`}
        >
          {row.source}
        </span>
        {row.skippedByDefault && (
          <span
            className="rounded border border-destructive/40 px-1.5 py-0.5 text-[10px] uppercase text-destructive"
            title={row.skipReason}
          >
            skipped
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({ expanded: !row.expanded })}
        >
          {row.expanded ? "Collapse" : "Edit body"}
        </Button>
      </div>
      {row.expanded && (
        <Textarea
          rows={8}
          value={row.body}
          onChange={(e) => onChange({ body: e.target.value })}
          className="font-mono text-xs"
        />
      )}
    </div>
  );
}

export { toForm };
