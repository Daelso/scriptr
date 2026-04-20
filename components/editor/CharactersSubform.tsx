"use client";

import { useCallback } from "react";
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

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { Character } from "@/lib/types";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Internal representation — carries a stable client-only `id` for dnd-kit. */
export type CharacterRow = Character & { id: string };

// ─── Single row ───────────────────────────────────────────────────────────────

interface CharacterRowItemProps {
  row: CharacterRow;
  onChange: (updated: CharacterRow) => void;
  onRemove: () => void;
}

function CharacterRowItem({ row, onChange, onRemove }: CharacterRowItemProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: row.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-md border border-border bg-muted/30 p-2 flex flex-col gap-2"
    >
      <div className="flex items-center gap-1.5">
        {/* Drag handle */}
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing shrink-0"
          aria-label="Drag to reorder"
          tabIndex={-1}
        >
          <GripVertical className="size-3.5" />
        </button>

        <div className="flex-1">
          <Label htmlFor={`char-name-${row.id}`} className="sr-only">
            Name
          </Label>
          <Input
            id={`char-name-${row.id}`}
            value={row.name}
            onChange={(e) => onChange({ ...row, name: e.target.value })}
            placeholder="Name"
            className="h-7 text-sm"
          />
        </div>

        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
          aria-label="Remove character"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      <div>
        <Label htmlFor={`char-desc-${row.id}`} className="sr-only">
          Description
        </Label>
        <Textarea
          id={`char-desc-${row.id}`}
          value={row.description}
          onChange={(e) => onChange({ ...row, description: e.target.value })}
          placeholder="Description"
          rows={2}
          className="resize-none text-xs"
        />
      </div>

      <div>
        <Label htmlFor={`char-traits-${row.id}`} className="sr-only">
          Traits
        </Label>
        <Input
          id={`char-traits-${row.id}`}
          value={row.traits ?? ""}
          onChange={(e) => onChange({ ...row, traits: e.target.value || undefined })}
          placeholder="Traits (optional)"
          className="h-7 text-xs"
        />
      </div>
    </div>
  );
}

// ─── Subform ──────────────────────────────────────────────────────────────────

interface CharactersSubformProps {
  rows: CharacterRow[];
  onChange: (rows: CharacterRow[]) => void;
}

export function CharactersSubform({ rows, onChange }: CharactersSubformProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        const oldIndex = rows.findIndex((r) => r.id === active.id);
        const newIndex = rows.findIndex((r) => r.id === over.id);
        onChange(arrayMove(rows, oldIndex, newIndex));
      }
    },
    [rows, onChange],
  );

  function handleChange(id: string, updated: CharacterRow) {
    onChange(rows.map((r) => (r.id === id ? updated : r)));
  }

  function handleRemove(id: string) {
    onChange(rows.filter((r) => r.id !== id));
  }

  function handleAdd() {
    const newRow: CharacterRow = {
      id: crypto.randomUUID(),
      name: "",
      description: "",
    };
    onChange([...rows, newRow]);
  }

  return (
    <div className="flex flex-col gap-2">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={rows.map((r) => r.id)}
          strategy={verticalListSortingStrategy}
        >
          {rows.map((row) => (
            <CharacterRowItem
              key={row.id}
              row={row}
              onChange={(updated) => handleChange(row.id, updated)}
              onRemove={() => handleRemove(row.id)}
            />
          ))}
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
        Add character
      </Button>
    </div>
  );
}
