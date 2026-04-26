"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  arrayMove,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Trash2, Pencil, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AddStoryDialog } from "@/components/bundles/AddStoryDialog";
import type { Bundle, BundleStoryRef, Story } from "@/lib/types";

const fetcher = async (url: string): Promise<Story[]> => {
  const res = await fetch(url);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "request failed");
  return json.data as Story[];
};

type Props = { bundle: Bundle; onUpdate: () => void };

export function BundleStoryList({ bundle, onUpdate }: Props) {
  const { data: allStories } = useSWR<Story[]>("/api/stories", fetcher);
  const [addOpen, setAddOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function persistStories(stories: BundleStoryRef[]) {
    const res = await fetch(`/api/bundles/${bundle.slug}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stories }),
    });
    const body = await res.json();
    if (!body.ok) {
      toast.error(body.error ?? "Save failed");
      return false;
    }
    onUpdate();
    return true;
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = bundle.stories.findIndex((s) => s.storySlug === active.id);
    const newIndex = bundle.stories.findIndex((s) => s.storySlug === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(bundle.stories, oldIndex, newIndex);
    await persistStories(reordered);
  }

  async function handleRemove(slug: string) {
    const next = bundle.stories.filter((s) => s.storySlug !== slug);
    await persistStories(next);
  }

  async function handleEditOverride(slug: string, patch: Partial<BundleStoryRef>) {
    const next = bundle.stories.map((s) =>
      s.storySlug === slug ? { ...s, ...patch } : s,
    );
    await persistStories(next);
  }

  async function handleAdd(slugs: string[]) {
    const next: BundleStoryRef[] = [
      ...bundle.stories,
      ...slugs.map((s) => ({ storySlug: s })),
    ];
    await persistStories(next);
  }

  const storyBySlug = new Map((allStories ?? []).map((s) => [s.slug, s]));
  const excludeSlugs = bundle.stories.map((s) => s.storySlug);

  return (
    <section className="flex flex-col gap-3 border border-border rounded p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Stories</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAddOpen(true)}
          data-testid="bundle-add-story"
        >
          <Plus className="size-3 mr-1" /> Add story
        </Button>
      </div>

      {bundle.stories.length === 0 ? (
        <div className="text-sm text-muted-foreground">No stories yet.</div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={bundle.stories.map((s) => s.storySlug)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="flex flex-col gap-2">
              {bundle.stories.map((ref) => {
                const source = storyBySlug.get(ref.storySlug);
                return (
                  <SortableStoryRow
                    key={ref.storySlug}
                    ref_={ref}
                    sourceTitle={source?.title}
                    sourceDescription={source?.description}
                    missing={!source}
                    onRemove={() => void handleRemove(ref.storySlug)}
                    onEdit={(patch) => void handleEditOverride(ref.storySlug, patch)}
                  />
                );
              })}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <AddStoryDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        excludeSlugs={excludeSlugs}
        onAdd={handleAdd}
      />
    </section>
  );
}

function SortableStoryRow({
  ref_,
  sourceTitle,
  sourceDescription,
  missing,
  onRemove,
  onEdit,
}: {
  ref_: BundleStoryRef;
  sourceTitle?: string;
  sourceDescription?: string;
  missing: boolean;
  onRemove: () => void;
  onEdit: (patch: Partial<BundleStoryRef>) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: ref_.storySlug,
  });
  const [editing, setEditing] = useState(false);

  const display = ref_.titleOverride ?? sourceTitle ?? ref_.storySlug;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="flex flex-col gap-2 border border-border rounded p-2 bg-background"
      data-testid={`bundle-story-row-${ref_.storySlug}`}
    >
      <div className="flex items-center gap-2">
        <button
          {...attributes}
          {...listeners}
          className="text-muted-foreground hover:text-foreground"
          aria-label="drag handle"
          type="button"
        >
          <GripVertical className="size-4" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate flex items-center gap-2">
            {display}
            {missing && (
              <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400" data-testid="bundle-story-missing">
                <AlertTriangle className="size-3" /> missing
              </span>
            )}
          </div>
          {ref_.titleOverride && !missing && sourceTitle && (
            <div className="text-xs text-muted-foreground">source: {sourceTitle}</div>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={() => setEditing((e) => !e)} aria-label="edit overrides">
          <Pencil className="size-3" />
        </Button>
        <Button variant="ghost" size="icon" onClick={onRemove} aria-label="remove story" data-testid={`bundle-story-remove-${ref_.storySlug}`}>
          <Trash2 className="size-3" />
        </Button>
      </div>
      {editing && (
        <div className="flex flex-col gap-2 pl-6">
          <Input
            placeholder={`title (default: ${sourceTitle ?? "—"})`}
            defaultValue={ref_.titleOverride ?? ""}
            onBlur={(e) => {
              const v = e.target.value.trim();
              onEdit({ titleOverride: v === "" ? undefined : v });
            }}
            data-testid={`bundle-story-title-override-${ref_.storySlug}`}
          />
          <Textarea
            placeholder={`description (default: ${sourceDescription?.slice(0, 60) ?? "—"})`}
            rows={2}
            defaultValue={ref_.descriptionOverride ?? ""}
            onBlur={(e) => {
              const v = e.target.value.trim();
              onEdit({ descriptionOverride: v === "" ? undefined : v });
            }}
            data-testid={`bundle-story-desc-override-${ref_.storySlug}`}
          />
        </div>
      )}
    </li>
  );
}
