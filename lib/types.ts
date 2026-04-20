export type Story = {
  slug: string;
  title: string;
  authorPenName: string;
  subtitle?: string;
  description: string;
  copyrightYear: number;
  language: string;
  bisacCategory: string;
  keywords: string[];
  isbn?: string;
  createdAt: string;
  updatedAt: string;
  chapterOrder: string[];
  modelOverride?: string;
};

export type Character = {
  name: string;
  description: string;
  traits?: string;
};

import type { StyleRules } from "@/lib/style";

export type Bible = {
  characters: Character[];
  setting: string;
  pov: "first" | "second" | "third-limited" | "third-omniscient";
  tone: string;
  styleNotes: string;
  nsfwPreferences: string;
  styleOverrides?: StyleRules;
};

export type Section = {
  id: string;
  content: string;
  regenNote?: string;
};

export type Chapter = {
  id: string;
  title: string;
  summary: string;
  beats: string[];
  prompt: string;
  recap: string;
  sections: Section[];
  wordCount: number;
  targetWords?: number;
  source?: "generated" | "imported";
};

export type GenerationMode = "full" | "section" | "continue";

export type GenerateRequest = {
  storySlug: string;
  chapterId: string;
  mode: GenerationMode;
  sectionId?: string;
  regenNote?: string;
  includeLastChapterFullText?: boolean;
};

export type GenerateEvent =
  | { type: "start"; jobId: string }
  | { type: "token"; text: string }
  | { type: "section-break" }
  | { type: "done"; finishReason: string }
  | { type: "recap"; text: string }
  | { type: "error"; message: string; kind?: string };

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };
