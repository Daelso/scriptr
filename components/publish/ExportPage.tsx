"use client";

import { useState, useRef, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Story } from "@/lib/types";

type Props = {
  story: Story;
  chapterCount: number;
  wordCount: number;
};

type LastBuild = { path: string; bytes: number; warnings: string[]; version: 2 | 3 };

export function ExportPage({ story, chapterCount, wordCount }: Props) {
  const [draft, setDraft] = useState<Story>(story);
  const [saving, setSaving] = useState(false);
  const [building, setBuilding] = useState(false);
  const [lastBuildByVersion, setLastBuildByVersion] = useState<Partial<Record<2 | 3, LastBuild>>>({});
  const [selectedVersion, setSelectedVersion] = useState<2 | 3>(3);
  const fileRef = useRef<HTMLInputElement>(null);
  const v3Ref = useRef<HTMLButtonElement>(null);
  const v2Ref = useRef<HTMLButtonElement>(null);

  const onToggleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = e.key;
    if (
      k === "ArrowLeft" ||
      k === "ArrowRight" ||
      k === "ArrowUp" ||
      k === "ArrowDown" ||
      k === "Home" ||
      k === "End"
    ) {
      e.preventDefault();
      const next: 2 | 3 =
        k === "Home" ? 3 : k === "End" ? 2 : selectedVersion === 3 ? 2 : 3;
      setSelectedVersion(next);
      (next === 3 ? v3Ref : v2Ref).current?.focus();
    }
  };

  const patch = async (fields: Partial<Story>) => {
    setSaving(true);
    try {
      // Existing stories route exports PATCH (not PUT); use it as-is.
      const res = await fetch(`/api/stories/${story.slug}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(fields),
      });
      const body = await res.json();
      if (!body.ok) toast.error(body.error ?? "Save failed");
      else setDraft((d) => ({ ...d, ...fields }));
    } finally {
      setSaving(false);
    }
  };

  const handleBlur = <K extends keyof Story>(key: K, value: Story[K]) => {
    if (draft[key] === value) return;
    void patch({ [key]: value } as Partial<Story>);
  };

  const handleCoverSelect = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append("cover", file);
    const res = await fetch(`/api/stories/${story.slug}/cover`, {
      method: "PUT",
      body: form,
    });
    const body = await res.json();
    if (!body.ok) {
      toast.error(body.error ?? "Cover upload failed");
      return;
    }
    if (body.data.warnings?.length) {
      toast.warning(body.data.warnings.join(" "));
    } else {
      toast.success("Cover uploaded.");
    }
  };

  const handleBuild = async () => {
    setBuilding(true);
    try {
      const res = await fetch(`/api/stories/${story.slug}/export/epub`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: selectedVersion }),
      });
      const body = await res.json();
      if (!body.ok) {
        toast.error(body.error ?? "Build failed");
        return;
      }
      const built: LastBuild = body.data;
      setLastBuildByVersion((prev) => ({ ...prev, [built.version]: built }));
      toast.success("EPUB built.");
    } finally {
      setBuilding(false);
    }
  };

  const canBuild =
    draft.title.trim() !== "" &&
    draft.authorPenName.trim() !== "" &&
    draft.description.trim() !== "" &&
    chapterCount > 0 &&
    !building;

  return (
    <div className="max-w-5xl mx-auto p-6 grid grid-cols-[1fr_340px] gap-8">
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold">Book metadata</h1>

        <Field label="Title">
          <Input
            type="text"
            defaultValue={draft.title}
            onBlur={(e) => handleBlur("title", e.target.value)}
          />
        </Field>
        <Field label="Subtitle (optional)">
          <Input
            type="text"
            defaultValue={draft.subtitle ?? ""}
            onBlur={(e) => handleBlur("subtitle", e.target.value)}
          />
        </Field>
        <Field label="Author pen name">
          <Input
            type="text"
            defaultValue={draft.authorPenName}
            onBlur={(e) => handleBlur("authorPenName", e.target.value)}
          />
        </Field>
        <Field label="Description / blurb">
          <Textarea
            defaultValue={draft.description}
            rows={4}
            onBlur={(e) => handleBlur("description", e.target.value)}
            data-testid="export-description"
          />
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Copyright year">
            <Input
              type="number"
              defaultValue={draft.copyrightYear}
              onBlur={(e) =>
                handleBlur(
                  "copyrightYear",
                  Number(e.target.value) || draft.copyrightYear
                )
              }
            />
          </Field>
          <Field label="Language">
            <Input
              type="text"
              defaultValue={draft.language}
              onBlur={(e) => handleBlur("language", e.target.value)}
            />
          </Field>
          <Field label="ISBN (optional)">
            <Input
              type="text"
              defaultValue={draft.isbn ?? ""}
              onBlur={(e) => handleBlur("isbn", e.target.value || undefined)}
            />
          </Field>
        </div>
        <Field label="BISAC category">
          <Input
            type="text"
            defaultValue={draft.bisacCategory}
            onBlur={(e) => handleBlur("bisacCategory", e.target.value)}
          />
        </Field>
        <Field label="Keywords (comma-separated, up to 7)">
          <Input
            type="text"
            defaultValue={draft.keywords.join(", ")}
            onBlur={(e) =>
              handleBlur(
                "keywords",
                e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .slice(0, 7)
              )
            }
          />
        </Field>
        {saving ? (
          <div className="text-xs text-muted-foreground">Saving…</div>
        ) : null}
      </div>

      <div className="flex flex-col gap-5">
        <div>
          <h2 className="text-sm font-semibold mb-2">Cover image</h2>
          <div
            className="border border-dashed border-border rounded aspect-[2/3] max-w-[240px] flex items-center justify-center bg-muted text-xs text-muted-foreground text-center p-4 cursor-pointer"
            onClick={() => fileRef.current?.click()}
          >
            Drop JPEG/PNG here or click to choose.
            <br />
            1600×2560 recommended.
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png"
            onChange={handleCoverSelect}
            className="hidden"
          />
          <div className="text-xs text-muted-foreground mt-1">
            2:3 ratio, ≤20 MB
          </div>
        </div>

        <div className="border-t border-border pt-4">
          <h2 className="text-sm font-semibold mb-1">Build</h2>
          <div className="text-xs text-muted-foreground mb-2">
            {chapterCount} chapter{chapterCount === 1 ? "" : "s"} ·{" "}
            {wordCount.toLocaleString()} words
          </div>
          <div
            role="radiogroup"
            aria-label="EPUB version"
            data-testid="export-version-toggle"
            className="flex rounded-md border border-border overflow-hidden mb-3 text-xs"
            onKeyDown={onToggleKeyDown}
          >
            <button
              ref={v3Ref}
              role="radio"
              aria-checked={selectedVersion === 3}
              tabIndex={selectedVersion === 3 ? 0 : -1}
              data-testid="export-version-epub3"
              onClick={() => setSelectedVersion(3)}
              className={`flex-1 px-3 py-1.5 text-center transition-colors ${
                selectedVersion === 3
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "bg-background text-muted-foreground hover:bg-muted"
              }`}
            >
              EPUB 3 · Kindle / KDP
            </button>
            <button
              ref={v2Ref}
              role="radio"
              aria-checked={selectedVersion === 2}
              tabIndex={selectedVersion === 2 ? 0 : -1}
              data-testid="export-version-epub2"
              onClick={() => setSelectedVersion(2)}
              className={`flex-1 px-3 py-1.5 text-center transition-colors border-l border-border ${
                selectedVersion === 2
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "bg-background text-muted-foreground hover:bg-muted"
              }`}
            >
              EPUB 2 · Smashwords
            </button>
          </div>
          <Button
            onClick={handleBuild}
            disabled={!canBuild}
            className="w-full"
            data-testid="export-build"
          >
            {building ? "Building…" : `Build EPUB ${selectedVersion}`}
          </Button>
        </div>

        {([3, 2] as const).map((v) => {
          const build = lastBuildByVersion[v];
          if (!build) return null;
          return (
            <div
              key={v}
              data-testid={`export-lastbuild-epub${v}`}
              className="rounded border border-green-700 bg-green-950/40 p-3 text-xs text-green-200"
            >
              <div>✓ EPUB {v} · {(build.bytes / 1024).toFixed(0)} KB</div>
              <div className="font-mono text-green-300 break-all mt-1">
                {build.path}
              </div>
              {build.warnings.length > 0 && (
                <details className="mt-2">
                  <summary>{build.warnings.length} warning(s)</summary>
                  <ul className="mt-1 text-green-300">
                    {build.warnings.map((w, i) => (
                      <li key={i}>· {w}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
