"use client";

import { useState, useRef, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { Bundle } from "@/lib/types";

type Props = { bundle: Bundle; onUpdate: () => void };

type LastBuild = { path: string; bytes: number; warnings: string[]; version: 2 | 3 };

export function BundleMetadataPane({ bundle, onUpdate }: Props) {
  const [draft, setDraft] = useState<Bundle>(bundle);
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
      const next: 2 | 3 = k === "Home" ? 3 : k === "End" ? 2 : selectedVersion === 3 ? 2 : 3;
      setSelectedVersion(next);
      (next === 3 ? v3Ref : v2Ref).current?.focus();
    }
  };

  async function patch(fields: Partial<Bundle>) {
    setSaving(true);
    try {
      const res = await fetch(`/api/bundles/${bundle.slug}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(fields),
      });
      const body = await res.json();
      if (!body.ok) {
        toast.error(body.error ?? "Save failed");
        return;
      }
      setDraft((d) => ({ ...d, ...fields }));
      onUpdate();
    } finally {
      setSaving(false);
    }
  }

  function handleBlur<K extends keyof Bundle>(key: K, value: Bundle[K]) {
    if (draft[key] === value) return;
    void patch({ [key]: value } as Partial<Bundle>);
  }

  async function handleCoverSelect() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append("cover", file);
    const res = await fetch(`/api/bundles/${bundle.slug}/cover`, {
      method: "PUT",
      body: form,
    });
    const body = await res.json();
    if (!body.ok) {
      toast.error(body.error ?? "Cover upload failed");
      return;
    }
    if (body.data.warnings?.length) toast.warning(body.data.warnings.join(" "));
    else toast.success("Cover uploaded.");
  }

  async function handleBuild() {
    setBuilding(true);
    try {
      const res = await fetch(`/api/bundles/${bundle.slug}/export/epub`, {
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
      if (built.warnings.length > 0) {
        toast.warning(`Built with ${built.warnings.length} warning(s).`);
      } else {
        toast.success("EPUB built.");
      }
    } finally {
      setBuilding(false);
    }
  }

  const canBuild =
    draft.title.trim() !== "" &&
    draft.authorPenName.trim() !== "" &&
    bundle.stories.length > 0 &&
    !building;

  return (
    <section className="flex flex-col gap-4 border border-border rounded p-5">
      <h1 className="text-lg font-semibold">{draft.title || "Untitled bundle"}</h1>

      <Field label="Title">
        <Input
          type="text"
          defaultValue={draft.title}
          onBlur={(e) => handleBlur("title", e.target.value)}
          data-testid="bundle-title"
        />
      </Field>
      <Field label="Author pen name">
        <Input
          type="text"
          defaultValue={draft.authorPenName}
          onBlur={(e) => handleBlur("authorPenName", e.target.value)}
          data-testid="bundle-author"
        />
      </Field>
      <Field label="Description / blurb">
        <Textarea
          defaultValue={draft.description}
          rows={3}
          onBlur={(e) => handleBlur("description", e.target.value)}
          data-testid="bundle-description"
        />
      </Field>
      <Field label="Language">
        <Input
          type="text"
          defaultValue={draft.language}
          onBlur={(e) => handleBlur("language", e.target.value || "en")}
          data-testid="bundle-language"
        />
      </Field>

      <div className="grid grid-cols-[180px_1fr] gap-5 items-start">
        <div>
          <h2 className="text-sm font-semibold mb-2">Cover</h2>
          <div
            className="border border-dashed border-border rounded aspect-[2/3] flex items-center justify-center bg-muted text-xs text-muted-foreground text-center p-3 cursor-pointer"
            onClick={() => fileRef.current?.click()}
            data-testid="bundle-cover-target"
          >
            JPEG/PNG · 1600×2560
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png"
            onChange={handleCoverSelect}
            className="hidden"
            data-testid="bundle-cover-input"
          />
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">Build</h2>
          <div className="text-xs text-muted-foreground">
            {bundle.stories.length} {bundle.stories.length === 1 ? "story" : "stories"}
          </div>
          <div
            role="radiogroup"
            aria-label="EPUB version"
            data-testid="bundle-version-toggle"
            className="flex rounded-md border border-border overflow-hidden text-xs"
            onKeyDown={onToggleKeyDown}
          >
            <button
              ref={v3Ref}
              role="radio"
              aria-checked={selectedVersion === 3}
              tabIndex={selectedVersion === 3 ? 0 : -1}
              data-testid="bundle-version-epub3"
              onClick={() => setSelectedVersion(3)}
              className={`flex-1 px-3 py-1.5 ${
                selectedVersion === 3
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "bg-background text-muted-foreground hover:bg-muted"
              }`}
            >
              EPUB 3
            </button>
            <button
              ref={v2Ref}
              role="radio"
              aria-checked={selectedVersion === 2}
              tabIndex={selectedVersion === 2 ? 0 : -1}
              data-testid="bundle-version-epub2"
              onClick={() => setSelectedVersion(2)}
              className={`flex-1 px-3 py-1.5 border-l border-border ${
                selectedVersion === 2
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "bg-background text-muted-foreground hover:bg-muted"
              }`}
            >
              EPUB 2
            </button>
          </div>
          <Button
            onClick={() => void handleBuild()}
            disabled={!canBuild}
            data-testid="bundle-build"
          >
            {building ? "Building…" : "Build EPUB"}
          </Button>
          {lastBuildByVersion[selectedVersion] && (
            <div className="text-xs text-muted-foreground" data-testid="bundle-last-build">
              Built ({(lastBuildByVersion[selectedVersion]!.bytes / 1024).toFixed(0)} KB)
            </div>
          )}
        </div>
      </div>

      {saving && <div className="text-xs text-muted-foreground">Saving…</div>}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
