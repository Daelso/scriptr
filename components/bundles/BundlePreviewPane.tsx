"use client";

import { useState } from "react";
import useSWR from "swr";
import { ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { EPUB_STYLESHEET } from "@/lib/publish/epub-preview";
import { SafeHtml } from "@/lib/publish/safe-html";
import type { Bundle } from "@/lib/types";

type PreviewStory =
  | { storySlug: string; missing: true }
  | {
      storySlug: string;
      displayTitle: string;
      titlePageHtml: string;
      chapters: Array<{ id: string; title: string; html: string }>;
    };

type PreviewPayload = {
  bundle: { title: string; authorPenName: string; description: string };
  stories: PreviewStory[];
};

const fetcher = async (url: string): Promise<PreviewPayload> => {
  const res = await fetch(url);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "request failed");
  return json.data as PreviewPayload;
};

type SelectedNode =
  | { kind: "title"; storySlug: string }
  | { kind: "chapter"; storySlug: string; chapterId: string }
  | null;

type Props = { slug: string; bundle: Bundle };

export function BundlePreviewPane({ slug, bundle }: Props) {
  // SWR key tied to bundle.updatedAt so PATCH success triggers re-fetch
  // without needing manual mutate calls from siblings.
  const { data } = useSWR<PreviewPayload>(
    `/api/bundles/${slug}/preview?u=${encodeURIComponent(bundle.updatedAt)}`,
    fetcher,
  );

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<SelectedNode>(null);

  function toggle(storySlug: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(storySlug)) next.delete(storySlug);
      else next.add(storySlug);
      return next;
    });
  }

  if (!data) {
    return <div className="text-sm text-muted-foreground">Loading preview…</div>;
  }

  const renderHtml = (() => {
    if (!selected) return "";
    const story = data.stories.find((s) => s.storySlug === selected.storySlug);
    if (!story || "missing" in story) return "";
    if (selected.kind === "title") return story.titlePageHtml;
    const ch = story.chapters.find((c) => c.id === selected.chapterId);
    return ch?.html ?? "";
  })();

  return (
    <section className="border border-border rounded p-4 flex flex-col gap-3" data-testid="bundle-preview-pane">
      <h2 className="text-sm font-semibold">Preview</h2>

      {data.stories.length === 0 ? (
        <div className="text-xs text-muted-foreground">Add a story to preview.</div>
      ) : (
        <ul className="text-sm" data-testid="bundle-preview-tree">
          {data.stories.map((story) => {
            if ("missing" in story) {
              return (
                <li key={story.storySlug} className="flex items-center gap-1 text-amber-600 dark:text-amber-400 py-1">
                  <AlertTriangle className="size-3" /> {story.storySlug} (missing)
                </li>
              );
            }
            const isOpen = expanded.has(story.storySlug);
            return (
              <li key={story.storySlug} className="py-0.5">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={isOpen ? "collapse" : "expand"}
                    aria-expanded={isOpen}
                    onClick={() => toggle(story.storySlug)}
                    className="hover:bg-muted/40 rounded p-0.5"
                  >
                    {isOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setSelected({ kind: "title", storySlug: story.storySlug })
                    }
                    className="font-medium hover:underline text-left"
                    data-testid={`preview-story-title-${story.storySlug}`}
                  >
                    {story.displayTitle}
                  </button>
                </div>
                {isOpen && (
                  <ul className="pl-5">
                    {story.chapters.map((ch) => (
                      <li key={ch.id}>
                        <button
                          type="button"
                          onClick={() =>
                            setSelected({
                              kind: "chapter",
                              storySlug: story.storySlug,
                              chapterId: ch.id,
                            })
                          }
                          className="hover:underline text-left text-xs py-0.5"
                          data-testid={`preview-chapter-${story.storySlug}-${ch.id}`}
                        >
                          {ch.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {renderHtml && (
        <div className="border-t border-border pt-3 mt-2">
          <style>{EPUB_STYLESHEET}</style>
          <SafeHtml
            html={renderHtml}
            className="text-sm max-h-[60vh] overflow-y-auto"
          />
        </div>
      )}
    </section>
  );
}
