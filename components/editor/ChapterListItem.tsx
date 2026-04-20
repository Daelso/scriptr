"use client";

import { useRef, useEffect } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, MoreHorizontal } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Chapter } from "@/lib/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChapterListItemProps {
  chapter: Chapter;
  ordinal: number; // 1-based
  isSelected: boolean;
  isRenaming: boolean;
  onSelect: () => void;
  onRenameStart: () => void;
  onRenameCommit: (title: string) => Promise<void> | void;
  onRenameCancel: () => void;
  onDelete: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ChapterListItem({
  chapter,
  ordinal,
  isSelected,
  isRenaming,
  onSelect,
  onRenameStart,
  onRenameCommit,
  onRenameCancel,
  onDelete,
}: ChapterListItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: chapter.id, disabled: isRenaming });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  const ordinalStr = String(ordinal).padStart(2, "0");
  const wordCountStr = chapter.wordCount.toLocaleString();

  const renameRef = useRef<HTMLInputElement>(null);

  // Auto-focus the rename input when it appears
  useEffect(() => {
    if (isRenaming && renameRef.current) {
      renameRef.current.focus();
      renameRef.current.select();
    }
  }, [isRenaming]);

  function handleRenameKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      const val = (e.target as HTMLInputElement).value.trim();
      if (val) void onRenameCommit(val);
      else onRenameCancel();
    } else if (e.key === "Escape") {
      onRenameCancel();
    }
  }

  function handleRenameBlur(e: React.FocusEvent<HTMLInputElement>) {
    const val = e.target.value.trim();
    if (val) void onRenameCommit(val);
    else onRenameCancel();
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative flex flex-col px-2 py-1.5 cursor-pointer select-none",
        "hover:bg-accent/50",
        isSelected && "bg-accent text-accent-foreground",
      )}
      onClick={() => {
        if (!isRenaming) onSelect();
      }}
    >
      {/* ── Main row ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5">
        {/* Drag handle */}
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          className={cn(
            "shrink-0 cursor-grab active:cursor-grabbing",
            "text-muted-foreground/0 group-hover:text-muted-foreground/60",
            "transition-colors",
          )}
          aria-label="Drag to reorder"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="size-3.5" />
        </button>

        {/* Ordinal */}
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {ordinalStr}
        </span>

        {/* Title or rename input */}
        <div className="flex-1 min-w-0">
          {isRenaming ? (
            <Input
              ref={renameRef}
              defaultValue={chapter.title}
              className="h-6 px-1 py-0 text-xs"
              onKeyDown={handleRenameKeyDown}
              onBlur={handleRenameBlur}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="block truncate text-sm">{chapter.title}</span>
          )}
        </div>

        {/* Kebab menu */}
        {!isRenaming && (
          <DropdownMenu>
            <DropdownMenuTrigger
              onClick={(e) => e.stopPropagation()}
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Options for "${chapter.title}"`}
                  className={cn(
                    "shrink-0 text-muted-foreground/0 group-hover:text-muted-foreground",
                    "transition-colors",
                    isSelected && "text-accent-foreground/60",
                  )}
                />
              }
            >
              <MoreHorizontal className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onRenameStart();
                }}
              >
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* ── Word count ───────────────────────────────────────────────────── */}
      <span className="ml-[calc(0.875rem+0.375rem+1.25rem)] text-xs text-muted-foreground">
        {wordCountStr} {wordCountStr === "1" ? "word" : "words"}
      </span>
    </div>
  );
}
