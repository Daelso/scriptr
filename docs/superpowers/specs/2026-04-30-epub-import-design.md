# EPUB Import — Design

**Status:** Draft
**Date:** 2026-04-30
**Author:** chase (via brainstorm)
**Scope:** Add wholesale import of `.epub` files into Scriptr, producing a new story (title + description + keywords + cover + pen-name + chapters). Targets Scriptr-exported EPUBs (round-trip) and pro-tool exports (KDP, Smashwords, Draft2Digital, Vellum, Atticus). Hand-rolled / Calibre-converted EPUBs work on a best-effort basis.

## Motivation

The user has a back catalogue of previously-published books (KDP / Smashwords) they want to bundle using Scriptr's existing bundle feature. Today, recreating each book in Scriptr would mean copy-pasting prose chapter-by-chapter and re-uploading covers — prohibitively tedious for a 5–10 book bundle. Wholesale EPUB import removes that friction and turns Scriptr into a viable home for already-published work.

A secondary benefit: round-tripping Scriptr's own EPUB exports back into Scriptr (e.g., to pick up editing on a book whose source got lost or whose Scriptr data dir has drifted).

## Non-goals

- Round-trip export with full fidelity. Bible content, style overrides, BISAC categories, and pen-name profile data are not encoded in our EPUB exports today, so they cannot be recovered. Only what's actually in the EPUB is imported.
- Append-to-existing-story mode. Each EPUB becomes one new story. (NovelAI import already provides chapter-append; the EPUB use case — bundling whole published books — is purely new-story.)
- Bible derivation from prose. Empty Bible is written; user fills in if they want to generate continuations later.
- Cover crop / resize / aspect-ratio correction. Cover bytes are written through (re-encoded to JPEG if needed) without manipulation. Existing cover-upload UI handles replacement.
- Multi-file batch upload. Single-file flow used N times is fine for v1.
- DRM-protected EPUBs (Adobe ADEPT, Kindle KFX). Detected and rejected with a clear error.
- EPUBs with `<package version>` other than `2.x` or `3.x`. Anything else rejected.

## User-facing surface

One entry point on the stories list page ([app/page.tsx](../../../app/page.tsx)): button **"Import from EPUB"**, sitting next to the existing "Import from NovelAI" button. Opens `NewStoryFromEpubDialog`.

The dialog's three states:

1. **Pick file** — drop zone + file picker for `.epub`.
2. **Preview & edit** — two columns: story metadata + cover on the left; chapter list (with include/skip checkboxes) on the right.
3. **Error** — server error displayed; "Choose a different file" resets to state 1.

On commit success: toast `"Imported '<title>' (<N> chapters)"`, dialog closes, navigate to `/s/<slug>`.

## Architecture

```
UI:
  app/page.tsx (stories list)  ──▶  NewStoryFromEpubDialog

Dialog calls:
  POST /api/import/epub/parse    — multipart .epub → preview JSON
  POST /api/import/epub/commit   — preview + edits → write story to disk

Server:
  lib/epub/
    types.ts        — ParsedEpub, ChapterDraft, ProposedWrite
    unzip.ts        — jszip wrapper: file map + raw bytes by path
    opf.ts          — locate + parse content.opf
    nav.ts          — parse EPUB3 nav.xhtml or EPUB2 toc.ncx
    walk.ts         — nav-first chapter walker (anchor-aware)
    boilerplate.ts  — denylist of titles to default-skip
    cover.ts        — extract cover bytes + sniff mime
    cover-cache.ts  — in-memory cache between parse and commit
    map.ts          — ParsedEpub → ProposedWrite (story + empty bible)
```

Additive only: no changes to existing routes, storage helpers, or the NovelAI/paste importers. All disk writes go through helpers in [lib/storage/](../../../lib/storage/) — no hand-rolled paths.

## Approach decisions (recap)

The brainstorm resolved several forks. Key picks (with the rejected alternatives noted):

- **Boilerplate filter:** heuristic auto-skip with override (denylist regex on nav title; user toggles checkbox to include). Rejected: trust-the-spine (too tedious for 30-chapter books) and length-based (too risky for short prologues/interludes).
- **Metadata mapping:** full mapping with pen-name auto-match. Rejected: minimal/title-only (defeats the bundling use case).
- **Bible:** empty defaults only. Rejected: LLM-extracted Bible (out of scope, costs an API call) and styleNotes pre-fill from chapter 1 (creates noise the user has to delete).
- **Prose conversion:** XHTML → markdown via existing [lib/publish/html-to-markdown.ts](../../../lib/publish/html-to-markdown.ts). Rejected: plain-text (loses italics, which matter for fiction) and HTML allowlist (would require editor changes).
- **Chapter splitting:** nav-first walker with spine fallback if nav is missing. Rejected: spine-first (fails on Pattern Z — single XHTML with anchor-based chapters, common in older books).
- **EPUB parsing:** jszip + fast-xml-parser + cheerio (rolled by us). Rejected: `epub` / `epub2` npm packages (most pull jsdom transitively, breaking packaged Electron per [feedback_jsdom_esm_chain_in_electron.md](../../../../.claude/projects/-home-chase-projects-scriptr/memory/feedback_jsdom_esm_chain_in_electron.md)).
- **UI scope:** new-story only. Rejected: also add chapter-append-to-existing-story (the EPUB workflow doesn't fit append).
- **Cover handling:** auto-import with checkbox in preview (default on). Rejected: silent auto-import (user can't opt out per book) and crop UI (out of scope).

## Parse pipeline (`lib/epub/`)

**Input:** `Buffer` of uploaded `.epub` bytes (≤ 50 MB).
**Output:**

```ts
type ParsedEpub = {
  metadata: {
    title: string;
    creator: string;          // dc:creator (author display name)
    description: string;      // dc:description, HTML stripped
    subjects: string[];       // dc:subject[] (BISAC code or free-text)
    language: string;         // dc:language (info-only, not persisted)
  };
  cover: { mimeType: string; bytes: Uint8Array } | null;
  chapters: ChapterDraft[];   // post-walk, post-denylist (skippedByDefault flagged)
  epubVersion: 2 | 3;
};

type ChapterDraft = {
  navTitle: string;            // from nav <a> text or <h1> fallback
  body: string;                // markdown (htmlToMarkdown output)
  wordCount: number;
  sourceHref: string;          // for debugging / dedupe
  skippedByDefault: boolean;   // boilerplate denylist match
  skipReason?: string;         // e.g. "Matched 'copyright' rule"
};
```

**Steps:**

1. **`unzip.ts`** — `JSZip.loadAsync(buf)`. Build `Map<string, JSZipObject>` keyed by archive path.
2. **Find OPF** — read `META-INF/container.xml`, extract `rootfiles/rootfile[@full-path]`. That path is the OPF.
3. **`opf.ts`** — parse OPF with `fast-xml-parser`. Read:
   - `<package version="...">` → `epubVersion` (2 or 3). Reject other values.
   - `<metadata>` → title, creator, description, subjects, language. Title required, others may be empty.
   - `<manifest>` → `Map<id, {href, mediaType, properties?}>` with hrefs resolved relative to OPF dir.
   - `<spine>` → ordered `idref[]`.
   - **Cover lookup:** EPUB3 = manifest item with `properties="cover-image"`; EPUB2 = `<meta name="cover" content="<id>"/>` then look up that manifest id.
4. **`nav.ts`** — locate nav file:
   - **EPUB3:** manifest item with `properties="nav"`. Parse XHTML; walk `<nav epub:type="toc"> > ol > li > a`. Each `<a href>` becomes `NavEntry { title, href, anchor? }`.
   - **EPUB2:** spine has an NCX toc reference; parse `<navMap><navPoint><navLabel><text>` + `<content src>`.
   - Hrefs split on `#` into `{file, anchor?}`, resolved relative to nav file's dir.
   - Nested `<ol>` are flattened in document order (no hierarchy preserved — Scriptr chapters are flat).
5. **`walk.ts`** — for each `NavEntry` in nav order:
   - Load target XHTML through cheerio (`cheerio.load(xml, { xml: false })`).
   - **No anchor:** take the whole `<body>`, run through `htmlToMarkdown`.
   - **With anchor:** find element with that `id`. Take everything from that element up to (but not including) the next consecutive nav entry's anchor in the *same file*. Drives Pattern Z (one XHTML, multiple chapters).
   - **Spine fallback:** if nav is empty/missing, iterate spine items as if each were a single anchorless entry; chapter title = first `<h1>`/`<h2>` text or `"Chapter <N>"` if none.
   - Word count via `body.split(/\s+/).filter(Boolean).length`.
6. **`boilerplate.ts`** — set `skippedByDefault` + `skipReason` on each draft based on `navTitle` matching `/copyright|dedication|acknowledg|about the author|also by|table of contents|title page|other works|cover|halftitle|frontmatter|backmatter|imprint|colophon/i`. The match itself becomes the `skipReason` (e.g. `"Matched 'copyright' rule"`).
7. **Cover extraction** (`cover.ts`) — read raw bytes for cover manifest item. Sniff mime via magic bytes (don't trust the OPF's `mediaType`):
   - JPEG: `FF D8 FF`
   - PNG: `89 50 4E 47`
   - WebP: `52 49 46 46 ?? ?? ?? ?? 57 45 42 50`
   - Otherwise: `application/octet-stream`. Caller decides whether to use it (commit will skip transcode if unknown and write nothing).

**Parse-time errors** (each returned as `{ok:false, error}`):

| Condition | Message |
|---|---|
| Not a valid zip | `"File is not a valid EPUB (could not unzip)."` |
| Missing `META-INF/container.xml` | `"Missing container.xml — not an EPUB."` |
| Missing OPF (per container.xml's rootfile) | `"Could not find content.opf in this EPUB."` |
| `<package version>` not 2.x or 3.x | `"Unsupported EPUB version: got X, expected 2.x or 3.x."` |
| Missing/empty `<metadata><dc:title>` | `"This EPUB has no title in its metadata."` |
| Empty spine | `"This EPUB has no readable content (empty spine)."` |
| Walk produced 0 chapters with prose | `"No chapters with prose were found in this EPUB."` |
| File > 50 MB | `"File too large (limit 50MB)."` |
| Upload missing | `"No file uploaded."` |
| `META-INF/encryption.xml` present + non-font encryption | `"This EPUB is DRM-protected and cannot be imported."` |
| Chapter count > 200 | `"This EPUB has more than 200 chapters — please split it before importing."` |

The DRM check inspects `encryption.xml` for `<EncryptionMethod>` whose `Algorithm` is *not* the Adobe font-obfuscation algorithm — font obfuscation is not real DRM and shouldn't trigger rejection.

## Mapping (`lib/epub/map.ts`)

Converts `ParsedEpub` into a `ProposedWrite` the UI renders directly.

```ts
type ProposedWrite = {
  story: {
    title: string;
    description: string;
    keywords: string[];
    authorPenName: string;     // "" if no auto-match
  };
  bible: Bible;                // empty defaults — see below
  cover: { mimeType: string; bytes: Uint8Array } | null;
  chapters: ChapterDraft[];    // pass-through with skippedByDefault flags
  penNameMatch: "exact" | "case-insensitive" | "none";
};
```

**Story field rules:**

- `story.title` ← `metadata.title`, trimmed. (Already validated non-empty in parse step.)
- `story.description` ← `metadata.description`, run through `htmlToMarkdown` (publisher descriptions are often `<p>`-wrapped HTML), trimmed.
- `story.keywords` ← `metadata.subjects`. Each entry trimmed; empty entries dropped. BISAC codes (`"FIC027010"`) and free-text both pass verbatim — Scriptr's `keywords` field is free-form.
- `story.authorPenName` ← see pen-name match below.
- `cover` ← `parsedEpub.cover` passed straight through.

**Pen-name auto-match:**

1. Read pen-name profiles via `getConfig(dataDir)` → `config.penNameProfiles` (a `Record<string, PenNameProfile>` keyed by display name).
2. If `metadata.creator` matches a profile key exactly → `authorPenName = metadata.creator`, `penNameMatch = "exact"`.
3. Else if it matches case-insensitively → `authorPenName = <profile key (with profile's casing)>`, `penNameMatch = "case-insensitive"`.
4. Else → `authorPenName = ""`, `penNameMatch = "none"`.

The `penNameMatch` field lets the UI render an "auto-matched" badge for cases 1/2 vs a "pick one" prompt for case 3, without re-implementing matching logic on the client.

**Empty Bible defaults:**

```ts
{
  characters: [],
  setting: "",
  pov: "third-limited",
  tone: "",
  styleNotes: "",
  nsfwPreferences: "",
  // styleOverrides omitted (optional field)
}
```

Identical to a hand-created story's pre-edit `bible.json`.

**Boilerplate denylist as a display default:** `map.ts` doesn't filter chapters — it carries `skippedByDefault` through. The UI shows-or-hides them in the preview; the commit endpoint trusts the final list the UI sends. The denylist is a *display default*, not a hard filter.

## API routes

Both routes are local-only (filesystem I/O; no outbound fetch). Added to the privacy egress allowlist in [tests/privacy/no-external-egress.test.ts](../../../tests/privacy/no-external-egress.test.ts) — non-negotiable per [CLAUDE.md](../../../CLAUDE.md) Privacy section.

### `POST /api/import/epub/parse`

`multipart/form-data` with field `file`. Returns:

```ts
type ParseOk = {
  ok: true;
  data: {
    parsed: ParsedEpub;        // sans cover bytes
    proposed: ProposedWrite;   // sans cover bytes
    coverPreview: string | null; // data: URL of ≤300px-wide JPEG thumb
    sessionId: string;         // UUID for cover-cache lookup at commit
  };
};
```

**Why split cover bytes from `coverPreview`:** raw covers can be 2 MB+. The parse response holds only a small data: URL thumb; the raw bytes live server-side in a per-process cache keyed by `sessionId`. The commit endpoint references the cover by `sessionId`, avoiding a second multipart round-trip.

**`cover-cache.ts`:** in-memory `Map<sessionId, {bytes, mimeType, expiresAt}>`. 10-minute TTL, single-entry cap (overwriting on second parse). No persistence — if the user closes the tab and comes back, they re-upload. Acceptable for a single-user local app.

**Implementation:**

1. Read multipart body via `request.formData()`. Reject if no `file` field or > 50 MB.
2. Call `parseEpub(buffer)` → `ParsedEpub`.
3. Call `mapToProposedWrite(parsed, config)` → `ProposedWrite` (includes pen-name match against `config.penNameProfiles`).
4. If `cover` present: store bytes in cover-cache under fresh `sessionId`; encode max-300px-wide JPEG thumb via `sharp` for `coverPreview`.
5. Return the response.

### `POST /api/import/epub/commit`

JSON body:

```ts
type CommitRequest = {
  sessionId: string | null;       // null = no cover or user opted out
  story: {
    title: string;
    description: string;
    keywords: string[];
    authorPenName: string;
  };
  importCover: boolean;           // user's checkbox state
  chapters: Array<{
    title: string;
    body: string;
  }>;                             // user-edited final list, with skipped chapters already removed client-side
};
```

Bible isn't in the request — server uses defaults from the mapping section. Server is the source of truth for empty-bible shape.

Response:

```ts
type CommitOk = { ok: true; data: { slug: string; chapterIds: string[] } };
```

**Sequence:**

1. Validate `chapters.length >= 1` and each chapter has non-empty body. `{ok:false, error:"Need at least one chapter to import."}` otherwise.
2. `createStory(dataDir, { title: story.title, authorPenName: story.authorPenName })` — slug derived from title with collision suffixing by the existing helper.
3. `updateStory(dataDir, slug, { description, keywords })`.
4. Write `bible.json` via `fs.writeFile(bibleJson(dataDir, slug), JSON.stringify(<empty-bible-defaults>))`.
5. If `importCover && sessionId`: pull bytes from cover-cache. If mime is PNG/WebP, transcode to JPEG via `sharp` (existing pattern). Call `writeCoverJpeg(dataDir, slug, jpegBytes)`. Cover-cache entry deleted post-write.
6. For each chapter, `createImportedChapter(dataDir, slug, { title, sectionContents: [body] })` — `source: "imported"`, auto-numbered. Same helper paste/NovelAI use.
7. Return `{slug, chapterIds}`.

**Atomicity:** wrap steps 2–6 in try/catch. On failure post-step-2, call `deleteStory(dataDir, slug)` to roll back the partial story directory. Same pattern as NovelAI commit.

**Bad sessionId:** if `importCover: true` but the cache miss happens (e.g., 10-minute TTL elapsed), log a warning and continue without cover — better UX than blocking the import. The user can upload a cover after the fact.

Both routes use the `ApiResult<T>` envelope from [lib/api.ts](../../../lib/api.ts). No envelope extension needed.

## UI — `NewStoryFromEpubDialog`

**File:** `components/import/NewStoryFromEpubDialog.tsx`

Three states, switched on local `mode`:

### State 1 — Pick file

Drop zone + hidden file input accepting `.epub`. On drop or selection: disable picker, show spinner with "Reading EPUB…" caption, POST to `/api/import/epub/parse`. Success → State 2; failure → State 3.

### State 2 — Preview & edit

Two-column layout, matching `NewStoryFromNovelAIDialog`'s visual style.

**Left column — Story metadata + cover:**
- Cover thumbnail (~120px wide) at the top with checkbox below: `[x] Import cover from EPUB`. Unchecked → cover greys out. If parse returned no cover, the whole block is hidden.
- `title` input (prefilled).
- `description` textarea (prefilled, 4 rows).
- `keywords` input (comma-separated, prefilled).
- `PenNamePicker` (existing component). Below it, a small muted hint:
  - `penNameMatch === "exact"` → no hint.
  - `penNameMatch === "case-insensitive"` → *"Auto-matched to '<profile>'."*
  - `penNameMatch === "none"` → *"EPUB lists author as '<creator>' — pick a pen name or leave blank."*

**Right column — Chapter list:**

Above the list, a summary: *"<N> chapters detected. <M> excluded by default (copyright pages, etc.) — check to include."*

Per `ChapterDraft`, a row with:
- Leading checkbox (`includeChapter`); default = `!skippedByDefault`.
- Editable title input (prefilled with `navTitle`).
- Word count + a small badge:
  - `nav` (white) — came from nav.xhtml/toc.ncx.
  - `spine` (amber) — fallback case (no nav).
  - `skipped` (red, only when `skippedByDefault === true`) with `skipReason` on hover.
- Expand caret to reveal a textarea of the body markdown for inline edit.

No drag-reorder, no per-row delete (use the checkbox), no merge-with-next (YAGNI for v1).

**Actions row:**
- "Cancel" — closes dialog, drops state.
- "Create story" — primary; disabled until at least one chapter checkbox is checked. POSTs to `/api/import/epub/commit`. While in-flight: spinner + all inputs disable.
- On success: toast `"Imported '<title>' (<N> chapters)"`, close dialog, navigate to `/s/<slug>`.

### State 3 — Error

Single muted panel showing the server's error string + a "Choose a different file" button that resets to State 1.

### Component decomposition

`NewStoryFromEpubDialog.tsx` is the shell + state machine. Local sub-components:
- `EpubChapterRow` — pure per-chapter row.
- `EpubMetadataPanel` — pure left column.

Extract to `components/import/epub/` if either grows past ~80 lines.

## Edge cases

- Empty EPUB document → "No chapters with prose were found in this EPUB."
- DRM-protected EPUB → "This EPUB is DRM-protected and cannot be imported."
- EPUB with font-obfuscation only (Adobe font-mangling) → not treated as DRM; proceeds normally.
- EPUB with neither nav.xhtml nor toc.ncx → spine fallback (each spine item = chapter; title from `<h1>`).
- Single chapter (one nav entry / one spine item) → succeeds with 1 chapter; user can publish 1-chapter book if they want.
- Chapter title from nav contains HTML entities (`Caf&#233;`) → decoded by `htmlToMarkdown` path or `fast-xml-parser` entity decode.
- Pen-name profile name has internal whitespace (`"J. K. Rowling"`) — exact match still works (no normalization beyond case).
- Cover file referenced in OPF doesn't exist in zip → cover treated as `null`, no error.
- Chapter body is empty after `htmlToMarkdown` (e.g., XHTML had only `<img>` tags) → row still shown, marked `skippedByDefault` with reason `"Empty chapter"`. User can include if they really want.
- Duplicate chapter titles after import → allowed, user edits if they want.
- User closes dialog after parse but before commit → cover-cache entry expires after 10 min; nothing else persisted.
- Rapid double-click on commit → button disabled while saving (matches existing import dialogs).
- EPUB with 500+ chapters → 200-chapter cap returns clear error pre-walk.

## Testing strategy

### Unit — `tests/lib/epub/`

- `unzip.test.ts` — happy path; not-a-zip throws; missing container.xml; missing OPF.
- `opf.test.ts` — EPUB3 parse; EPUB2 parse; cover via `cover-image` property; cover via `<meta name="cover">`; missing title; href resolution relative to OPF dir.
- `nav.test.ts` — EPUB3 nav.xhtml flat; EPUB3 nested `<ol>` flattened; EPUB2 toc.ncx; href anchor split; empty nav returns `[]`.
- `walk.test.ts` — Pattern X (1 spine = 1 chapter); Pattern Y (chapter split across two spine items); Pattern Z (one XHTML with anchors — verify slice-between); spine fallback when nav empty; chapter title from first `<h1>` in fallback mode; cheerio drops `<script>`/`<style>`.
- `boilerplate.test.ts` — table-driven: `Copyright`, `About the Author`, `Also by Jane Smith`, `Acknowledgments`, `Title Page` flagged; `Chapter 1`, `The Beginning`, `Prologue`, `Epilogue` not flagged. `skipReason` populated.
- `cover.test.ts` — JPEG/PNG/WebP magic-byte sniff; unknown bytes → `application/octet-stream`; missing cover manifest → `null`.
- `map.test.ts` — pen-name match exact / case-insensitive / none; description HTML stripped; subjects empty entries dropped; empty Bible defaults verbatim.

### API — `tests/api/import-epub.test.ts`

Same handlers-called-directly pattern as `tests/api/import-novelai.test.ts`:

- Parse happy path → preview JSON includes `proposed`, `coverPreview`, `sessionId`.
- Parse with no cover → `coverPreview: null`, `sessionId` still returned.
- Commit new-story writes `story.json`, `bible.json`, chapter files via storage helpers (assert by re-reading from disk).
- Commit with `importCover: true` writes `cover.jpg` (assert file exists + non-zero bytes).
- Commit with `importCover: true` but `sessionId: null` → no cover written, no error.
- Commit with `importCover: false` even when `sessionId` valid → no cover written.
- Commit with empty `chapters[]` → 400 with friendly message.
- Commit with bad `sessionId` (cache miss) → cover silently skipped, story still created, warning logged.
- File > 50 MB rejected; missing file rejected; DRM-encrypted EPUB rejected; non-EPUB zip rejected.
- Atomicity: simulate `createImportedChapter` failure → assert `deleteStory` called, no orphan dir.

### Privacy — [tests/privacy/no-external-egress.test.ts](../../../tests/privacy/no-external-egress.test.ts)

Add both routes; assert `recorded === []` after exercise.

### Component — `tests/components/import/`

- `NewStoryFromEpubDialog.test.tsx` (`// @vitest-environment jsdom`):
  - Drop zone accepts file, shows spinner, transitions to preview state.
  - Cover thumb renders when `coverPreview` present; hidden when null.
  - Pen-name picker prefilled correctly per `penNameMatch` case (mock `/api/settings`).
  - Skipped chapters' checkboxes default unchecked; non-skipped default checked.
  - Editing chapter title in row updates commit payload.
  - Unchecking all chapters disables "Create story" button.
  - Commit success → toast + navigation to `/s/<slug>`.
  - Parse error → error panel + reset button works.

### E2E — `tests/e2e/epub-import.spec.ts`

One Playwright happy path: open stories page → upload `__fixtures__/sample-kdp.epub` → verify preview renders with chapters + cover thumb → click "Create story" → assert redirect to `/s/<slug>` and chapter list visible. Uses existing `SCRIPTR_DATA_DIR=/tmp/scriptr-e2e` isolation.

### Fixtures — `lib/epub/__fixtures__/`

Three **synthetic** EPUBs (~10–20 KB each), generated by `scripts/build-epub-fixtures.ts` at test-fixture-build time so they're reproducible and reviewable as code (not committed binaries). Output gitignored from source side; CI runs the script in a `pretest` hook.

- `sample-kdp.epub` — EPUB3, nav.xhtml, 1 chapter per spine item, includes `cover-image` property, `Copyright`, `Title Page`, 3 real chapters, `About the Author`. Tests canonical happy path + boilerplate denylist.
- `sample-smashwords.epub` — EPUB2, toc.ncx, no `cover-image` property (uses `<meta name="cover">` pattern), 2 chapters. Tests EPUB2 path.
- `sample-anchors.epub` — EPUB3, single XHTML in spine with 3 in-page `<h1 id="...">` anchors, nav points to each anchor. Tests Pattern Z anchor-slicing.

Synthetic, not real session content — privacy/IP concern (the user is an active published author).

### Definition of done

`npm run lint`, `npm run typecheck`, `npm test`, `npm run e2e` all pass. Plus a manual smoke test: import 1 real published EPUB locally and confirm the bundle workflow (import → assemble bundle → export bundle EPUB) round-trips cleanly.

## Dependencies

**New:**
- `jszip` — read-only zip access. Well-maintained, no native deps, works in Node + Electron.
- `fast-xml-parser` — OPF + nav XML parsing. Tiny, no jsdom.
- `cheerio` — XHTML traversal for the chapter walker (anchor slicing). Pure JS, no jsdom.

**Reused:**
- `sharp` — cover thumbnail + PNG/WebP → JPEG transcode. Already a dependency.
- `htmlToMarkdown` from [lib/publish/html-to-markdown.ts](../../../lib/publish/html-to-markdown.ts).
- `createStory` / `updateStory` / `createImportedChapter` from [lib/storage/](../../../lib/storage/).
- `writeCoverJpeg` from [lib/publish/epub-storage.ts](../../../lib/publish/epub-storage.ts).
- `PenNamePicker` from [components/import/PenNamePicker.tsx](../../../components/import/PenNamePicker.tsx).
- `getConfig` for pen-name profiles.
- `bibleJson()` path helper from [lib/storage/paths.ts](../../../lib/storage/paths.ts).

**Avoided:**
- `epub` / `epub2` / `epub-parser` — most pull jsdom transitively, breaking packaged Electron per [feedback_jsdom_esm_chain_in_electron.md](../../../../.claude/projects/-home-chase-projects-scriptr/memory/feedback_jsdom_esm_chain_in_electron.md).
- `turndown` — would duplicate `htmlToMarkdown`; existing helper is better-tuned to fiction.

## Files changed / created

**Created:**

- `lib/epub/types.ts`
- `lib/epub/unzip.ts`
- `lib/epub/opf.ts`
- `lib/epub/nav.ts`
- `lib/epub/walk.ts`
- `lib/epub/boilerplate.ts`
- `lib/epub/cover.ts`
- `lib/epub/cover-cache.ts`
- `lib/epub/map.ts`
- `lib/epub/__fixtures__/.gitignore`
- `scripts/build-epub-fixtures.ts`
- `app/api/import/epub/parse/route.ts`
- `app/api/import/epub/commit/route.ts`
- `components/import/NewStoryFromEpubDialog.tsx`
- `tests/lib/epub/unzip.test.ts`
- `tests/lib/epub/opf.test.ts`
- `tests/lib/epub/nav.test.ts`
- `tests/lib/epub/walk.test.ts`
- `tests/lib/epub/boilerplate.test.ts`
- `tests/lib/epub/cover.test.ts`
- `tests/lib/epub/map.test.ts`
- `tests/api/import-epub.test.ts`
- `tests/components/import/NewStoryFromEpubDialog.test.tsx`
- `tests/e2e/epub-import.spec.ts`

**Modified:**

- [tests/privacy/no-external-egress.test.ts](../../../tests/privacy/no-external-egress.test.ts) — exercise both new routes.
- [app/page.tsx](../../../app/page.tsx) — add "Import from EPUB" button.
- `package.json` — add `jszip`, `fast-xml-parser`, `cheerio`; add `pretest` hook to run fixture builder.

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Real-world EPUBs have edge cases the fixtures miss (XHTML namespaces, MathML, Ruby) | Manual smoke test with a real user EPUB before merge. cheerio strips unknown tags safely; htmlToMarkdown only emits its allowlist. |
| Cover-cache memory leak if commit never called | 10-min TTL + single-entry cap means worst-case footprint is one EPUB's cover. |
| User uploads DRM EPUB by mistake | `META-INF/encryption.xml` non-font-obfuscation check returns clear error pre-decode. |
| `sharp` had a Windows-DLL bundling issue ([feedback_sharp_dll_tracing.md](../../../../.claude/projects/-home-chase-projects-scriptr/memory/feedback_sharp_dll_tracing.md)) | Already mitigated in `next.config.ts` (`outputFileTracingIncludes`). New code uses the same `sharp` import; nothing changes. |
| EPUB has 500+ chapters → preview UI lags | Soft cap at 200 with clear error if exceeded. Realistic fiction max is ~60. |
| Pen-name match is too aggressive (matches "J Smith" to "John Smith") | Match is exact-or-case-insensitive only — no fuzzy/substring. False positives require deliberate config. |

## Rollout

Additive feature behind no flag. Single feature branch, merged to `main`. No data migration. Existing stories untouched. No effect on the NovelAI importer, paste importer, or EPUB export.
