"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Story } from "@/lib/types";

// ─── Fetcher ──────────────────────────────────────────────────────────────────

const fetcher = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "request failed");
  return json.data as T;
};

// ─── Component ────────────────────────────────────────────────────────────────

export function PrivacyPanel() {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  const { data: stories } = useSWR<Story[]>("/api/stories", fetcher);

  const { data: settings } = useSWR<{
    isElectron?: boolean;
    updates?: { checkOnLaunch: boolean; lastCheckedAt?: string };
  }>("/api/settings", fetcher);

  const {
    data: payload,
    error: payloadError,
  } = useSWR<unknown>(
    selectedSlug ? `/api/privacy/last-payload?slug=${selectedSlug}` : null,
    fetcher,
    {
      onError: () => toast.error("Failed to load payload"),
    }
  );

  const storyList = stories ?? [];

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Privacy
      </h2>

      {settings?.isElectron && (() => {
        // checkOnLaunch defaults to true — only `false` should render as "disabled".
        const updatesOn = settings.updates?.checkOnLaunch !== false;
        return (
          <div className="rounded-md border border-border/60 bg-muted/30 p-4">
            <h3 className="mb-2 text-sm font-medium">Desktop app network activity</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Allowed destinations</dt>
              <dd>
                <code>https://api.x.ai</code> (generation)
                {updatesOn && (
                  <>, <code>https://api.github.com</code> (updates)</>
                )}
              </dd>
              <dt className="text-muted-foreground">Update check on launch</dt>
              <dd>{updatesOn ? "enabled" : "disabled"}</dd>
              <dt className="text-muted-foreground">Last check</dt>
              <dd>{settings.updates?.lastCheckedAt ?? "never"}</dd>
            </dl>
          </div>
        );
      })()}

      {storyList.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Create a story first — there&apos;s nothing to inspect yet.
        </p>
      ) : (
        <>
          <Select
            value={selectedSlug ?? ""}
            onValueChange={(v) => {
              if (typeof v === "string" && v) setSelectedSlug(v);
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose a story…" />
            </SelectTrigger>
            <SelectContent>
              {storyList.map((s) => (
                <SelectItem key={s.slug} value={s.slug}>
                  {s.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selectedSlug && (
            <>
              {payloadError ? (
                <p className="text-sm text-destructive">Could not load payload.</p>
              ) : payload === null ? (
                <p className="text-sm text-muted-foreground">
                  No generation yet for this story.
                </p>
              ) : payload !== undefined ? (
                <div
                  className="overflow-auto rounded border p-3"
                  style={{ maxHeight: "400px" }}
                >
                  <pre className="whitespace-pre-wrap break-all font-mono text-xs">
                    {JSON.stringify(payload, null, 2)}
                  </pre>
                </div>
              ) : null}

              {payload !== undefined && payload !== null && !payloadError && (
                <p className="text-xs text-muted-foreground">
                  This is exactly what was sent to api.x.ai for the most recent
                  generation in this story. Nothing else is transmitted externally.
                </p>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
