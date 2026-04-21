# Import Dialog Break Insertion Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add **Insert scene break** and **Insert chapter break** buttons to the Import dialog. The chapter-break button enables multi-chapter paste — one round-trip from Grok can create multiple ordered chapters — by user-placed `=== CHAPTER ===` markers.

**Architecture:** One new pure helper (`splitChapterChunks`) in `lib/publish/cleanup.ts`. One breaking route envelope change (`{ chapter, warnings }` → `{ chapters, warnings }`) in `app/api/stories/[slug]/chapters/import/route.ts`. One component update to `components/publish/ImportChapterDialog.tsx` covering new toolbar, cursor-aware insertion, multi-chapter preview, and background-sequential recap firing. Cleanup pipeline is otherwise untouched.

**Tech Stack:** Next.js 16, React 19, TypeScript, vitest 4, Playwright, shadcn/ui, SWR.

**Reference spec:** [docs/superpowers/specs/2026-04-21-import-break-insertion-design.md](../specs/2026-04-21-import-break-insertion-design.md).

**Base branch / worktree:** `feature/publishing-kit` at `/home/chase/projects/scriptr/.worktrees/publishing-kit`. Tag `v0.2.0-publishing-kit` points at the Publishing Kit v1 completion; this follow-up lands additional commits on the same branch.

**Quality gates (after every task):**
- `npm run typecheck` — 0 errors.
- `npm run lint` — 0 errors.
- `npm test` — all green (including the privacy smoke).

After the E2E task only: `npm run e2e` must also pass.

Commits: small, frequent, specific `git add <file>` (never `git add -A`). Every commit message gets the trailer `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

**Privacy pillar:** No new routes, no new egress. The privacy smoke at `tests/privacy/no-external-egress.test.ts` must continue passing untouched. Raw paste still never persists.

---

## File structure

**New files:** none. All changes are additive modifications to existing files.

**Modified files:**

| Path | What changes |
|------|--------------|
| `lib/publish/cleanup.ts` | Add `splitChapterChunks` export. Add unmatched-`=== word ===` warning inside `normalizeSceneBreaks`. |
| `app/api/stories/[slug]/chapters/import/route.ts` | Pre-split raw body via `splitChapterChunks`, loop cleanup + `createImportedChapter`, return new envelope. |
| `components/publish/ImportChapterDialog.tsx` | Handle new envelope, toolbar buttons with cursor insertion, multi-chapter preview, sequential background recap. |
| `tests/lib/publish-cleanup.test.ts` | New tests for `splitChapterChunks` + unmatched-word warning. |
| `tests/api/chapters.import.test.ts` | Update existing assertions to `data.chapters[0]`; add multi-chapter tests. |
| `tests/e2e/publishing-kit.spec.ts` | Extend to exercise a `=== CHAPTER ===` marker and assert two chapter records appear. |

---

## Chunk 1: Break insertion (single chunk — 7 tasks)

The whole feature lands as one chunk. Tasks 1–2 are pure-function additions. Task 3 is the coordinated envelope migration (route + consumer + tests) — the app remains functional after each commit. Tasks 4–6 layer on UI + UX. Task 7 is E2E.

### Task 1: `splitChapterChunks` helper

**Files:**
- Modify: `lib/publish/cleanup.ts`
- Modify: `tests/lib/publish-cleanup.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/lib/publish-cleanup.test.ts`:

```ts
import { splitChapterChunks } from "@/lib/publish/cleanup";

describe("splitChapterChunks", () => {
  it("returns [raw] when no marker present", () => {
    expect(splitChapterChunks("just prose")).toEqual(["just prose"]);
  });

  it("splits on canonical === CHAPTER === marker", () => {
    const raw = "chapter one prose\n\n=== CHAPTER ===\n\nchapter two prose";
    expect(splitChapterChunks(raw)).toEqual([
      "chapter one prose\n\n",
      "\n\nchapter two prose",
    ]);
  });

  it("accepts case-insensitive variants", () => {
    const lower = "a\n=== chapter ===\nb";
    const title = "a\n=== Chapter ===\nb";
    const tight = "a\n===CHAPTER===\nb";
    const wide = "a\n==== CHAPTER ====\nb";
    for (const raw of [lower, title, tight, wide]) {
      const out = splitChapterChunks(raw);
      expect(out).toHaveLength(2);
    }
  });

  it("does NOT split on === without the word 'chapter'", () => {
    expect(splitChapterChunks("a\n===\nb")).toEqual(["a\n===\nb"]);
    expect(splitChapterChunks("a\n=== END ===\nb")).toEqual(["a\n=== END ===\nb"]);
  });

  it("handles multiple markers", () => {
    const raw = "a\n=== CHAPTER ===\nb\n=== CHAPTER ===\nc";
    expect(splitChapterChunks(raw)).toHaveLength(3);
  });

  it("preserves leading / trailing empty chunks for caller to filter", () => {
    const raw = "=== CHAPTER ===\nonly";
    const out = splitChapterChunks(raw);
    expect(out).toHaveLength(2);
    expect(out[0].trim()).toBe("");
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
cd /home/chase/projects/scriptr/.worktrees/publishing-kit
npm test -- tests/lib/publish-cleanup.test.ts
```

Expected: FAIL — `splitChapterChunks` not exported.

- [ ] **Step 3: Implement**

Add to `lib/publish/cleanup.ts` (after the existing exports, before `cleanPaste`):

```ts
// Chapter-break pre-split. Runs BEFORE cleanup — the marker is consumed
// as a chapter delimiter, not fed to normalizeSceneBreaks.
// Matches whole-line `=== CHAPTER ===` with case-insensitive / relaxed whitespace.
const CHAPTER_MARKER = /^[ \t]*={3,}[ \t]*chapter[ \t]*={3,}[ \t]*$/gim;

export function splitChapterChunks(raw: string): string[] {
  return raw.split(CHAPTER_MARKER);
}
```

Note: the `m` flag makes `^`/`$` match per-line; `i` is case-insensitive; `g` lets `split` consume every match.

- [ ] **Step 4: Run tests, all pass**

```bash
npm test -- tests/lib/publish-cleanup.test.ts
```

- [ ] **Step 5: Quality gates**

```bash
npm run typecheck && npm run lint && npm test
```

- [ ] **Step 6: Commit**

```bash
git add lib/publish/cleanup.ts tests/lib/publish-cleanup.test.ts
git commit -m "feat(publish): splitChapterChunks pre-split helper

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Unmatched-`=== word ===` warning

If the user typed `=== END ===` or `=== INTERLUDE ===` thinking it'd split, the cleanup pipeline should warn. The warning emits during `normalizeSceneBreaks` when it sees a `={3,}` line that contains a word which ISN'T `chapter`.

**Files:**
- Modify: `lib/publish/cleanup.ts`
- Modify: `tests/lib/publish-cleanup.test.ts`

- [ ] **Step 1: Write failing tests**

Append:

```ts
describe("unmatched === word === warning", () => {
  it("warns when a ===-bracketed word other than 'chapter' appears", () => {
    const raw = "a\n\n=== END ===\n\nb";
    const out = cleanPaste(raw, { stripChatCruft: false, normalizeQuotes: false });
    const msg = out.warnings.find((w) => /did you mean/i.test(w));
    expect(msg).toBeDefined();
    expect(msg).toMatch(/END/i);
    expect(msg).toMatch(/CHAPTER/i);
  });

  it("does NOT warn on plain === (no word)", () => {
    const raw = "a\n\n===\n\nb";
    const out = cleanPaste(raw, { stripChatCruft: false, normalizeQuotes: false });
    expect(out.warnings.some((w) => /did you mean/i.test(w))).toBe(false);
  });

  it("does NOT warn on the canonical === CHAPTER === form", () => {
    // cleanup pipeline is the fallback if pre-split missed it; this test
    // verifies we don't self-trigger on the canonical form.
    const raw = "a\n\n=== CHAPTER ===\n\nb";
    const out = cleanPaste(raw, { stripChatCruft: false, normalizeQuotes: false });
    expect(out.warnings.some((w) => /did you mean/i.test(w))).toBe(false);
  });

  it("leaves === CHAPTER === in the prose if pre-split didn't consume it (defense-in-depth)", () => {
    // The existing MARKER_LINE regex does NOT match lines with embedded words,
    // so the canonical marker survives cleanup as literal text. This verifies
    // the survival — if a regression ever widens MARKER_LINE to swallow
    // `=== CHAPTER ===`, this test catches it.
    const raw = "a\n\n=== CHAPTER ===\n\nb";
    const out = cleanPaste(raw, { stripChatCruft: false, normalizeQuotes: false });
    expect(out.sections.join("\n")).toContain("=== CHAPTER ===");
    expect(out.sections.join("\n")).not.toContain("\n---\n");
  });
});
```

- [ ] **Step 2: Run, expect first two to fail, third may pass or fail depending on what normalizeSceneBreaks does with `=== CHAPTER ===`**

```bash
npm test -- tests/lib/publish-cleanup.test.ts
```

- [ ] **Step 3: Implement**

Inside `lib/publish/cleanup.ts`, update `normalizeSceneBreaks` to emit the warning. Find the existing `MARKER_LINE` regex block and add the word-detection pass BEFORE the line loop:

```ts
// Inside normalizeSceneBreaks, at the very top of the function:
const UNMATCHED_WORD = /^[ \t]*={3,}[ \t]*([A-Za-z]+)[ \t]*={3,}[ \t]*$/;
for (const line of input.split("\n")) {
  const m = line.match(UNMATCHED_WORD);
  if (m && m[1].toLowerCase() !== "chapter") {
    warnings.push(
      `Saw "${line.trim()}" but did not split into chapters; did you mean === CHAPTER ===?`
    );
  }
}
// (existing MARKER_LINE loop continues below unchanged)
```

**Important behavior note:** the existing `MARKER_LINE` regex only matches whole-line `={3,}` with NO embedded word — so `=== END ===` does NOT get normalized to `---`; it stays in the prose as a literal line. The warning is the only signal to the user that their typo didn't produce a chapter split. This is good defense-in-depth: the user sees their unfamiliar marker in the preview AND gets a warning.

- [ ] **Step 4: Run tests, all pass**

- [ ] **Step 5: Quality gates**

```bash
npm run typecheck && npm run lint && npm test
```

- [ ] **Step 6: Commit**

```bash
git add lib/publish/cleanup.ts tests/lib/publish-cleanup.test.ts
git commit -m "feat(publish): warn on === word === when word isn't chapter

Catches typos like === END === that would otherwise silently normalize
to a scene break rather than split into chapters.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Route + dialog envelope migration (coordinated)

This task bundles three file changes into a single commit because they're a breaking-envelope change: the route returns `{ chapters, warnings }`, the route tests assert the new shape, the dialog reads the new shape. Splitting them across commits would leave intermediate states with failing tests or a broken app. The feature is still useful after this commit (multi-chapter markers work!) — the remaining tasks add UX polish.

**Files:**
- Modify: `app/api/stories/[slug]/chapters/import/route.ts`
- Modify: `tests/api/chapters.import.test.ts`
- Modify: `components/publish/ImportChapterDialog.tsx`

- [ ] **Step 1: Update the route tests to the new envelope AND add two new multi-chapter tests**

In `tests/api/chapters.import.test.ts`, the existing `body.data.chapter` assertions change to `body.data.chapters[0]`; existing `body.data.warnings` becomes `body.data.warnings[0]`. Update them, keeping the same test intent.

Then add two new tests at the bottom of the `describe`:

```ts
it("splits a paste with === CHAPTER === into multiple chapters in order", async () => {
  const story = await createStory(tmpDir, { title: "S" });
  const raw = [
    "Chapter 1: Opening",
    "",
    "First chapter prose.",
    "",
    "=== CHAPTER ===",
    "",
    "Chapter 2: Middle",
    "",
    "Second chapter prose.",
  ].join("\n");
  const res = await callPost(story.slug, { raw });
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.data.chapters).toHaveLength(2);
  expect(body.data.chapters[0].title).toBe("Opening");
  expect(body.data.chapters[1].title).toBe("Middle");
  expect(body.data.warnings).toHaveLength(2);

  const chapters = await listChapters(tmpDir, story.slug);
  expect(chapters).toHaveLength(2);
  expect(chapters.map((c) => c.title)).toEqual(["Opening", "Middle"]);
});

it("drops empty chunks silently (leading marker, back-to-back)", async () => {
  const story = await createStory(tmpDir, { title: "S" });
  const raw = "=== CHAPTER ===\n\nOnly one chapter actually.\n\n=== CHAPTER ===\n\n=== CHAPTER ===\n\nAnother.";
  const res = await callPost(story.slug, { raw });
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.data.chapters).toHaveLength(2);
});
```

- [ ] **Step 2: Run tests, expect failures**

```bash
npm test -- tests/api/chapters.import.test.ts
```

Every updated assertion fails because the route still returns `{ chapter, warnings }`.

- [ ] **Step 3: Update the route**

Rewrite the handler body in `app/api/stories/[slug]/chapters/import/route.ts`. Keep the existing helpers (`inferTitle`, `MAX_PASTE_BYTES`) and imports; replace only the POST handler body:

```ts
import { cleanPaste, splitChapterChunks, type CleanupOptions } from "@/lib/publish/cleanup";
// (other imports unchanged)

export async function POST(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;

  const story = await getStory(effectiveDataDir(), slug);
  if (!story) return fail("story not found", 404);

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

  // Pre-split on chapter markers. Single-chapter paste yields a 1-element array.
  const rawChunks = splitChapterChunks(raw)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  if (rawChunks.length === 0) {
    return fail("no prose detected after cleanup", 400);
  }

  type Cleaned = { sections: string[]; warnings: string[]; sourceRaw: string };
  const cleanedChunks: Cleaned[] = [];
  for (const chunk of rawChunks) {
    const { sections, warnings } = cleanPaste(chunk, cleanupOptions);
    if (sections.length === 0) continue; // silent drop per spec
    cleanedChunks.push({ sections, warnings, sourceRaw: chunk });
  }

  if (cleanedChunks.length === 0) {
    return fail("no prose detected after cleanup", 400);
  }

  const dataDir = effectiveDataDir();
  const chapters: Awaited<ReturnType<typeof createImportedChapter>>[] = [];
  const allWarnings: string[][] = [];

  for (let i = 0; i < cleanedChunks.length; i++) {
    const { sections, warnings, sourceRaw } = cleanedChunks[i];
    const title =
      i === 0 && providedTitle
        ? providedTitle
        : inferTitle(sourceRaw);
    const chapter = await createImportedChapter(dataDir, slug, {
      title,
      sectionContents: sections,
    });
    chapters.push(chapter);
    allWarnings.push(warnings);
  }

  return ok({ chapters, warnings: allWarnings }, { status: 201 });
}
```

- [ ] **Step 4: Update the dialog**

In `components/publish/ImportChapterDialog.tsx`, find the `handleSave` function. Change the response parsing:

```ts
// Replace:
const chapter = body.data.chapter as Chapter;
toast.success(`Imported "${chapter.title}".`);
onImported(chapter);

// With:
const chapters = body.data.chapters as Chapter[];
if (chapters.length === 1) {
  toast.success(`Imported "${chapters[0].title}".`);
} else {
  toast.success(`Imported ${chapters.length} chapters.`);
}
onImported(chapters);
```

And update the `onImported` prop type in the `Props` type declaration at the top:

```ts
// Change: onImported: (chapter: Chapter) => void;
// To:
onImported: (chapters: Chapter[]) => void;
```

The recap fire-and-forget code needs updating too — but defer to Task 6; for now, make the minimum change to keep the existing (single-chapter) recap path working when chapters.length === 1:

```ts
// Inside handleSave, AFTER chapters is defined:
if (generateRecap && chapters.length === 1) {
  const chapter = chapters[0];
  fetch("/api/generate/recap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ storySlug: slug, chapterId: chapter.id }),
  }).catch(() => {
    toast.error("Recap failed to start; you can regenerate later.");
  });
}
// Multi-chapter recap: see Task 6.
```

- [ ] **Step 5: Run all tests, all pass**

```bash
npm run typecheck && npm run lint && npm test
```

Route tests updated. E2E not yet run (that's Task 7).

- [ ] **Step 6: Commit**

```bash
git add \
  app/api/stories/\[slug\]/chapters/import/route.ts \
  tests/api/chapters.import.test.ts \
  components/publish/ImportChapterDialog.tsx
git commit -m "feat(publish): multi-chapter import via === CHAPTER === marker

Breaking envelope change: import route returns { chapters, warnings }
instead of { chapter, warnings }. Only in-tree caller (the dialog)
updated in the same commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

At this commit: the multi-chapter capability works end-to-end via API / manual JSON body. Remaining tasks layer on UX (toolbar, preview, recap sequencing, E2E).

---

### Task 4: Toolbar buttons + cursor-aware insertion

**Files:**
- Modify: `components/publish/ImportChapterDialog.tsx`

- [ ] **Step 1: Add a `textareaRef` and two toolbar buttons**

Near the top of the `ImportChapterDialog` component:

```ts
import { useRef } from "react";
// ... existing imports ...
import { Sparkles, BookmarkPlus } from "lucide-react";

// Inside the component:
const textareaRef = useRef<HTMLTextAreaElement>(null);
```

Define the insertion helper:

```ts
function insertAtCursor(marker: string) {
  const el = textareaRef.current;
  if (!el) {
    setRaw((prev) => prev + marker);
    return;
  }
  const start = el.selectionStart ?? raw.length;
  const end = el.selectionEnd ?? raw.length;
  const before = raw.slice(0, start);
  const after = raw.slice(end);

  // Trim redundant blank lines around the cursor so the marker doesn't pile up.
  const trimmedBefore = before.replace(/\n*$/, "");
  const trimmedAfter = after.replace(/^\n*/, "");
  const spliced = `${trimmedBefore}${marker}${trimmedAfter}`;
  setRaw(spliced);

  // Restore focus and place cursor at end of inserted marker.
  requestAnimationFrame(() => {
    const newPos = (trimmedBefore + marker).length;
    el.focus();
    el.setSelectionRange(newPos, newPos);
  });
}

const insertSceneBreak = () => insertAtCursor("\n\n* * *\n\n");
const insertChapterBreak = () => insertAtCursor("\n\n=== CHAPTER ===\n\n");
```

Wire the textarea. The current dialog uses the shadcn `<Textarea>` wrapper (not a bare `<textarea>`). React 19 forwards refs as regular props through function components, and the shadcn `Textarea` spreads `{...props}` to the underlying element — so `ref={textareaRef}` on `<Textarea>` resolves to the native DOM node. Keep the existing `<Textarea>` component and add the ref:

```tsx
<Textarea
  ref={textareaRef}
  value={raw}
  // ... existing props ...
/>
```

Do NOT swap to a bare `<textarea>` — that loses shadcn styling tokens and changes the visual.

- [ ] **Step 2: Add the toolbar**

Above the textarea in the left pane, between the "PASTE RAW PROSE" label and the textarea itself, add:

```tsx
<div className="flex items-center gap-2">
  <Button
    type="button"
    variant="ghost"
    size="sm"
    onClick={insertSceneBreak}
    title="Insert scene break (* * *)"
  >
    <Sparkles className="w-3.5 h-3.5" />
    Scene break
  </Button>
  <Button
    type="button"
    variant="ghost"
    size="sm"
    onClick={insertChapterBreak}
    title="Insert chapter break (=== CHAPTER ===)"
  >
    <BookmarkPlus className="w-3.5 h-3.5" />
    Chapter break
  </Button>
</div>
```

(Use the shadcn `Button` already imported in the file. `Sparkles` / `BookmarkPlus` are lucide icons; if either isn't present in `lucide-react`, pick any two distinct small icons already imported elsewhere in the project.)

- [ ] **Step 3: Manual smoke**

```bash
npm run dev
```

Open a story → Import chapter → paste a bit of text → put the cursor in the middle → click Scene break. The marker should appear at cursor with clean blank lines. Same for Chapter break.

Close the dev server when done.

- [ ] **Step 4: Quality gates**

```bash
npm run typecheck && npm run lint && npm test
```

- [ ] **Step 5: Commit**

```bash
git add components/publish/ImportChapterDialog.tsx
git commit -m "feat(publish): toolbar buttons for scene + chapter break insertion

Cursor-aware: splices the marker at selectionStart/End with smart
blank-line trimming so markers don't pile up near existing blank lines.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Multi-chapter live preview

Today the preview pane renders one chapter. Make it render N when `=== CHAPTER ===` markers split the paste.

**Files:**
- Modify: `components/publish/ImportChapterDialog.tsx`

- [ ] **Step 1: Compute per-chunk previews**

Inside `ImportChapterDialog`, replace the existing `cleaned` and `previewChapter` / `previewHtml` memos with a chunks-aware pipeline:

```ts
import { splitChapterChunks } from "@/lib/publish/cleanup";

// Replace previous `cleaned` useMemo:
const chunks = useMemo(() => {
  const split = splitChapterChunks(raw).map((c) => c.trim()).filter((c) => c.length > 0);
  return split.length === 0 ? [""] : split;
}, [raw]);

const perChunk = useMemo(() => {
  return chunks.map((chunk, i) => {
    const result = cleanPaste(chunk, options);
    const previewChapter: Chapter | null =
      result.sections.length === 0
        ? null
        : {
            id: `preview-${i}`,
            title: i === 0 ? (title || "Untitled") : (inferTitle(chunk) || "Untitled"),
            summary: "",
            beats: [],
            prompt: "",
            recap: "",
            sections: result.sections.map((c, j) => ({ id: `p${i}-${j}`, content: c })),
            wordCount: 0,
          };
    return {
      warnings: result.warnings,
      previewChapter,
      previewHtml: previewChapter
        ? renderChapterPreviewHtml(previewChapter, { chapterNumber: i + 1 })
        : "",
      sectionCount: result.sections.length,
    };
  });
}, [chunks, options, title]);

const totalSections = perChunk.reduce((acc, p) => acc + p.sectionCount, 0);
const allWarnings = perChunk.flatMap((p) => p.warnings);
const isMulti = perChunk.length > 1;
```

**Extract `inferTitle` to the shared module before wiring.** The server already has `inferTitle` in `app/api/stories/[slug]/chapters/import/route.ts`. Duplicating it client-side would drift over time. Instead:

1. Move `inferTitle` (the function body, unchanged) from the route file into `lib/publish/cleanup.ts` as a named export.
2. In the route, replace the local definition with `import { inferTitle } from "@/lib/publish/cleanup";`.
3. In the dialog, import the same symbol: `import { cleanPaste, splitChapterChunks, inferTitle } from "@/lib/publish/cleanup";`.
4. Run `npm test` — all existing route tests for title inference should still pass because the logic is byte-identical.

This is a small pre-step that belongs IN Task 5 because this is the first task that would create duplication. No separate commit — bundle the extraction with the preview-chunking commit.

- [ ] **Step 2: Update the warnings panel + footer summary**

Warnings:

```tsx
{allWarnings.length > 0 && (
  <div>
    <div className="text-xs uppercase text-muted-foreground mb-1">Warnings</div>
    <ul className="text-xs text-muted-foreground flex flex-col gap-0.5">
      {allWarnings.map((w, i) => <li key={i}>{w}</li>)}
    </ul>
  </div>
)}
```

Footer:

```tsx
<div className="text-xs text-muted-foreground">
  {isMulti
    ? `${perChunk.length} chapters · ${totalSections} sections total`
    : `${totalSections} section${totalSections === 1 ? "" : "s"}`}
</div>
```

Title input label:

```tsx
<label className="text-xs text-muted-foreground">
  {isMulti ? "Chapter title (first chapter)" : "Chapter title"}
</label>
```

(Don't clear the `title` state when `isMulti` flips — the user's typed value is preserved per spec.)

- [ ] **Step 3: Render multi-chapter preview**

Replace the preview pane's single `<SafeHtml>` with a map:

```tsx
<div className="flex-1 overflow-auto border border-border rounded p-4 bg-background">
  {perChunk.map((p, i) => (
    <div key={i}>
      {i > 0 && (
        <div className="flex items-center gap-2 my-6 text-xs uppercase text-muted-foreground">
          <div className="flex-1 border-t border-border" />
          <span>Chapter {i + 1}</span>
          <div className="flex-1 border-t border-border" />
        </div>
      )}
      {p.previewHtml ? (
        <SafeHtml html={p.previewHtml} />
      ) : (
        <div className="text-xs text-muted-foreground italic">Empty chapter — will be skipped.</div>
      )}
    </div>
  ))}
</div>
```

- [ ] **Step 4: Manual smoke**

```bash
npm run dev
```

Paste something, click Chapter break, verify the preview now shows two chapter blocks separated by a divider. Close dev server.

- [ ] **Step 5: Quality gates**

```bash
npm run typecheck && npm run lint && npm test
```

- [ ] **Step 6: Commit**

```bash
git add components/publish/ImportChapterDialog.tsx
git commit -m "feat(publish): multi-chapter live preview in Import dialog

Chunks the raw paste on === CHAPTER === markers and renders each as
its own preview block with a labeled divider. Footer summary and
title-input label adapt to the multi-chapter state.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Sequential background recap for multi-chapter

**Files:**
- Modify: `components/publish/ImportChapterDialog.tsx`

- [ ] **Step 1: Replace the single-chapter recap branch with a sequential fire-after-close**

In `handleSave`, find the block guarded by `generateRecap && chapters.length === 1` and replace it with:

```ts
if (generateRecap) {
  // Fire recaps in the background, sequentially — await each before
  // kicking the next so we don't slam Grok with N concurrent calls.
  // The IIFE runs independently of the dialog close; requests survive
  // component unmount because they're owned by the browser.
  void (async () => {
    for (const chapter of chapters) {
      try {
        const res = await fetch("/api/generate/recap", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ storySlug: slug, chapterId: chapter.id }),
        });
        if (!res.ok) {
          toast.error(`Recap failed for "${chapter.title}".`);
        } else if (chapters.length > 1) {
          toast.success(`Recap ready for "${chapter.title}".`);
        }
      } catch {
        toast.error(`Recap failed for "${chapter.title}".`);
      }
    }
  })();
}
```

**Ordering verification:** after pasting, confirm the function still has `onOpenChange(false)` and the state-reset calls (`setRaw("")`, `setTitle("")`) BELOW the recap block. The dialog's existing `handleSave` already ends with those calls inside the `try` block — don't move them. The IIFE fires and returns immediately (it doesn't await); then the dialog closes and clears state on the same synchronous tick.

- [ ] **Step 2: Manual smoke (optional)**

If your `.env.local` has a real Grok key, create two chapters via chapter-break paste with "Generate recap" ON. Dialog closes immediately; toasts appear as each recap completes.

- [ ] **Step 3: Quality gates**

```bash
npm run typecheck && npm run lint && npm test
```

- [ ] **Step 4: Commit**

```bash
git add components/publish/ImportChapterDialog.tsx
git commit -m "feat(publish): sequential background recap for multi-chapter import

Dialog closes immediately on save; recaps fire sequentially in the
background, one awaited at a time so we don't slam Grok with N
concurrent calls. Per-chapter toast on completion or failure.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: E2E extension

**Files:**
- Modify: `tests/e2e/publishing-kit.spec.ts`

- [ ] **Step 1: Add a new test case**

Append to `tests/e2e/publishing-kit.spec.ts`:

```ts
test("import paste with chapter-break marker creates multiple chapters", async ({ page }) => {
  const DATA_DIR = process.env.SCRIPTR_DATA_DIR!;
  expect(DATA_DIR).toBeTruthy();

  const createRes = await page.request.post(
    "http://127.0.0.1:3001/api/stories",
    { data: { title: "Multi Chapter E2E", authorPenName: "Test Author" } }
  );
  const { data: story } = await createRes.json();

  await page.goto(`http://127.0.0.1:3001/s/${story.slug}`);
  await page.getByRole("button", { name: /import chapter/i }).click();

  const paste = [
    "Chapter 1: Opening",
    "",
    "She walked in.",
    "",
    "=== CHAPTER ===",
    "",
    "Chapter 2: The Middle",
    "",
    "He waited for her.",
  ].join("\n");

  await page.getByTestId("import-paste").fill(paste);

  // Preview should now show two chapter blocks.
  const previews = page.locator(".epub-preview");
  await expect(previews).toHaveCount(2);

  await page.getByTestId("import-save").click();

  // Both chapters appear in the list.
  await expect(page.getByText("Opening", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("The Middle", { exact: true }).first()).toBeVisible();
});
```

This test **assumes** `data-testid="import-paste"` and `data-testid="import-save"` already exist on the dialog (they were added in Chunk 5/7 of the original Publishing Kit plan). Also assumes `.epub-preview` class on each preview block. If the preview pane's structure changed during Task 5 and the class isn't present, add it in the multi-chapter map — each block needs `class="epub-preview"` as an outer wrapper for SafeHtml to produce the expected locator target. `renderChapterPreviewHtml` already emits `<div class="epub-preview">...</div>` — verify `SafeHtml`'s allowlist doesn't strip it (it shouldn't; `class` is in `ALLOWED_ATTR`).

- [ ] **Step 2: Run the E2E**

```bash
npm run e2e -- tests/e2e/publishing-kit.spec.ts
```

Both tests in the file should pass — the original golden path + the new multi-chapter one.

If the new test's `.epub-preview` locator has count != 2, inspect the Task 5 preview rendering and fix the wrapping structure (not by loosening the test). If title assertions are ambiguous, `first()` already narrows — but if it picks up a sidebar mention, add `data-testid` attributes to the ChapterList items in a follow-up.

- [ ] **Step 3: Full gates**

```bash
npm run typecheck && npm run lint && npm test && npm run e2e
```

Every one green.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/publishing-kit.spec.ts
git commit -m "test(e2e): chapter-break marker creates multiple chapters

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Summary

After all 7 tasks:

- One new pure helper (`splitChapterChunks`) in the cleanup module.
- One new warning in `normalizeSceneBreaks` catching `=== word ===` typos.
- Import route splits on chapter markers and returns `{ chapters, warnings }` — a breaking but in-tree-safe envelope migration.
- Import dialog gets toolbar buttons, cursor-aware insertion, multi-chapter preview with dividers, and background-sequential recap firing.
- E2E covers the multi-chapter path.

Zero new external egress. Privacy smoke unchanged. No data migration.

The feature is a single chunk of ~7 tasks, lands on the existing `feature/publishing-kit` branch as follow-up commits, and leaves the app in a usable state at every commit boundary.
