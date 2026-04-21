# scriptr — Import Dialog Break Insertion Design Spec

**Date:** 2026-04-21
**Author:** Chase (with Claude)
**Status:** Draft

## Summary

Add two buttons to the Import dialog's paste textarea: **Insert scene break** and **Insert chapter break**. Scene break inserts `* * *` at the cursor and behaves as today (cleanup normalizes to `---`, splits into sections). Chapter break inserts a new `=== CHAPTER ===` marker that the import route splits on, creating multiple `Chapter` records from a single paste. The preview pane renders each chapter as its own block when multiple are present.

This is the multi-chapter-paste capability that v1's Publishing Kit explicitly deferred. Driven by user-placed markers rather than auto-detection — the user keeps full control over where chapter boundaries land.

## Goals

1. Let the user insert scene-break markers at cursor position with one click — no need to type `* * *` by hand.
2. Let the user place chapter-break markers in a single paste so one round-trip from Grok produces multiple ordered chapters in the story.
3. Preview pane updates live as breaks are inserted, showing the same chapter-by-chapter rendering the EPUB will produce.
4. Single-chapter pastes (no chapter-break marker) keep behaving exactly as today — no regression on the v1 happy path.
5. Privacy invariant intact: still no raw paste persisted, no new external egress.

## Non-goals

- Splitting an already-saved chapter via the existing chapter editor (deferred).
- Merging two saved chapters into one.
- Auto-detection of chapter headings inside a paste (the user must place the marker explicitly — auto-detection would over-split novel prose that mentions chapters).
- Per-chapter recap opt-in (current "Generate recap" checkbox applies once for the whole paste; if checked with multi-chapter, recap fires for each created chapter — see Trade-offs).
- Per-chapter title editor in the dialog (inferred per-chunk from text; user edits later in the chapter editor if needed).

## Marker convention

Chapter break: `=== CHAPTER ===` on its own line.

Distinctive (no realistic prose contains this verbatim), human-readable, easy to type if the user prefers keyboard. Three equals signs match the existing scene-break recognizer's regex (`={3,}`), but the all-caps `CHAPTER` word disambiguates — the import route's pre-split looks for the literal whole-line match `^\s*=== CHAPTER ===\s*$` BEFORE the cleanup pipeline runs, so the line is consumed as a chapter delimiter rather than mis-normalized into a scene break.

If the user types only `===` (without `CHAPTER`), the cleanup pipeline still treats it as a scene break — backward-compatible.

## Data flow

Today (v1, single-chapter):

```
paste → POST /chapters/import → cleanPaste → 1 Chapter created → response { chapter, warnings }
```

After this change:

```
paste → POST /chapters/import → split on === CHAPTER === → N raw chunks
     → for each chunk: cleanPaste → N CleanResults
     → for each result: createImportedChapter → N Chapter records (in order)
     → response { chapters: Chapter[], warnings: string[][] }
```

Single-chapter case (no chapter marker present): N=1, response shape uses the same field name (`chapters: [oneChapter]`, `warnings: [oneWarningList]`). The dialog handles both with a single render path. Existing route tests get updated assertions; no behavioral regression.

## UI

### Toolbar

A small button row sits between the "PASTE RAW PROSE" label and the textarea:

```
[Insert scene break] [Insert chapter break]
```

Two shadcn `Button` instances, `variant="ghost"` `size="sm"`, with lucide icons (`Sparkles` for scene, `BookmarkPlus` for chapter — or any matching pair already in the project).

### Insertion behavior

On click:

1. Capture `textareaRef.current.selectionStart` and `selectionEnd`.
2. Determine the marker:
   - Scene: `\n\n* * *\n\n`
   - Chapter: `\n\n=== CHAPTER ===\n\n`
3. If the cursor sits in the middle of a paragraph (non-blank chars on both sides), prepend/append `\n\n` as above. If the cursor is already on a blank line, trim the leading/trailing newlines so we don't pile up.
4. Splice the marker into the raw text.
5. Update React state.
6. Refocus the textarea, cursor positioned at end of the inserted marker.

The "smart blank-line trim" keeps the inserted marker visually clean regardless of cursor position.

### Preview pane

Today: one `<SafeHtml>` wrapping `renderChapterPreviewHtml(previewChapter)`.

After: when N>1, the preview pane renders N preview blocks in order, separated by a thin divider with a "—— Chapter N ——" label between them. Each preview block is a `<SafeHtml>` instance with the same EPUB stylesheet applied.

When N=1, no divider — looks identical to today.

The component computes the chapters array client-side using the same split-on-marker logic the route uses (a small shared helper exported from `lib/publish/cleanup.ts` keeps client and server consistent).

### Footer summary

Today: "N sections".
After: "N chapters · M sections total" when N>1; unchanged when N=1.

## Title inference per chunk

Reuses the existing `inferTitle(raw)` helper from the import route. For each chunk in the multi-chapter case, `inferTitle` runs on that chunk's raw text. Same priority rules:

1. `Chapter N: Title` regex → use captured title (or "Chapter N" if no title).
2. Short standalone line followed by blank line → use it verbatim.
3. 60-char truncation of first paragraph → fallback.

If the user provides an explicit `title` in the request body, it applies only to the **first** chapter; subsequent chapters use their inferred titles. The dialog's "Chapter title" input remains a single field — labeled "Chapter title (first chapter)" when N>1.

## API

### Request body — additive

```ts
POST /api/stories/[slug]/chapters/import
{
  raw: string;
  cleanupOptions?: CleanupOptions;
  title?: string;   // applies to first chapter only when multiple
  generateRecap?: boolean;
}
```

No new fields. The `=== CHAPTER ===` markers live inside `raw`.

### Response body — shape change

Before:

```ts
{ ok: true, data: { chapter: Chapter, warnings: string[] } }
```

After:

```ts
{ ok: true, data: { chapters: Chapter[], warnings: string[][] } }
```

`warnings[i]` is the cleanup warning list for `chapters[i]`. Always an array (length 1 in the single-chapter case).

The dialog's existing onImported callback signature changes from `(chapter: Chapter) => void` to `(chapters: Chapter[]) => void`. ChapterList's wiring point (`onImported={() => mutate()}`) doesn't read the argument, so no caller-side breakage.

### Error handling

- A paste with `=== CHAPTER ===` but only whitespace between markers (e.g. user inserted two markers back-to-back) → that empty chunk is dropped silently. Warning emitted: `"Empty chapter between markers — skipped."`
- A paste that is JUST a chapter marker (no prose anywhere) → returns 400, "no prose detected after cleanup."
- A chunk that produces zero sections after cleanup → 400 only if it's the only chunk; otherwise dropped silently with a per-chunk warning.

## Recap opt-in interaction

When `generateRecap: true` is set on a multi-chapter paste, the client fires the `/api/generate/recap` route once per created chapter. Recaps run sequentially client-side (await each before firing the next) so we don't slam Grok with N concurrent calls.

If only one chapter results, behavior is identical to today.

## Privacy

No change. Raw paste still travels only in the request body and is never persisted. The route still calls no external network. The privacy smoke test stays untouched.

## Testing

### Unit — cleanup module

Add one test for the new shared helper `splitChapterChunks(raw: string): string[]`:

- No marker → returns `[raw]`.
- One marker → returns 2 chunks (text before, text after).
- Two markers → returns 3 chunks.
- Whitespace-only chunk between markers → still returned (route filters empties later).
- Marker at start or end of input → leading/trailing empty chunks returned (route filters).

### Route — `chapters.import.test.ts`

Existing tests adjusted for the new envelope (`data.chapters[0]` instead of `data.chapter`). Two new tests:

- Multi-chapter paste with one chapter break creates two ordered chapters with correctly inferred titles.
- Multi-chapter paste with `generateRecap: true` ... (recap is client-side, so not asserted here — see E2E).

### E2E

Extend `tests/e2e/publishing-kit.spec.ts` (or add a sibling) — paste two chapters separated by `=== CHAPTER ===`, assert two chapter records appear in the story's chapter list.

## Component breakdown

- `lib/publish/cleanup.ts` — add and export `splitChapterChunks(raw: string): string[]`. Pure function. No change to `cleanPaste`.
- `app/api/stories/[slug]/chapters/import/route.ts` — pre-split via `splitChapterChunks`, loop `cleanPaste` + `createImportedChapter`, return new envelope.
- `components/publish/ImportChapterDialog.tsx` — toolbar buttons, cursor-aware insertion, multi-chapter preview, response handling, sequential recap firing.

`ChapterList.tsx` and the import-related E2E selectors don't change beyond test assertion updates.

## Migration

None. The change is additive. Existing single-chapter pastes work identically; multi-chapter pastes are opt-in via the new marker.

## Open questions resolved

| Question | Answer |
|---|---|
| Marker text? | `=== CHAPTER ===` whole-line. |
| Auto-detect "Chapter N:" headings as splits? | No — explicit user marker only. Avoids over-splitting. |
| Per-chapter title input? | No — single "Chapter title (first chapter)" input; rest inferred. |
| Recap behavior with multi-chapter? | Client fires recap per chapter, sequentially. |
| Response shape? | `{ chapters: Chapter[], warnings: string[][] }` — array always, length 1 in single-chapter case. |
| Edit chapter splits in the existing chapter editor? | No — out of scope. |

## Trade-offs

- **Sequential recap** keeps from spamming Grok but means a 5-chapter paste takes 5x as long to fully recap. Acceptable; user can always close the dialog and let recaps complete in the background.
- **First-chapter-only title input** is simplest but means the user can't pre-set titles for chapters 2..N before save. They edit after via the existing chapter editor. Worth revisiting only if it becomes a friction point.
- **`=== CHAPTER ===` is verbose** but unmistakable. Shorter markers like `===` collide with scene breaks; `===C===` is cryptic. The verbose form is a click in the toolbar — typing it is rare.
