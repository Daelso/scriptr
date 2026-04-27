"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ChapterEditList } from "@/components/import/ChapterEditList";
import { PenNamePicker } from "@/components/import/PenNamePicker";
import type {
  Bible,
} from "@/lib/types";
import type {
  ParsedStory,
  ProposedChapter,
  StoryProposal,
} from "@/lib/novelai/types";
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

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type ParseOk = {
  ok: true;
  data: {
    parsed: ParsedStory;
    stories: StoryProposal[];
  };
};
type ParseErr = { ok: false; error: string };

/**
 * Per-story editable state in the preview UI. `bible` carries forward the
 * mapped bible for the first story and the empty bible for subsequent ones;
 * we don't edit bible fields in this dialog (that's a post-import task) but
 * we do need to POST it on commit.
 */
type StoryFormState = {
  title: string;
  description: string;
  keywords: string; // comma-separated string for the input field
  authorPenName: string;
  chapters: ProposedChapter[];
  bible: Bible;
  splitSource: StoryProposal["split"]["splitSource"];
};

type Stage =
  | { kind: "idle" }
  | { kind: "parsing" }
  | { kind: "error"; message: string }
  | { kind: "preview" };

export function toForm(
  s: StoryProposal,
  profiles: Record<string, PenNameProfile> | undefined,
): StoryFormState {
  const profileKeys = profiles ? Object.keys(profiles) : [];
  const initialPenName = profileKeys.length === 1 ? profileKeys[0] : "";
  return {
    title: s.proposed.story.title,
    description: s.proposed.story.description,
    keywords: s.proposed.story.keywords.join(", "),
    chapters: s.split.chapters,
    bible: s.proposed.bible,
    splitSource: s.split.splitSource,
    authorPenName: initialPenName,
  };
}

export function NewStoryFromNovelAIDialog({ open, onOpenChange }: Props) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [stories, setStories] = useState<StoryFormState[]>([]);
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  // Gate the SWR key on `open` so we don't fetch /api/settings on every
  // home-page mount when the dialog is closed. SWR treats `null` as skip.
  const { data: settings } = useSWR<SettingsLite>(
    open ? "/api/settings" : null,
    jsonFetcher,
    { revalidateOnFocus: false },
  );
  const profiles = settings?.penNameProfiles;

  const reset = useCallback(() => {
    setStage({ kind: "idle" });
    setStories([]);
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
      setStage({ kind: "preview" });
      setStories(body.data.stories.map((p) => toForm(p, profiles)));
    } catch (err) {
      setStage({
        kind: "error",
        message: err instanceof Error ? err.message : "Import failed — try again.",
      });
    }
    // `profiles` must stay in deps so toForm sees the resolved map post-SWR.
    // It looks unused by the body but is read inside the toForm closure.
  }, [profiles]);

  function updateStoryAt(i: number, patch: Partial<StoryFormState>) {
    setStories((prev) =>
      prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s))
    );
  }

  function removeStoryAt(i: number) {
    setStories((prev) => {
      // Guard: never reduce below 1 — the commit button is the way to abandon.
      if (prev.length <= 1) return prev;
      return prev.filter((_, idx) => idx !== i);
    });
  }

  const onCommit = useCallback(async () => {
    if (stage.kind !== "preview" || stories.length === 0) return;
    setSaving(true);
    try {
      const payload = {
        target: "new-story" as const,
        stories: stories.map((s) => ({
          story: {
            title: s.title.trim() || "Untitled",
            description: s.description,
            keywords: s.keywords
              .split(",")
              .map((k) => k.trim())
              .filter(Boolean),
            authorPenName: s.authorPenName,
          },
          bible: s.bible,
          chapters: s.chapters,
        })),
      };
      const res = await fetch("/api/import/novelai/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        toast.error(body.error ?? `Import failed (${res.status})`);
        return;
      }
      const slugs: string[] = body.data.slugs ?? [];
      if (stories.length === 1) {
        toast.success(
          `Created "${stories[0].title}" (${stories[0].chapters.length} chapters).`
        );
      } else {
        toast.success(`Created ${stories.length} stories.`);
      }
      onOpenChange(false);
      reset();
      const firstSlug = slugs[0];
      if (firstSlug) {
        router.push(`/s/${firstSlug}`);
      }
    } finally {
      setSaving(false);
    }
  }, [stage, stories, router, onOpenChange, reset]);

  if (!open) return null;

  const commitLabel = saving
    ? "Creating…"
    : stories.length > 1
      ? `Create ${stories.length} stories`
      : "Create story";

  const commitDisabled =
    saving ||
    stage.kind !== "preview" ||
    stories.length === 0 ||
    stories.some((s) => s.chapters.length === 0);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-stretch justify-center">
      <div className="bg-background border border-border rounded w-full max-w-[1400px] m-4 flex flex-col">
        <div className="border-b border-border px-4 py-2 text-sm font-semibold">
          Import from NovelAI
        </div>

        {stage.kind === "idle" && (
          <div className="p-8 flex-1 flex flex-col items-center justify-center gap-3">
            <p className="text-sm text-muted-foreground">
              Choose a NovelAI export (<code>.txt</code> or <code>.story</code>) to import.
            </p>
            <input
              type="file"
              accept=".txt,.story,application/json,text/plain"
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

        {stage.kind === "preview" && stories.length === 1 && (
          <StoryCard
            story={stories[0]}
            onChange={(patch) => updateStoryAt(0, patch)}
            profiles={profiles}
          />
        )}

        {stage.kind === "preview" && stories.length > 1 && (
          <div className="flex-1 overflow-auto p-4 flex flex-col gap-4">
            <div className="text-xs text-muted-foreground">
              This file contains <strong>{stories.length}</strong> stories (separated by{" "}
              <code>{"////"}</code>). Each will be created as its own story.
            </div>
            {stories.map((s, i) => (
              <div
                key={i}
                className="border border-border rounded"
                data-testid={`story-card-${i}`}
              >
                <div className="border-b border-border px-3 py-2 text-xs font-semibold bg-muted/30 flex items-center justify-between gap-2">
                  <span>Story {i + 1} of {stories.length}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove story ${i + 1}`}
                    onClick={() => removeStoryAt(i)}
                    disabled={stories.length <= 1 || saving}
                    className="text-xs text-muted-foreground hover:text-destructive h-6 px-2"
                  >
                    Remove
                  </Button>
                </div>
                <StoryCardBody
                  story={s}
                  onChange={(patch) => updateStoryAt(i, patch)}
                  profiles={profiles}
                />
              </div>
            ))}
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
            disabled={commitDisabled}
          >
            {commitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Single-story layout (full three-column) ────────────────────────────────

function StoryCard({
  story,
  onChange,
  profiles,
}: {
  story: StoryFormState;
  onChange: (patch: Partial<StoryFormState>) => void;
  profiles: Record<string, PenNameProfile> | undefined;
}) {
  return (
    <div className="grid grid-cols-[320px_1fr_320px] flex-1 min-h-0">
      <div className="p-4 border-r border-border flex flex-col gap-3">
        <MetadataFields story={story} onChange={onChange} profiles={profiles} />
      </div>

      <div className="p-4 overflow-auto">
        <ChapterEditList
          chapters={story.chapters}
          splitSource={story.splitSource}
          onChange={(next) => onChange({ chapters: next })}
        />
      </div>

      <div className="p-4 border-l border-border overflow-auto flex flex-col gap-3">
        <BiblePreview bible={story.bible} />
      </div>
    </div>
  );
}

// ─── Multi-story layout (per-card two-column + collapsed bible) ─────────────

function StoryCardBody({
  story,
  onChange,
  profiles,
}: {
  story: StoryFormState;
  onChange: (patch: Partial<StoryFormState>) => void;
  profiles: Record<string, PenNameProfile> | undefined;
}) {
  return (
    <div className="grid grid-cols-[280px_1fr] gap-4 p-3">
      <div className="flex flex-col gap-3">
        <MetadataFields story={story} onChange={onChange} profiles={profiles} />
        <BiblePreviewCompact bible={story.bible} />
      </div>
      <div className="overflow-auto">
        <ChapterEditList
          chapters={story.chapters}
          splitSource={story.splitSource}
          onChange={(next) => onChange({ chapters: next })}
        />
      </div>
    </div>
  );
}

function MetadataFields({
  story,
  onChange,
  profiles,
}: {
  story: StoryFormState;
  onChange: (patch: Partial<StoryFormState>) => void;
  profiles: Record<string, PenNameProfile> | undefined;
}) {
  return (
    <>
      <div>
        <div className="text-xs uppercase text-muted-foreground mb-1">Title</div>
        <Input
          value={story.title}
          onChange={(e) => onChange({ title: e.target.value })}
        />
      </div>
      <div>
        <div className="text-xs uppercase text-muted-foreground mb-1">
          Author pen name
        </div>
        <PenNamePicker
          profiles={profiles}
          value={story.authorPenName}
          onChange={(next) => onChange({ authorPenName: next })}
        />
      </div>
      <div>
        <div className="text-xs uppercase text-muted-foreground mb-1">Description</div>
        <Textarea
          value={story.description}
          onChange={(e) => onChange({ description: e.target.value })}
          className="min-h-[100px] text-sm"
        />
      </div>
      <div>
        <div className="text-xs uppercase text-muted-foreground mb-1">
          Keywords (comma-separated)
        </div>
        <Input
          value={story.keywords}
          onChange={(e) => onChange({ keywords: e.target.value })}
        />
      </div>
    </>
  );
}

function BiblePreview({ bible }: { bible: Bible }) {
  return (
    <>
      <div className="text-xs uppercase text-muted-foreground">Proposed Bible</div>
      <div>
        <div className="text-xs font-semibold mb-1">Characters</div>
        {bible.characters.length === 0 ? (
          <div className="text-xs text-muted-foreground italic">None</div>
        ) : (
          <ul className="text-xs flex flex-col gap-1">
            {bible.characters.map((c, i) => (
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
          {bible.setting || "(empty)"}
        </pre>
      </div>
      <div>
        <div className="text-xs font-semibold mb-1">Style notes</div>
        <pre className="text-xs text-muted-foreground whitespace-pre-wrap">
          {bible.styleNotes || "(empty)"}
        </pre>
      </div>
      <p className="text-xs text-muted-foreground italic">
        Edit these in the Bible editor after import.
      </p>
    </>
  );
}

function BiblePreviewCompact({ bible }: { bible: Bible }) {
  const hasContent =
    bible.characters.length > 0 ||
    bible.setting.trim().length > 0 ||
    bible.styleNotes.trim().length > 0;
  return (
    <div className="border border-border rounded p-2 text-xs">
      <div className="font-semibold mb-1">Bible</div>
      {hasContent ? (
        <div className="flex flex-col gap-1 text-muted-foreground">
          <div>
            Characters: {bible.characters.length > 0
              ? bible.characters.map((c) => c.name).join(", ")
              : "none"}
          </div>
          {bible.setting && <div>Setting: {bible.setting.slice(0, 60)}…</div>}
          {bible.styleNotes && (
            <div>Style: {bible.styleNotes.slice(0, 60)}…</div>
          )}
        </div>
      ) : (
        <div className="text-muted-foreground italic">
          Empty. Fill in Bible after import.
        </div>
      )}
    </div>
  );
}
