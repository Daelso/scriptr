"use client";

import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/editor/SectionCard";
import type { Section } from "@/lib/types";

interface SectionListProps {
  slug: string;
  chapterId: string;
  sections: Section[];
}

export function SectionList({ sections }: SectionListProps) {
  if (sections.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <Button disabled>Generate chapter</Button>
      </div>
    );
  }

  return (
    <div>
      {sections.map((section) => (
        <SectionCard key={section.id} section={section} />
      ))}
    </div>
  );
}
