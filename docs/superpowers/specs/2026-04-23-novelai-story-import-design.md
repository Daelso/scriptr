# NovelAI `.story` Import — Design

**Status:** Draft
**Date:** 2026-04-23
**Author:** chase (via brainstorm)
**Scope:** Add wholesale import of NovelAI `.story` files into Scriptr, producing either a new story (title + tags + Bible + chapters) or new chapters appended to an existing story. Also introduces a user-authored `////` split marker honored by both the new `.story` importer and the existing paste-based chapter importer.

## Motivation

The user is actively writing in NovelAI alongside Scriptr. NovelAI's native export format is `.story` — a JSON envelope wrapping a base64-encoded MessagePack CRDT document. Getting that content into Scriptr today would mean manually copy-pasting prose and re-entering character/lore notes. Wholesale import removes that friction and makes Scriptr a viable downstream editor/publisher for NovelAI sessions.

## Non-goals

- Round-trip export (Scriptr → `.story`). One-way import only.
- Preserving NovelAI-specific settings (phrase bias, banned sequences, ephemeral context, user scripts, per-entry `contextConfig`, trigger keyword activation). These have no Scriptr analog and are silently dropped.
- Interpreting the CRDT `history` for time-travel / undo semantics. We take the current rendered state and drop history.
- Importing `.story` files with a `storyContainerVersion` other than `1`. If NovelAI ships a v2, we'll extend then.
- Mid-import editing of Bible fields. Proposed Bible is shown read-only; user edits in the regular Bible editor post-import.

## User-facing surface

Two entry points, each with its own dialog:

1. **Stories list page** ([app/page.tsx](../../../app/page.tsx)) — button "Import from NovelAI". Creates a new story from the file: title, description, tags, lorebook → Bible, prose → chapters.
2. **Story editor page** ([app/s/[slug]/page.tsx](../../../app/s/[slug]/page.tsx)) — menu item "Import chapters from .story". Appends the file's AI prose as new chapters on the current story. File's Bible/tags are ignored (with an on-screen note explaining that).

Both dialogs let the user edit chapter titles, body text, delete unwanted chapters, and merge a chapter into the next one before committing. No drag-reorder in v1 (YAGNI).

## Prose extraction decisions

NovelAI's `content.document` is a base64/msgpack CRDT op log where arbitrary-typed keys (floats, lists, long prose strings) appear throughout the decoded tree. Initial brainstorming proposed filtering by a `source` field (1 = user prompt, 2 = AI output) stored alongside each section, but investigation of the real sample file showed the document does not contain a tidy `{sectionId: {type,text,meta,source}}` map — prose appears both as dict *values* and as dict *keys* across multiple sub-maps, and source metadata is not co-located with text in a way that survives a robust schema-agnostic walk.

**Adopted approach (Approach 1 from the brainstorm): depth-first tree walk.** The decoder collects every string ≥ 60 characters from the decoded tree (values and dict keys alike), dedupes in order of first encounter, and applies a **filter list** of known-metadata strings to strip duplicates:

- `metadata.description`
- `metadata.textPreview`
- each `content.context[].text`
- each `content.lorebook.entries[].text`

These four sources of text leak into the CRDT as long dict keys; filtering them removes the obvious noise. What remains is the user's prose plus any prompt text that is long enough to clear the 60-char threshold. **Some user-prompt leakage is expected** — the user removes these in the import dialog's per-chapter body editor, which is already part of the design for the new-story path.

This trade-off was accepted over a deeper CRDT reverse-engineering effort (Approach 2 in the brainstorm) because the second approach is a multi-week investment for a one-way import.

## Chapter splitting — priority order

Per Q3 during brainstorming (user-confirmed Approach C: preview & assign with heuristic splits). First match wins:

1. **`////` marker** — any line matching `^\s*\/{4,}\s*$` is consumed and used as a split point. User authors this in NovelAI before exporting. This is the explicit, highest-confidence signal.
2. **Chapter headings** — regex `^\s*chapter\s+([ivxlcdm\d]+)(?:\s*[:\-—]\s*(.+))?\s*$` (case-insensitive). The match line becomes the split; any captured title (e.g., `"The Measurement"` from `"Chapter 1: The Measurement"`) pre-fills the chapter title.
3. **Horizontal rules (fallback)** — `^\s*[\*\-_]{3,}\s*$` with 3+ occurrences and no `////` / headings present. Weak signal; UI flags as `"scene breaks (verify)"`.
4. **No split** — single chapter.

The `////` marker is **also** added to [lib/publish/cleanup.ts](../../../lib/publish/cleanup.ts)'s `splitChapterChunks`, alongside the existing `=== CHAPTER ===` marker, so the authoring convention is portable across the paste importer too. Both markers trigger the same boundary logic.

Title inference for chapters without an explicit heading: first non-empty sentence, truncated to 60 chars, trailing punctuation stripped.

## Story + Bible mapping

Per Q4 (Approach A: auto-map, user edits afterward). The spec originally assumed custom Bible buckets, but the real Scriptr schema ([lib/types.ts](../../../lib/types.ts)) is:

```ts
type Story = { ..., description: string, keywords: string[], ... };
type Bible = {
  characters: Array<{ name: string; description: string; traits?: string }>;
  setting: string;
  pov: "first" | "second" | "third-limited" | "third-omniscient";
  tone: string;
  styleNotes: string;
  nsfwPreferences: string;
  styleOverrides?: StyleRules;
};
```

Mapping:

- **`Story.description`** ← `metadata.description` if non-empty, else `metadata.textPreview`.
- **`Story.keywords`** ← `metadata.tags`.
- **`Bible.characters`** ← lorebook entries classified as People:
  - `entry.category` matches `/person|character|people/i` → People.
  - No category → pronoun sniff (`he |she |they |his |her |their ` in first sentence of `entry.text`) → People.
  - Default fallback when ambiguous: People.
  - Each entry: `{ name: entry.displayName || entry.keys[0], description: entry.text }` (no `traits` — NovelAI doesn't have an equivalent).
- **`Bible.setting`** ← lorebook entries classified as Places, concatenated with one blank line between entries; each entry formatted as `"## <displayName>\n<entry.text>"`.
  - `entry.category` matches `/place|location|setting/i` → Places.
  - No category + location-cue sniff (`is a` + noun like `city|town|village|room|house|building|campus|dorm|forest` in first sentence) → Places.
  - If there are zero Place entries, `setting` is left empty (user fills in later).
- **`Bible.styleNotes`** ← `content.context[].text` entries joined with `\n\n---\n\n`. Captures Memory + Author's Note verbatim. NovelAI users often put character sheets in Memory; those will land here too. Users re-organize in the Bible editor post-import.
- **`Bible.pov`, `Bible.tone`, `Bible.nsfwPreferences`** ← defaults (`"third-limited"`, `""`, `""`). User fills in.

**Silently dropped:** `metadata.favorite`, `lorebook.{categories,order,settings}`, per-entry `contextConfig`, `ephemeralContext`, `phraseBiasGroups`, `bannedSequenceGroups`, `messageSettings`, `sideChats`, `userScripts`, `scriptStorage`, `contextDefaults`, `settingsDirty`, `didGenerate`, `isModified`, `hasDocument`, `isTA`.

### Proposed-bible shape passed to the UI

The parse endpoint returns a `ProposedWrite` shape that mirrors the actual storage targets so the UI can render directly:

```ts
type ProposedWrite = {
  story: { title: string; description: string; keywords: string[] };
  bible: Bible;           // ready-to-write
};
```

(Earlier draft called this `ProposedBible` with `{premise, people, places, notes}`. That shape is gone.)

## Architecture

```
UI:
  app/page.tsx (stories list)   ──▶  NewStoryFromNovelAIDialog
  app/s/[slug]/page.tsx         ──▶  AddChaptersFromNovelAIDialog

Both dialogs call the same server endpoints:
  POST /api/import/novelai/parse    — parses .story file, returns preview
  POST /api/import/novelai/commit   — writes story/chapters/bible to disk

Server:
  lib/novelai/
    decode.ts    — base64 + msgpack decode, tree walk, source filter
    split.ts     — //// marker, heading heuristics, chapter chunks
    map.ts       — context/lorebook → Bible fields
    types.ts     — ParsedStory, ProposedChapter, ProposedWrite, SplitResult
  lib/publish/cleanup.ts (existing)
                 — extend splitChapterChunks to recognize //// as well
```

Additive only: no changes to existing routes, storage helpers, or `ImportChapterDialog`. Storage writes go through the helpers in [lib/storage/](../../../lib/storage/) — no hand-rolled paths.

## Parse pipeline (`lib/novelai/decode.ts`)

Input: `Buffer` of uploaded `.story` bytes.
Output:

```ts
type ParsedStory = {
  title: string;               // metadata.title
  description: string;         // metadata.description
  tags: string[];              // metadata.tags
  textPreview: string;         // metadata.textPreview
  contextBlocks: string[];     // content.context[].text
  lorebookEntries: Array<{
    displayName: string;
    text: string;
    keys: string[];
    category?: string;
  }>;
  prose: string;               // AI output, joined in document order
};
```

Steps:

1. `JSON.parse` outer envelope; reject unless `storyContainerVersion === 1`.
2. Read `metadata`, `content.context`, `content.lorebook` directly (plain JSON).
3. Base64-decode `content.document` to bytes; reject empty.
4. Feed bytes to `@msgpack/msgpack` `decodeMulti()` — returns a stream of top-level objects. msgpack `Map` objects (with non-string keys) are preserved as JS `Map`; `Object` maps decode to plain objects. Ext types decode to opaque `{type, data}` — we don't interpret them.
5. Build the **filter set**: `{metadata.description, metadata.textPreview, each context[].text, each lorebook.entries[].text}`, trimmed and empty-filtered.
6. **Walk every top-level object depth-first.** For each node:
   - `string` → if `length >= 60` AND not already seen AND not in the filter set, push to `segments` and mark as seen.
   - `Map` → visit each key and value.
   - plain object → visit each key (string) and value.
   - `Array` → visit each element.
   - primitive (number, boolean, null, undefined) or ext object → skip.
7. Join `segments` with `\n\n`. If the result is empty, throw `"No AI-generated prose found — did you import before running any AI turns?"`.

**Why this works:** on real NovelAI documents, the user's authored prose appears as long strings (≥60 chars) in multiple places in the tree (often as dict keys). The filter set removes metadata duplicates. A small amount of user-prompt leakage is accepted (see "Prose extraction decisions" above).

**Implementation order:** the plan's Task 1.6 is the high-risk step. The recommended sequence is (a) implement tree-walk against the synthetic fixture; (b) when tests are green, pass a real user-provided `.story` file through a one-off scratch script and visually inspect `prose.slice(0, 800)` — if obvious metadata leaks are present, widen the filter set; if prose is empty, loosen `MIN_PROSE_LEN` or check that real files decode as `Map` rather than plain object. Scratch file must not be committed.

### Parse-time errors (each returned as `{ok:false, error}`)

| Condition | Message |
|---|---|
| Invalid outer JSON | `"File is not a valid NovelAI .story file."` |
| Wrong `storyContainerVersion` | `"Unsupported NovelAI format version: got N, expected 1."` |
| msgpack decode throws | `"Could not read the document inside this .story file."` |
| Tree walk found no prose segments ≥60 chars | `"No AI-generated prose found — did you import before running any AI turns?"` |
| File > 10MB | `"File too large (limit 10MB)."` |
| Upload missing | `"No file uploaded."` |

## API routes

### `POST /api/import/novelai/parse`

`multipart/form-data` with field `file`. Returns:

```ts
type ParseOk = {
  ok: true;
  data: {
    parsed: ParsedStory;
    split: SplitResult;          // chapters + splitSource
    proposed: ProposedWrite;     // { story: {title,description,keywords}, bible }
  };
};
```

Implementation: read buffer, call `decodeNovelAIStory` → `splitProse` → `mapToProposedWrite`. Max file size check (10MB) runs before msgpack to avoid OOM on a pathological upload. Slug is **not** derived here; the commit endpoint's `createStory` handles slug derivation + collision suffixing via `uniqueSlug`.

### `POST /api/import/novelai/commit`

JSON body:

```ts
type CommitRequest =
  | { target: "new-story";
      story: { title: string; description: string; keywords: string[] };
      bible: Bible;
      chapters: ProposedChapter[];
    }
  | { target: "existing-story";
      slug: string;
      chapters: ProposedChapter[];
    };
```

Response:

```ts
type CommitOk = { ok: true; data: { slug: string; chapterIds: string[] } };
```

**New-story sequence:**

1. Call `createStory(dataDir, {title: story.title})` — slug is derived from title by the existing helper, which already handles collisions via `uniqueSlug` by suffixing (`-2`, `-3`, …). The user never picks a slug, matching the existing new-story UX elsewhere in the app.
2. Call `updateStory(dataDir, slug, {description, keywords})` to persist premise + tags.
3. Write `bible.json` via `fs.writeFile` on `bibleJson(dataDir, slug)` with the committed `Bible`.
4. For each chapter, call `createImportedChapter(dataDir, slug, {title, sectionContents:[body]})` — same helper the paste importer uses, which sets `source:"imported"` and auto-numbers the chapter file.
5. Return `{slug, chapterIds}` where `chapterIds` is each `createImportedChapter` return's `.id`.

**Existing-story sequence:**

1. `getStory(dataDir, slug)`; if null, return `{ok:false, error:"Story not found."}`.
2. For each chapter, call `createImportedChapter` (continues numbering naturally — that helper appends to `story.chapterOrder`).
3. Return `{slug, chapterIds}`.

**Atomicity:** new-story mode uses a try/catch; if any write fails after `createStory` succeeded, unlink the story dir with `deleteStory(dataDir, slug)` before returning the error. Existing-story mode writes chapter-by-chapter; mid-flight failure leaves earlier chapters written (recoverable, acceptable — same semantics as the paste importer).

Both routes use the `ApiResult<T>` envelope from [lib/api.ts](../../../lib/api.ts). No `suggestion` extension to the envelope is needed — slug collisions are handled server-side silently.

### Privacy

Both new routes are local-only (filesystem I/O; no outbound fetch). Added to the egress allowlist in [tests/privacy/no-external-egress.test.ts](../../../tests/privacy/no-external-egress.test.ts) — non-negotiable per [CLAUDE.md](../../../CLAUDE.md) Privacy section. The test stubs `global.fetch` and asserts `recorded === []` after each route exercise.

## UI — NewStoryFromNovelAIDialog

**File:** `components/import/NewStoryFromNovelAIDialog.tsx`

**Flow:**

1. **Pick file** — drop zone + file picker accepting `.story`. POST to `/api/import/novelai/parse`.
2. **Preview & edit** — three columns:
   - **Left (Story metadata):** editable `title`, `description`, `keywords` (comma-separated). Prefilled from `proposed.story`. No slug field — the server derives it.
   - **Center (Chapter list):** row per detected chapter with editable title, word count, split-source badge (`"////"`, `"Chapter heading"`, `"scene breaks (verify)"`). Expand to edit body in a textarea. Per-row actions: delete (removes from commit), merge-with-next (concatenates bodies).
   - **Right (Proposed Bible):** read-only preview of `characters[]`, `setting`, `styleNotes`. Footnote: *"Edit in the Bible editor after import."*
3. **Commit** — "Create story" button POSTs `target: "new-story"`. On success, toast (showing the final slug, which may have been auto-suffixed) + navigate to `/s/<slug>`.

**Error states:** parse failure shows the server error in a muted panel with a "Choose a different file" button that resets state.

**Visual style:** matches existing [components/publish/ImportChapterDialog.tsx](../../../components/publish/ImportChapterDialog.tsx) — same shadcn primitives, similar three-column grid.

## UI — AddChaptersFromNovelAIDialog

**File:** `components/import/AddChaptersFromNovelAIDialog.tsx`

**Flow:** same parse → preview → commit pattern, trimmed:

1. **Pick file** — POST to `/api/import/novelai/parse`.
2. **Preview & edit** — two columns:
   - **Left (Chapter list):** same as new-story dialog.
   - **Right (EPUB preview):** reuse `renderChapterPreviewHtml` + `EPUB_STYLESHEET` from [lib/publish/epub-preview.ts](../../../lib/publish/epub-preview.ts).
3. **Options row:** checkbox "Generate recap via Grok" (same behavior as paste dialog: recap generation runs **post-commit, per-chapter, sequentially**, via `/api/generate/recap` — already on the privacy egress-allowlist as an outbound route).
4. **Commit** — "Add N chapter(s)" POSTs `target: "existing-story"` with current slug. Success: toast, close dialog, SWR revalidates chapter list. Stay on the current page.

**Discarded-data affordance:** banner at top of preview: *"Description, lorebook, and tags from this .story file are ignored in this mode. Use 'Import from NovelAI' on the home page to import everything."*

**Why reuse the paste dialog's preview helper but not the component:** shared *output presentation* via the pure `renderChapterPreviewHtml` function; different *input handling* (file + parsed JSON vs. textarea + cleanup). Sharing the whole component would create conditional mess.

## Edge cases

- Empty NovelAI document → "No AI-generated prose found" error.
- Document with only source=1 segments → same.
- Split produces zero chapters (e.g., lone leading `////`) → fallback to one chapter with the raw prose. Never return 0 chapters.
- Lorebook entry with empty `displayName` and empty `keys` → dropped with debug log.
- Duplicate chapter titles after inference → allowed, user edits if they want.
- Non-UTF-8 bytes in prose → caught as generic decode error.
- Very long single chapter (100k+ words) → no hard cap; Scriptr already handles large chapter files.
- Rapid double-click on commit → button disabled while `saving` (matches `ImportChapterDialog`).
- User closes dialog after parse but before commit → nothing persisted; no cleanup needed.

## Testing strategy

**Unit — `tests/lib/novelai/`:**

- `decode.test.ts` — fixture-driven: happy path, each parse-time error condition.
- `split.test.ts` — table-driven: single `////`, multiple markers, chapter headings (digit + roman), heading vs. `////` priority (marker wins), horizontal-rule fallback, no-split, empty-chapter drop, title inference.
- `map.test.ts` — context → notes, lorebook → people/places partitioning via category, pronoun fallback, location-cue fallback, default fallback.

**API — `tests/api/import-novelai.test.ts`:**

- Parse happy path (multipart upload, preview in response).
- Commit new-story writes files via storage helpers (assert via file read).
- Commit existing-story writes chapters with correct numbering.
- Slug collision returns `{error, suggestion}`.
- Missing file / wrong version / oversize return expected errors.

**Privacy — [tests/privacy/no-external-egress.test.ts](../../../tests/privacy/no-external-egress.test.ts):** add both routes; assert `recorded === []`.

**Component — `tests/components/import/`:**

- `NewStoryFromNovelAIDialog.test.tsx` — mount, drop file, mock parse success, preview renders, commit payload reflects user edits, navigation toast on success. Error-path: mock parse 400 → error banner + reset button.
- `AddChaptersFromNovelAIDialog.test.tsx` — same shape + assert discarded-data note visible, commit payload has `target:"existing-story"` and omits bible/tags.

**E2E — [tests/e2e/](../../../tests/e2e/):** one happy-path Playwright test. Upload fixture on stories page → redirect to new story with chapters present. Uses existing `SCRIPTR_DATA_DIR=/tmp/scriptr-e2e` isolation.

**Fixture:** `lib/novelai/__fixtures__/sample.story` — a **synthetic** (not real-session) NovelAI export (~5KB). Hand-crafted using the container/msgpack schema with small neutral placeholder prose, 2 lorebook entries, and a `////` marker. Must not contain any real NovelAI session content from the user (privacy/IP — the user is an active NovelAI author).

**Definition of done:** `npm run lint`, `npm run typecheck`, `npm test`, `npm run e2e` all pass.

## Dependencies

- New: `@msgpack/msgpack` (well-maintained, no network, works in Node runtime). Added to `dependencies` in `package.json`.

## Files changed / created

**Created:**

- `lib/novelai/decode.ts`
- `lib/novelai/split.ts`
- `lib/novelai/map.ts`
- `lib/novelai/types.ts`
- `lib/novelai/__fixtures__/sample.story`
- `app/api/import/novelai/parse/route.ts`
- `app/api/import/novelai/commit/route.ts`
- `components/import/NewStoryFromNovelAIDialog.tsx`
- `components/import/AddChaptersFromNovelAIDialog.tsx`
- `tests/lib/novelai/decode.test.ts`
- `tests/lib/novelai/split.test.ts`
- `tests/lib/novelai/map.test.ts`
- `tests/api/import-novelai.test.ts`
- `tests/components/import/NewStoryFromNovelAIDialog.test.tsx`
- `tests/components/import/AddChaptersFromNovelAIDialog.test.tsx`
- `tests/e2e/novelai-import.spec.ts`

**Modified:**

- [lib/publish/cleanup.ts](../../../lib/publish/cleanup.ts) — extend `splitChapterChunks` to recognize `////`.
- [tests/privacy/no-external-egress.test.ts](../../../tests/privacy/no-external-egress.test.ts) — exercise both new routes.
- [app/page.tsx](../../../app/page.tsx) — add "Import from NovelAI" button.
- [app/s/[slug]/page.tsx](../../../app/s/[slug]/page.tsx) — add "Import chapters from .story" action.
- `package.json` — add `@msgpack/msgpack`.

## Rollout

Additive feature behind no flag. Ships on a single feature branch, merged to `main`. No migration, no data conversion. Existing stories untouched.
