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
