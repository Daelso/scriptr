"use client";

import { useState, useCallback } from "react";
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
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAutoSave } from "@/hooks/useAutoSave";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BeatRow {
  id: string;
  text: string;
}

// ─── Save status indicator ────────────────────────────────────────────────────

function SaveStatus({ status }: { status: "idle" | "saving" | "saved" | "error" }) {
  if (status === "idle") return null;
  const label =
    status === "saving" ? "Saving…" :
    status === "saved"  ? "Saved"   :
    "Save failed";
  return (
    <span
      className={cn(
        "text-xs",
        status === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

// ─── Single sortable beat row ─────────────────────────────────────────────────

interface BeatRowItemProps {
  row: BeatRow;
  onChange: (text: string) => void;
  onRemove: () => void;
}

function BeatRowItem({ row, onChange, onRemove }: BeatRowItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-1.5"
    >
      {/* Drag handle — intentionally focusable for KeyboardSensor */}
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing shrink-0"
        aria-label="Drag to reorder"
      >
        <GripVertical className="size-3.5" />
      </button>

      <Label htmlFor={`beat-${row.id}`} className="sr-only">
        Beat
      </Label>
      <Input
        id={`beat-${row.id}`}
        value={row.text}
        onChange={(e) => onChange(e.target.value)}
        placeholder="A beat…"
        className="h-7 flex-1 text-sm"
      />

      <button
        type="button"
        onClick={onRemove}
        className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
        aria-label="Remove beat"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

// ─── BeatList ─────────────────────────────────────────────────────────────────

interface BeatListProps {
  slug: string;
  chapterId: string;
  value: string[];
  mutate: () => Promise<unknown>;
  mutateList: () => Promise<unknown>;
}

function toRows(beats: string[]): BeatRow[] {
  return beats.map((text) => ({ id: crypto.randomUUID(), text }));
}

/**
 * Controlled by external `value` at mount only. External value changes are
 * handled by remounting via `key` in MetadataPane (on chapterId change).
 */
export function BeatList({ slug, chapterId, value, mutate, mutateList }: BeatListProps) {
  const [rows, setRows] = useState<BeatRow[]>(() => toRows(value));

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        setRows((prev) => {
          const oldIndex = prev.findIndex((r) => r.id === active.id);
          const newIndex = prev.findIndex((r) => r.id === over.id);
          return arrayMove(prev, oldIndex, newIndex);
        });
      }
    },
    [],
  );

  function handleChange(id: string, text: string) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, text } : r)));
  }

  function handleRemove(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  function handleAdd() {
    setRows((prev) => [...prev, { id: crypto.randomUUID(), text: "" }]);
  }

  const save = useCallback(
    async (currentRows: BeatRow[]) => {
      const beats = currentRows.map((r) => r.text);
      const res = await fetch(`/api/stories/${slug}/chapters/${chapterId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ beats }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "save failed");
      await mutate();
      await mutateList();
    },
    [slug, chapterId, mutate, mutateList],
  );

  const { status } = useAutoSave(rows, save);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium">Beats</Label>
        <SaveStatus status={status} />
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={rows.map((r) => r.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="flex flex-col gap-1">
            {rows.map((row) => (
              <BeatRowItem
                key={row.id}
                row={row}
                onChange={(text) => handleChange(row.id, text)}
                onRemove={() => handleRemove(row.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={handleAdd}
        className="w-full justify-start gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <Plus className="size-3.5" />
        Add beat
      </Button>
    </div>
  );
}
