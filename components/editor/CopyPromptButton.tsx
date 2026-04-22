"use client";

import { Clipboard } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CopyPromptButtonProps {
  onClick: () => void;
  /** Disabled during the initial fetch or when story context is incomplete. */
  disabled?: boolean;
}

/**
 * Secondary button next to GenerateChapterButton in the empty-state CTA area.
 * Opens the CopyPromptDialog. Kept presentational; all state lives in the
 * parent EditorPane so Generate and Copy-prompt share empty-state layout.
 */
export function CopyPromptButton({ onClick, disabled }: CopyPromptButtonProps) {
  return (
    <Button variant="outline" onClick={onClick} disabled={disabled}>
      <Clipboard className="h-4 w-4" aria-hidden="true" />
      Copy prompt
    </Button>
  );
}
