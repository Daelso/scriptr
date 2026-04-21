import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api";
import { getStory } from "@/lib/storage/stories";
import { createImportedChapter } from "@/lib/storage/chapters";
import { effectiveDataDir } from "@/lib/config";
import { cleanPaste, type CleanupOptions } from "@/lib/publish/cleanup";

type Ctx = { params: Promise<{ slug: string }> };

const MAX_PASTE_BYTES = 1_000_000;

function inferTitle(raw: string): string {
  // Rule 1: "Chapter N" heading regex.
  const m = raw.match(
    /^(?:chapter|ch\.?)\s+(\d+|[ivxlcdm]+)(?:\s*[:\-\u2014.]\s*(.+))?$/im
  );
  if (m) {
    const explicit = m[2]?.trim();
    if (explicit) return explicit;
    return `Chapter ${m[1]}`;
  }
  // Rule 2: Short standalone line followed by a blank line.
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i].trim();
    const next = lines[i + 1].trim();
    if (line.length >= 3 && line.length <= 60 && next.length === 0) {
      return line;
    }
  }
  // Rule 3: First-paragraph truncation.
  const firstPara = raw.trim().split(/\n\s*\n/)[0] ?? "";
  if (firstPara.length <= 60) return firstPara;
  const trunc = firstPara.slice(0, 60);
  const lastSpace = trunc.lastIndexOf(" ");
  return (lastSpace > 20 ? trunc.slice(0, lastSpace) : trunc) + "\u2026";
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;

  const story = await getStory(effectiveDataDir(), slug);
  if (!story) return fail("story not found", 404);

  // Explicit body-size guard — Next.js does not enforce.
  const bodyText = await req.text();
  if (bodyText.length > MAX_PASTE_BYTES) {
    return fail("paste exceeds 1 MB limit", 413);
  }

  let parsed: { raw?: unknown; cleanupOptions?: unknown; title?: unknown };
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return fail("invalid JSON body");
  }

  if (typeof parsed.raw !== "string" || parsed.raw.trim() === "") {
    return fail("raw required", 400);
  }
  const raw = parsed.raw;
  const cleanupOptions: CleanupOptions =
    parsed.cleanupOptions && typeof parsed.cleanupOptions === "object"
      ? (parsed.cleanupOptions as CleanupOptions)
      : {};
  const providedTitle =
    typeof parsed.title === "string" && parsed.title.trim() !== ""
      ? parsed.title.trim()
      : undefined;

  const { sections, warnings } = cleanPaste(raw, cleanupOptions);
  if (sections.length === 0) {
    return fail("no prose detected after cleanup", 400);
  }

  const title = providedTitle ?? inferTitle(raw);
  const chapter = await createImportedChapter(effectiveDataDir(), slug, {
    title,
    sectionContents: sections,
  });

  return ok({ chapter, warnings }, { status: 201 });
}
