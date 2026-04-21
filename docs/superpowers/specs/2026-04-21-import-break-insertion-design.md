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

Chapter break: `=== CHAPTER ===` on its own line, case-insensitive, with relaxed whitespace.

The pre-split recognizer in `splitChapterChunks` (run BEFORE cleanup) matches `^\s*={3,}\s*chapter\s*={3,}\s*$` (case-insensitive). This accepts `=== CHAPTER ===`, `===CHAPTER===`, `=== chapter ===`, `==== Chapter ====`, etc. The all-caps form is what the toolbar button inserts; the relaxed regex just prevents typo footguns.

Lines containing `===` without the word `chapter` (case-insensitive) fall through to the cleanup pipeline's `normalizeSceneBreaks` (`={3,}` recognizer) and become scene breaks. This is intentional — backward-compatible with users who already type `===` for scene breaks.

**Defense-in-depth warning.** When `cleanPaste` sees a line matching `={3,}` that contains an `=== … ===`-style word that ISN'T `chapter` (e.g., `=== END ===`, `=== INTERLUDE ===`), it emits a warning: `"Saw === word === but did not split into chapters; did you mean === CHAPTER ===?"` This catches user typos before they ship a merged-chapter EPUB. The warning surfaces in the dialog's warnings panel.

`splitChapterChunks` is a literal regex split — it does NOT run cleanup. Order of operations is encoded in the function contract (and asserted by a test): pre-split → per-chunk cleanup. The cleanup module has no Node-only deps and is safe to import from both client (preview) and server (route); do not introduce any Node-only deps in this change.

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

If the user provides an explicit `title` in the request body, it applies only to the **first** chapter; subsequent chapters use their inferred titles. The dialog's "Chapter title" input remains a single field — its label updates from `"Chapter title"` to `"Chapter title (first chapter)"` once a chapter break is detected. **The typed value is preserved across this label change** — no clearing on N=1↔N>1 transitions. Users who started typing a title before inserting a break get to keep what they typed.

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

### Response body — breaking shape change

Before:

```ts
{ ok: true, data: { chapter: Chapter, warnings: string[] } }
```

After:

```ts
{ ok: true, data: { chapters: Chapter[], warnings: string[][] } }
```

`warnings[i]` is the cleanup warning list for `chapters[i]`. Always an array (length 1 in the single-chapter case).

**This IS a breaking change to the route's JSON envelope.** The only in-tree caller is `ImportChapterDialog.tsx`, updated in the same commit series. There are no external API consumers (this is a local-first app, single user). Route tests are updated in the same commit series to assert the new envelope.

The dialog's `onImported` callback signature changes from `(chapter: Chapter) => void` to `(chapters: Chapter[]) => void`. The only caller (`ChapterList.tsx`'s `onImported={() => { void mutate(); }}`) discards the argument, so the signature change is in-tree-safe.

### Error handling

Empty-chunk handling is uniform: empty / whitespace-only chunks are dropped silently with no per-chunk warning. The user-facing signal is the resulting chapter count — they see N-1 chapters in the preview if they accidentally placed two markers back-to-back. No special warning text needed.

- Paste with markers at start or end (`=== CHAPTER ===\n\nReal prose` or vice versa) → leading/trailing empty chunks dropped silently. Result: one chapter from the prose. This is almost always the user's intent.
- Two markers back-to-back (`...\n=== CHAPTER ===\n\n=== CHAPTER ===\n...`) → middle empty chunk dropped silently. Result: chapters before and after, no third stub.
- A paste that is JUST chapter markers and whitespace (no prose anywhere) → returns 400, `"no prose detected after cleanup."`
- A non-empty chunk whose cleanup result has zero sections (rare — would require all-whitespace prose) → dropped silently. Same uniform rule.

The per-chapter `warnings` array reflects the chapters that were actually saved. No "phantom" warnings about dropped chunks.

## Recap opt-in interaction

When `generateRecap: true` is set on a multi-chapter paste, the dialog still **closes immediately on save** — matching today's UX. Recap calls fire **sequentially in the background** (one awaited at a time so we don't slam Grok with N concurrent requests). On completion of each, a quiet toast: `"Recap ready for chapter N."` On any failure, an error toast for that chapter only — sequencing continues for the remaining chapters.

The single-chapter case is identical to today: one fire-and-forget request, no sequencing logic engaged.

Implementation: `Promise` chain inside an unawaited async IIFE that runs after the dialog calls `onOpenChange(false)`. The dialog component unmounts but the in-flight requests survive — they're owned by the browser, not the React tree.

## Privacy

No change. Raw paste still travels only in the request body and is never persisted. The route still calls no external network. The privacy smoke test stays untouched.

## Testing

### Unit — cleanup module

Add tests for the new shared helper `splitChapterChunks(raw: string): string[]`:

- No marker → returns `[raw]`.
- Canonical `=== CHAPTER ===` → splits.
- Case-insensitive variants (`=== chapter ===`, `=== Chapter ===`, `===CHAPTER===`) → all split.
- Two markers → returns 3 chunks.
- Whitespace-only chunk between markers → still returned (route filters empties later).
- Marker at start or end of input → leading/trailing empty chunks returned (route filters).
- Lines containing `===` but not `chapter` (e.g. `=== END ===`) → NOT split.

Defense-in-depth test for `cleanPaste`:
- Raw input containing `=== CHAPTER ===` (intact) is NOT mangled into a `---` by the existing scene-break recognizer when `cleanPaste` runs after `splitChapterChunks` would have consumed it — i.e., if the route somehow misses the pre-split, the marker survives into the output rather than silently morphing into a scene break. This catches regressions where the order of operations gets flipped.

Test for the unmatched-`=== … ===` warning:
- Input containing `=== END ===` produces a warning string containing both `END` and a hint about `=== CHAPTER ===`. No false positive on plain `===` (which has no surrounding word).

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
