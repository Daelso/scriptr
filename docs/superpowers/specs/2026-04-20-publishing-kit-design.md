# scriptr — Publishing Kit v1 Design Spec

**Date:** 2026-04-20
**Author:** Chase (with Claude)
**Status:** Draft

## Summary

Add an end-to-end paste-to-EPUB workflow so a user can take prose written in Grok's web UI, paste it into a scriptr story, clean it up to publishing-grade typography, and export a whole-book EPUB that is ready to upload to Amazon KDP or Smashwords.

The feature has two user-facing flows bound by a single EPUB renderer:

1. **Import** — a three-pane dialog (paste / cleanup toggles / live EPUB preview) that turns raw Grok output into a properly-structured `Chapter` and appends it to an existing story.
2. **Export** — a `/s/[slug]/export` page that collects book metadata, accepts a cover upload, and writes a validated `.epub` to `data/stories/<slug>/exports/`.

The import preview and the export build share the same renderer (`lib/publish/epub.ts`), so what the user sees during cleanup is exactly what ends up inside the book.

This supersedes the Publishing Kit section of `2026-04-19-scriptr-design.md` (§290–354) as the v1 ship. DOCX and PDF from the original spec are deferred to a v2 — Smashwords accepts EPUB2 and KDP accepts EPUB3, so EPUB alone covers both target storefronts via a version toggle at export time.

## Goals

1. Let the user paste a single chapter from Grok web UI and have it join a scriptr story as a first-class `Chapter`, with no manual cleanup on their part.
2. Apply conservative, well-known KDP / Smashwords style-guide transformations automatically, each individually toggleable, with warnings surfaced for anything stripped or changed.
3. Render the cleaned chapter in-browser with typography that matches the eventual EPUB output — no surprises between preview and export.
4. Produce a valid EPUB file — EPUB3 by default, or EPUB2 when the user is targeting Smashwords, selected via a toggle on the Export page — containing cover, title page, auto-generated TOC, and one XHTML per chapter, with `epubcheck-wasm` warnings surfaced but non-blocking.
5. Keep the privacy pillar intact: import, cover upload, and export all run entirely on the local machine. No new external network surface.
6. Ship without breaking existing stories, chapters, or config files (every new field optional, additive).

## Non-goals

- DOCX (Smashwords Meatgrinder) export — deferred to v2.
- PDF export for print — deferred to v2.
- Multi-chapter paste (one paste creates multiple chapters).
- Whole-manuscript import of an already-written book.
- Post-save re-running of cleanup on an imported chapter (the cleanup toggles are set-once at import time; redoing requires a fresh paste).
- Cover image editing or generation in-app.
- Auto-fix for `epubcheck-wasm` warnings — surfaced only, not rewritten.
- Style-rule application on imported prose (style rules apply to generation, not to prose already written elsewhere).

## Architecture

One new top-level surface (`lib/publish/`) with three modules: `cleanup.ts` (pure text pipeline), `epub.ts` (pure renderer — returns bytes and HTML), and `epub-storage.ts` (thin filesystem glue). Three new API routes, one new page (`/s/[slug]/export`), two new components (`ImportChapterDialog`, `ExportPage`). Zero Grok calls, zero new external dependencies beyond `epub-gen-memory` and `epubcheck-wasm`.

```
import flow:
  ImportChapterDialog
    → POST /api/stories/[slug]/chapters/import
       → lib/publish/cleanup.ts (cleanPaste)
       → writes new Chapter via lib/storage/chapters.ts

export flow:
  ExportPage
    → PUT /api/stories/[slug]/cover           (cover upload)
    → POST /api/stories/[slug]/export/epub    (build)
       → lib/publish/epub.ts (buildEpubBytes)
       → lib/publish/epub-storage.ts (writes to exports/)
       → epubcheck-wasm (validates)

shared:
  lib/publish/epub.ts exports renderChapterPreviewHtml,
  called live from ImportChapterDialog for the preview pane.
```

## Data model

### `Chapter` — one new optional field

```ts
// lib/types.ts
export type Chapter = {
  // ... existing fields unchanged ...
  source?: "generated" | "imported";
};
```

`source` is used only for (a) a small "imported" chip in the chapter list and (b) silently skipping auto-recap on imported chapters unless the user opts in during import. Undefined means "generated" (legacy chapters written before this feature existed).

**Downstream generation context.** Imported chapters participate in the existing generation context pipeline (recap chaining, optional last-chapter-full-text) exactly like generated chapters. If the user imports chapter 3 and then asks scriptr to generate chapter 4, the chapter 3 recap (if present) feeds into chapter 4's context just as it would for a natively-generated chapter. This is intentional — the user's goal is a cohesive book, and scriptr should treat the imported prose as authoritative prior context. Style rules for chapter 4 generation are not retroactively applied to chapter 3's prose, which is fine: style rules govern *new* output, not prior context.

### `Story` — no type changes

All publishing metadata already exists on `Story`: `title`, `subtitle`, `authorPenName`, `description`, `copyrightYear`, `language`, `bisacCategory`, `keywords`, `isbn`. The Export page just wires UI to fields already on disk.

### Cover image — on disk, no type reference

Stored at `data/stories/<slug>/cover.jpg` (or `.png`). Presence-on-disk is the signal; no reference stored in `story.json`. Server-side validation on upload: JPEG or PNG, ≥ 1600×2560 recommended (warn-on-smaller, don't reject), ≤ 10 MB. The renderer checks for the file and falls back to a generated title-card SVG if absent — export does not fail on missing cover.

### Raw paste — transient, never persisted

The raw text pasted in the import dialog travels as a request body to `POST /api/stories/[slug]/chapters/import`, is consumed by `cleanPaste`, and is discarded. Only the cleaned `Chapter` is persisted. This is an explicit privacy invariant: the route test asserts that no raw-paste fragment ever reaches the filesystem.

### Migrations

Zero. `Chapter.source?` is additive and optional. No new config keys. All new files live under `data/stories/<slug>/` which is already gitignored. Existing stories continue to load and save without modification.

## Cleanup pipeline

New module `lib/publish/cleanup.ts`:

```ts
export type CleanupStep =
  | "normalizeLineEndings"
  | "stripChatCruft"
  | "trimTrailingWhitespace"
  | "collapseInternalSpaces"
  | "normalizeQuotes"
  | "normalizeSceneBreaks"
  | "normalizeDashes"
  | "preserveMarkdownEmphasis"
  | "collapseBlankLines"
  | "splitIntoSections";

export type CleanupOptions = Partial<Record<CleanupStep, boolean>>;

export type CleanResult = {
  sections: string[];   // one entry per final Section.content
  warnings: string[];   // human-readable list of what changed
};

export function cleanPaste(raw: string, opts?: CleanupOptions): CleanResult;
```

All steps default to `true`. `opts` allows individual disabling via the UI toggles.

### Pipeline order (fixed; steps run in this order)

Order matters — specifically, `normalizeSceneBreaks` must run before `normalizeDashes` so that `---` (three hyphens, a common external scene-break marker and also scriptr's own internal marker) is normalized to the canonical form before `--` → `—` would consume its hyphens. `normalizeLineEndings` runs first so every subsequent step can treat `\n` as the sole paragraph / line separator.

1. **`normalizeLineEndings`** — CRLF / CR → LF. All subsequent steps assume LF.
2. **`stripChatCruft`** — remove leading / trailing lines that match chat-preamble / sign-off heuristics. Matchers are small and specific (documented in the Appendix). Warnings list each stripped line so the user can see what was removed. Over-stripping is the main regression risk — tests exercise novel-looking prose that happens to start with "Sure" or similar to ensure it isn't clobbered.
3. **`trimTrailingWhitespace`** — per line.
4. **`collapseInternalSpaces`** — runs of ≥ 2 spaces inside a paragraph → single space. Double-space-after-period is a subset.
5. **`normalizeQuotes`** — straight `"` / `'` → contextually-correct curly. Opening after whitespace or line start, closing otherwise. Apostrophes in contractions (e.g. `don't`, `he'd`) use the closing curly `'`. Already-curly quotes preserved.
6. **`normalizeSceneBreaks`** — lines matching `/^\s*(\*\s*\*\s*\*|\*\*\*|#|—{3,}|-{3,}|={3,})\s*$/` → scriptr's `---` marker. Runs of ≥ 3 consecutive blank lines also collapse to `---`. The `---` marker is the internal section-break convention already used by `lib/stream.ts`.
7. **`normalizeDashes`** — `--` (two hyphens) → `—` (em dash). Hyphens in compound words untouched. Already-em-dashes preserved. Runs *after* scene-break normalization so that `---` scene markers (already rewritten to scriptr's canonical `---` form in step 6) are still recognizable as whole-line matches and their hyphens survive — step 7's regex excludes lines that are exactly `---`.
8. **`preserveMarkdownEmphasis`** — when enabled (default), leaves `*italic*` / `**bold**` in `content` verbatim; the renderer transforms them at display time. When disabled, strips `*` and `**` pairs, keeping the text inside — so the toggle has an observable effect (the rendered prose loses emphasis). This is the only step whose on / off produces different text output but whose "on" behavior is a pure pass-through.
9. **`collapseBlankLines`** — runs of > 1 blank line (that weren't scene breaks — step 6 already consumed those) collapse to exactly one. Preserves paragraph-separator blank lines.
10. **`splitIntoSections`** — split on `---` markers (whole-line only). Each non-empty chunk becomes a string in `sections[]`. Leading / trailing `---` do not produce empty sections. The caller wraps each string into a `Section` with a fresh UUID.

### Idempotency

`cleanPaste(cleanPaste(x).sections.join("\n\n---\n\n")).sections` equals the first call's `sections`. Tested with a snapshot. This works because (a) step 6 recognizes `---` as a whole-line scene-break match and rewrites it to the same `---` form; (b) step 7 explicitly excludes lines that are exactly `---` from its `--` → `—` substitution; and (c) steps 5 and 8, when applied to already-normalized output, are no-ops.

### Warnings

Surfaced verbatim in the import dialog under the preview pane. Examples: `"Stripped 2 chat-preamble lines"`, `"Converted 14 straight quotes to curly"`, `"1 scene break normalized from '***'"`. Warnings are informational — the user cannot "undo" a rule from the UI; they disable its toggle and re-run the pipeline.

## EPUB renderer

New module `lib/publish/epub.ts`:

```ts
export type EpubInput = {
  story: Story;
  chapters: Chapter[];   // already ordered per story.chapterOrder
  coverPath?: string;    // absolute path to cover image on disk
  version?: 2 | 3;       // EPUB package version, defaults to 3
};

export type PreviewOpts = { chapterIndex?: number };

export async function buildEpubBytes(input: EpubInput): Promise<Uint8Array>;
export function renderChapterPreviewHtml(chapter: Chapter, opts?: PreviewOpts): string;
```

Library: **`epub-gen-memory`** (pure JS, no native deps). Validation: **`epubcheck-wasm`** in-process after build.

### Section-to-HTML transformer (shared by preview and build)

Pure function; unit-tested against golden outputs.

Algorithm, applied in order to each section's `content`:

1. Escape HTML entities in the raw text (`&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`). This guarantees any `<` / `>` emitted later by the transformer is the only HTML in the output.
2. Two-pass emphasis. First pass: replace `\*\*([^*\n]+?)\*\*` with `<strong>$1</strong>` (bold, non-greedy, no newline crossing). Second pass, on the result: replace `\*([^*\n]+?)\*` with `<em>$1</em>` (italic). Because the bold pass already consumed `**…**` boundaries and rewrote them to `<strong>…</strong>`, a nested `*italic*` inside a bold run is handled on the second pass. Literal asterisks need to be doubled in the source (`\*` is not supported as an escape in this subset — users writing asterisks in prose is rare; if it matters, they can delete the star in the import dialog's source pane).
3. Split on runs of one or more blank lines → wrap each paragraph in `<p>`. Single newlines within a paragraph are collapsed to spaces (EPUB-friendly; line breaks inside a paragraph are not meaningful).
4. Sections within a chapter join with a centered scene-break block: `<div class="scene-break">* * *</div>`.
5. Chapter opens with `<h1 class="chapter-title">Chapter {n}</h1>` followed by `<p class="chapter-subtitle">{chapter.title}</p>` if `chapter.title` is non-empty.

Snapshot tests pin the exact byte output for a small set of representative inputs (plain paragraph, paragraph with italic, paragraph with bold, nested italic-in-bold, HTML entity escaping, multi-section chapter).

### EPUB package structure (version-aware)

Archive layout is nearly identical across versions. What changes between EPUB2 and EPUB3 is the OPF `package` `version` attribute (`2.0` vs `3.0`), the TOC files shipped (`toc.ncx` only for EPUB2; both `toc.ncx` and `nav.xhtml` for EPUB3), and whether chapter XHTML is XHTML 1.1 (EPUB2) or XHTML5 (EPUB3). The shared section-to-HTML transformer output works for both; the renderer branches on `input.version` to wire up the correct manifest, spine, and TOC bits.

- `mimetype`, `META-INF/container.xml`, `OEBPS/content.opf`
- `cover.xhtml` + `cover.jpg`. If no cover uploaded, the renderer generates a 1600×2560 title-card SVG (solid background, centered title + author) and rasterizes it to JPEG via `sharp` (a transitive dep of Next.js 15 — verified present in `node_modules/next/package.json`) before packaging. Every EPUB ships with a real JPEG cover — Kindle ingestion pipelines can be finicky about SVG covers, so we avoid them entirely.
- Title page — title, subtitle, author, copyright line, ISBN if present
- Auto-generated TOC from the chapter list — `toc.ncx` (primary TOC for EPUB2, carried in EPUB3 for broad reader compatibility) plus `nav.xhtml` (EPUB3 primary TOC, omitted from EPUB2 builds)
- One XHTML per chapter, produced by the transformer
- Single `styles.css`: serif body, 1.5 line-height, justified paragraphs, 1.5em first-line indent, centered `.scene-break`, `page-break-before: always` on `h1.chapter-title`

### Library confirmation

Both `epub-gen-memory` and `epubcheck-wasm` are available on npm under permissive licenses and work on Node 20+. The implementation plan's first task verifies install + basic "build empty EPUB" happy-path **for both EPUB2 and EPUB3 output** before any UI work begins — specifically, whether `epub-gen-memory` exposes an EPUB2 mode on its options surface. If it does not, the plan falls back to a `jszip`-based hand-rolled EPUB2 writer (EPUB3 via `epub-gen-memory`) or goes fully hand-rolled for both, whichever is less code. If `epubcheck-wasm` is unexpectedly unavailable or broken, validation is skipped and the trade-off flagged; `epubcheck` itself validates EPUB2 and EPUB3, so the wasm wrapper should not need a version switch beyond pointing it at the right bytes.

### Preview coupling

`renderChapterPreviewHtml` calls the same transformer and renders inside a `<div>` scoped by the same CSS class names. The import dialog's preview pane imports the stylesheet directly from `lib/publish/epub.ts` so the CSS is a single source of truth — a change to either surface propagates to the other. The only visual difference is absence of pagination (the preview is a single scrollable column).

### Validation

After `buildEpubBytes` returns, the export route runs `epubcheck-wasm` on the bytes in-memory. Warnings are serialized into the route's response body as `{ warnings: string[] }`. The file is written regardless; warnings render under the last-build panel in the UI and do not block download.

## UI

### Import chapter — three-pane dialog

Entry point: new **Import chapter** button in `components/editor/ChapterList.tsx`, adjacent to the existing "New chapter" button. Opens a full-screen dialog (`components/publish/ImportChapterDialog.tsx`) with three panes:

- **Left pane — paste textarea.** Plain `<textarea>`, monospace 12–13px, height fills the dialog. Typing / pasting triggers debounced (150ms) cleanup + preview re-render.
- **Middle pane — cleanup toggles + metadata + action.** Six shadcn `Checkbox` controls wired to `CleanupOptions`. Below that: a "Warnings" list that repopulates on each preview. Below that: `Chapter title` text input (prefilled from the inferred title — first heading-like line such as `Chapter N:` / `Chapter N` / first short standalone line, editable). Below that: a "Generate recap via Grok" checkbox, default unchecked (privacy-first).
- **Right pane — EPUB preview.** Live render via `renderChapterPreviewHtml`. Word count + section count below the preview.

Dialog footer: **Cancel** (closes, discards) and **Save chapter** (POSTs, closes, appends the new chapter to the list).

### Export — dedicated page

Entry point: new **Export** link in the story-page nav, sibling of the existing **Read** link.

Route: `/s/[slug]/export` — thin server component (`app/s/[slug]/export/page.tsx`) fetches story + chapter list in parallel and delegates to `components/publish/ExportPage.tsx` (`"use client"`).

Two-column layout:

- **Left — metadata form.** Inputs for every field on `Story`: title, subtitle, author pen name, description (textarea), copyright year, language, ISBN, BISAC category (text input for now; dropdown v2), keywords (comma-separated, capped at 7). All fields autosave to `story.json` on blur via existing `PUT /api/stories/[slug]`.
- **Right — cover upload + build.** Drag-drop area (with file-picker fallback) posts to `PUT /api/stories/[slug]/cover`. Below it, an **EPUB version toggle** — segmented control with two options, "EPUB 3 · Kindle / KDP" and "EPUB 2 · Smashwords", default EPUB 3, transient per-session (no new field on `Story`). Below that, a Build EPUB button, a summary line ("N chapters · M words"), and — after a build — a last-build panel showing whichever of `<slug>-epub3.epub` and `<slug>-epub2.epub` exist on disk, each with byte size, download link, reveal-in-folder, and its own warnings list. Build button disabled if title / author / description empty or chapter list empty.

## API routes

Three new routes. All local-only; no egress.

### `POST /api/stories/[slug]/chapters/import`

Body: `{ raw: string; cleanupOptions?: CleanupOptions; title?: string; generateRecap?: boolean }`.

Behavior: runs `cleanPaste(raw, cleanupOptions)`, wraps each section string into a `Section` with a fresh UUID, builds a `Chapter` with `source: "imported"` and the provided `title` (or the inferred title if `title` absent — rules below), writes it via `lib/storage/chapters.ts`, appends its id to `story.chapterOrder`, returns `{ ok: true, data: Chapter }`.

**Recap integration.** The import route itself never calls Grok and never invokes the recap handler. Instead, on a successful POST response, if the user checked "Generate recap via Grok" in the dialog, the **client** (`ImportChapterDialog`) fires a follow-up `POST /api/generate/recap` with the new chapter's id. This keeps the import route entirely local: the only route that touches `api.x.ai` is the existing `/api/generate/recap`, which is already on the privacy-smoke exemption list. The route test for the import endpoint asserts that no outbound fetch ever originates from the handler.

**Title inference rules** (applied when `title` is absent from the request body), in priority order:

1. First line that matches `/^(?:chapter|ch\.?)\s+(\d+|[ivxlcdm]+)(?:\s*[:\-—.]\s*(.+))?$/i`. If capture group 2 is present, use it as the title; otherwise use `"Chapter {n}"` where `{n}` is the detected number.
2. First line whose length is between 3 and 60 characters and that is followed by a blank line (i.e. a standalone short line). Use that line verbatim.
3. Fallback: the first 60 characters of the first paragraph, truncated at the nearest word boundary, with `"…"` appended if truncation occurred.

**The raw paste is never written to disk.** The route test asserts this by stubbing the filesystem writer and checking that no call's payload contains a fragment of the raw paste.

**Paste size limit.** The handler reads the request body via `req.text()` and checks `body.length` against a 1 MB cap before parsing JSON. Next.js 15 App Router does not enforce body-size limits on route handlers by default, so the cap is explicit in the handler. Over-limit requests return 413 before any cleanup work runs.

### `PUT /api/stories/[slug]/cover`

Body: multipart file upload (one file, field name `cover`).

Behavior: server-side validation — MIME must be `image/jpeg` or `image/png`, bytes ≤ 10 MB. Writes to `data/stories/<slug>/cover.jpg` (converting PNG to JPEG server-side if needed; `sharp` is already a transitive dep via Next.js). Dimensions < 1600×2560 emit a warning in the response; the upload still succeeds.

### `POST /api/stories/[slug]/export/epub`

Body: `{ version?: 2 | 3 }` — defaults to `3`. The client sends whichever the Export page toggle is set to.

Behavior: loads story + all chapters + cover (if present), calls `buildEpubBytes` with the requested `version`, runs `epubcheck-wasm` on the bytes in memory, then writes the output to `data/stories/<slug>/exports/<slug>-epub{2|3}.epub` via write-to-temp-then-rename (sibling `.epub.tmp` → rename, per-version). Including the version in the filename lets EPUB2 and EPUB3 artifacts coexist, so a user dual-publishing to KDP and Smashwords does not have to rebuild the other version every time they touch the book. Re-builds are atomic per version: a failed or crashed build leaves the previous same-version `.epub` in place and does not touch the other version's file. Returns `{ ok: true, data: { path, bytes, version, warnings } }`. Validation warnings do not prevent the write.

## Privacy

The Publishing Kit runs entirely on the local machine.

- **Import** — raw paste is parsed server-side and discarded; only the cleaned `Chapter` persists. No egress.
- **Cover upload** — file travels to the server, lands on disk at `data/stories/<slug>/cover.jpg`. No egress.
- **Export** — renderer and `epubcheck-wasm` both run in-process. `.epub` file lands at `data/stories/<slug>/exports/<slug>.epub`. No egress.

The existing privacy smoke test (`tests/privacy/no-external-egress.test.ts`) continues to pass unchanged — the three new routes are local-only and do not need to be added to the exemption list.

If the user opts in to "Generate recap via Grok" during import, the existing `/api/generate/recap` route handles the egress exactly as it does for native-generated chapters. That route is already on the privacy-smoke exemption list; no change.

The README privacy section gains one sentence: "The Publishing Kit (import, export, cover) runs entirely on your machine. No paste, cover image, or exported file leaves your local filesystem."

The Privacy Panel on the Settings page is unchanged — it shows the last payload sent to Grok, and the Publishing Kit does not send payloads to Grok.

## Component breakdown

Each unit has one clear job and a stable interface.

- **`lib/publish/cleanup.ts`** — `cleanPaste(raw, opts)`, type exports. Pure functions, no I/O, no React. Depends only on standard-library string handling.
- **`lib/publish/epub.ts`** — `buildEpubBytes(input)`, `renderChapterPreviewHtml(chapter, opts)`, shared transformer, shared CSS. Pure — accepts in-memory inputs, returns bytes or HTML. Depends on `epub-gen-memory`. No filesystem I/O.
- **`lib/publish/epub-storage.ts`** — `writeEpub(slug, bytes): Promise<string>` and `readCover(slug): Promise<{path, mime} | null>`. Thin filesystem glue; the only place in the Publishing Kit that touches disk outside of the storage layer.
- **`lib/types.ts`** — add `source?: "generated" | "imported"` to `Chapter`. No other type changes.
- **`lib/storage/chapters.ts`** — accepts the new optional field on save; no new helpers needed (the existing writer serializes arbitrary additional fields).
- **`app/api/stories/[slug]/chapters/import/route.ts`** — POST handler; loads story, calls `cleanPaste`, builds a `Chapter`, appends to `chapterOrder`, writes, returns.
- **`app/api/stories/[slug]/cover/route.ts`** — PUT handler; multipart parse, validate, write JPEG.
- **`app/api/stories/[slug]/export/epub/route.ts`** — POST handler; calls `buildEpubBytes` + `writeEpub` + `epubcheck-wasm`, returns path + warnings.
- **`app/s/[slug]/export/page.tsx`** — thin server component; `Promise.all` fetch of story + chapters; delegates to `ExportPage`.
- **`components/publish/ImportChapterDialog.tsx`** — three-pane dialog, calls the import route on save, runs live cleanup + preview on every debounced edit.
- **`components/publish/ExportPage.tsx`** — metadata form + cover upload + build panel.
- **`components/editor/ChapterList.tsx`** — add the "Import chapter" button next to "New chapter". Minimal change.

The cleanup pipeline (`cleanPaste`), the renderer (`buildEpubBytes`/`renderChapterPreviewHtml`), and the three API routes are the four primary testable boundaries. UI components consume their outputs; they don't need separate renderer-level tests beyond hook behavior.

## Testing

### Unit — `lib/publish/cleanup.ts`

- Each pipeline step has at least one on / off test with golden input → output.
- Idempotency: `cleanPaste` applied twice equals applied once.
- `stripChatCruft`: known preamble / sign-off patterns matched; novel prose starting with the same words *not* stripped (regression guard).
- `normalizeQuotes`: straight → curly contextual; already-curly preserved; apostrophes in `don't` / `he'd` correct.
- `normalizeDashes`: `--` → `—`; hyphens in compound words left alone.
- `normalizeSceneBreaks`: `* * *`, `***`, `#`, `---`, `===`, and ≥ 3 blank lines all produce `---`.
- `splitIntoSections`: single `---` → two sections; leading / trailing `---` does not produce empty sections.

### Unit — `lib/publish/epub.ts`

- `renderChapterPreviewHtml`: HTML entities escaped before markdown transform; `*italic*` → `<em>`; `**bold**` → `<strong>`; scene breaks render as `.scene-break` div; chapter title wraps in `<h1 class="chapter-title">`.
- `buildEpubBytes`: produces a valid ZIP (checks magic bytes); archive contains `mimetype` + `META-INF/container.xml` + `OEBPS/content.opf`; chapter count matches input; missing `coverPath` falls back cleanly. Runs twice — once with `version: 3` (asserts OPF `version="3.0"` and presence of `nav.xhtml`), once with `version: 2` (asserts OPF `version="2.0"` and presence of `toc.ncx` as primary TOC with no `nav.xhtml`).

### Route tests

- `POST /api/stories/[slug]/chapters/import` — persists `Chapter` with `source: "imported"`; appends to `chapterOrder`; raw paste fragment absent from all filesystem writes; `generateRecap: true` triggers the recap route exactly once.
- `PUT /api/stories/[slug]/cover` — writes file; rejects non-JPEG/PNG; rejects > 10 MB; undersized image produces warning but succeeds.
- `POST /api/stories/[slug]/export/epub` — with `version: 3`, writes `exports/<slug>-epub3.epub` and returns `{ path, bytes, version: 3, warnings }`; with `version: 2`, writes `exports/<slug>-epub2.epub` and returns `{ path, bytes, version: 2, warnings }`; an empty / missing version in the body behaves as `version: 3`; back-to-back builds with different versions leave both files in place; re-builds of the same version are idempotent (overwrite).

### E2E — extend `tests/e2e/golden-path.spec.ts` (or add sibling spec)

Full flow: open a story, click Import chapter, paste fixture text, assert preview renders, save → new chapter appears → navigate to Export page → assert metadata prefilled → click Build EPUB → assert file appears at `data/stories/.../exports/`. No real `api.x.ai` traffic — existing canned-SSE stub covers the recap opt-out path.

### Privacy smoke — `tests/privacy/no-external-egress.test.ts`

No change required. The three new routes are fully local and do not need to be added to the exemption list — the smoke test must still pass with them active.

### Coverage targets

- Every cleanup step has at least one test of its transformation.
- `buildEpubBytes` + `renderChapterPreviewHtml` share transformer code; the transformer's HTML output is snapshot-tested.
- Each new route has a happy-path test and at least one failure test.

## Error handling

| Failure | Behavior |
|---------|----------|
| Paste is empty or whitespace-only | Import route returns 400; dialog shows "Paste something to import." |
| Paste is > 1 MB | Import route returns 413; dialog shows "Paste is too large — split into smaller chapters." |
| Cleanup produces zero sections | Import route returns 400; dialog shows "No prose detected after cleanup." |
| Cover image wrong MIME | Cover route returns 415 with the accepted types. |
| Cover image too large | Cover route returns 413 with the 10 MB limit. |
| Cover image under 1600×2560 | Cover route succeeds with a warning; UI renders the warning below the drop zone. |
| EPUB build fails (internal) | Export route returns 500 with the exception message; UI shows an error panel with a "Retry" button. |
| `epubcheck-wasm` emits warnings | File still written; warnings listed under the last-build panel; build count and byte size still render. |
| Missing cover at build time | Export succeeds with a generated title card (rasterized to JPEG via `sharp`); warning listed. |
| Re-build with no chapter changes | Succeeds; overwrites the existing `.epub` in place. No versioning. |

## Open questions resolved during brainstorm

| Question | Answer |
|---|---|
| Does this replace the Publishing Kit in the original design spec, or ship alongside it? | Supersedes the v1. DOCX + PDF deferred; the original spec section §290–354 is now historical. |
| Paste unit: one chapter, many chapters, whole book? | One chapter per paste. Multi-chapter and whole-book deferred. |
| Should the formatter follow a best-practice preset or expose every knob? | Opinionated defaults (the 10-step pipeline), each toggleable in the import dialog. |
| Preview targets: Kindle/EPUB, Smashwords DOCX, paperback PDF? | EPUB only, in two flavors. EPUB3 for KDP / Kindle; EPUB2 for Smashwords, which does not accept EPUB3. User picks via a toggle on the Export page; both artifacts can coexist under `exports/` with version-in-filename. |
| Support EPUB2, EPUB3, or both? | Both. Toggle on the Export page selects which to build; filename includes version (`<slug>-epub2.epub`, `<slug>-epub3.epub`) so both coexist. Decided 2026-04-21 after correcting the original spec's assumption that Smashwords accepted any direct EPUB. |
| Does imported-chapter prose go through scriptr's style rules? | No. Style rules apply to generation, not to prose already written. |
| Does import trigger auto-recap? | Opt-in; checkbox in the import dialog, default off. Honors privacy-first. |
| Where does the paste text get stored? | Nowhere. Server-side parse + discard. Only the cleaned chapter persists. |
| Preview vs export parity: same renderer or two? | Same renderer. `renderChapterPreviewHtml` and `buildEpubBytes` share the transformer and CSS. |
| Cover image metadata reference in `story.json`? | No. Presence of `data/stories/<slug>/cover.jpg` is the signal. |
| EPUB validation failure — block or warn? | Warn. File still written; warnings surfaced in the UI. |

## Appendix — cleanup step reference

### `stripChatCruft` matchers

Preamble — matches only the first non-empty paragraph of the paste:

- `/^(sure|here(?:'s| is)|okay|got it|alright|absolutely)[\s,:\-]/i`
- `/^(below|this is)\s+(?:the|a|your)\s+(?:chapter|scene|draft|version)/i`

Sign-off — matches only the last non-empty paragraph:

- `/^(let me know|hope (?:this|you)|happy to (?:revise|tweak|continue)|feel free to)/i`
- `/^(want me to (?:continue|revise|tweak)|shall i continue)/i`

Only the matched paragraph is stripped (not everything before or after it). Each strip records a warning with the first 50 characters of the removed text.

### `normalizeSceneBreaks` — recognized markers

All of these, on a line by themselves (with optional surrounding whitespace), convert to `---`:

- `* * *`
- `***`
- `#`
- `---` (three or more)
- `===` (three or more)
- `—` (three or more em-dashes)
- A run of 3 or more consecutive blank lines

### `normalizeQuotes` — rules

- Straight `"` after whitespace / line start / opening punctuation → `"` (opening).
- Straight `"` elsewhere → `"` (closing).
- Straight `'` in a letter-bracketed context (e.g. `don't`, `he'd`) → `'` (closing / apostrophe).
- Straight `'` after whitespace → `'` (opening).
- Straight `'` elsewhere → `'` (closing).
- Already-curly quotes (`"` `"` `'` `'`) preserved.

### Markdown emphasis subset (renderer, not cleanup)

Applied as two sequential regex passes on already-HTML-entity-escaped text:

1. `**text**` → `<strong>text</strong>` via `/\*\*([^*\n]+?)\*\*/g`.
2. Then on the result, `*text*` → `<em>text</em>` via `/\*([^*\n]+?)\*/g`.

Nested `*italic*` inside `**bold**` works because pass 1 rewrites the bold boundaries, leaving `*italic*` as the only asterisks on pass 2. Newlines inside emphasis are not supported (the regex refuses to cross line boundaries). Literal asterisks in prose are unsupported in this subset — users who truly need one can delete it in the import dialog's source pane before saving.

No other markdown syntax is interpreted. Headings, links, lists, code blocks all pass through as literal text.

### `preserveMarkdownEmphasis` step (cleanup pipeline step 8)

- **On (default):** no-op pass-through. `*italic*` and `**bold**` stay in `content`; the renderer handles them at display time.
- **Off:** strips `**` and `*` pairs but preserves the text inside. Regex passes: `/\*\*([^*\n]+?)\*\*/g` → `$1`, then `/\*([^*\n]+?)\*/g` → `$1`. Toggling this off is for users who want their pasted prose stored as pure plain text with no markdown at all.
