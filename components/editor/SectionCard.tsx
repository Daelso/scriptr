"use client";

import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Section } from "@/lib/types";

interface SectionCardProps {
  section: Section;
}

export function SectionCard({ section }: SectionCardProps) {
  return (
    <article className="py-4 border-b border-border last:border-b-0">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {section.regenNote && (
            <p className="mb-2 text-xs text-muted-foreground italic">
              {section.regenNote}
            </p>
          )}
          <p className="text-base leading-relaxed text-foreground whitespace-pre-wrap">
            {section.content}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled
          aria-label="Section options (coming soon)"
          className="mt-0.5 shrink-0"
        >
          <MoreHorizontal />
        </Button>
      </div>
    </article>
  );
}
