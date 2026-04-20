"use client";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { AutoSaveStatus } from "@/hooks/useAutoSave";

interface BibleFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  saveStatus?: AutoSaveStatus;
}

function SaveStatusText({ status }: { status?: AutoSaveStatus }) {
  if (!status || status === "idle") return null;
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

/**
 * Pure controlled field: label + textarea + an optional save-status indicator.
 * Does not know about saving — status is passed in from the parent BibleSection.
 */
export function BibleField({
  id,
  label,
  value,
  onChange,
  placeholder,
  rows,
  saveStatus,
}: BibleFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={id} className="text-xs font-medium">
          {label}
        </Label>
        <SaveStatusText status={saveStatus} />
      </div>
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="resize-none text-sm"
      />
    </div>
  );
}
