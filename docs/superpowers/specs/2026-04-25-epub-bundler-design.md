# EPUB Bundler — Design

**Status:** Draft
**Date:** 2026-04-25

## Goal

Allow combining multiple existing stories into a single EPUB ("omnibus" / "box set") with clear visual breaks between stories, an editable assembly, and a TOC outline preview before export. Output is the same dual EPUB2/EPUB3 the single-story export already produces.

## Non-goals

- Per-chapter inclusion/exclusion within a story (all-or-nothing per story in v1).
- Renaming a bundle's slug after creation.
- Per-bundle override of the author-note message (bundles use the pen-name profile's `defaultMessageHtml`; no `Bundle.authorNote.messageHtml` override field in v1).
- Per-story author notes interleaved between stories (the bundle appends ONE author note at the end, not N).
- Nested two-level TOC (story → chapters as a hierarchy in `nav.xhtml` / `toc.ncx`).
- Bundles of bundles.
- Generation-time work — bundles are pure assembly of already-generated chapters; no calls to xAI.

## User-facing summary

A new top-level "Bundles" section sits alongside Stories. The user creates a bundle (slug, title), adds stories from a multi-select dialog, drags them into order, optionally overrides each story's display title and description for this bundle only, uploads a bundle cover, and exports. Each story in the resulting EPUB begins with a centered title page (story title + optional description), followed by its chapters, and a flat TOC lists each title page and chapter.

## Architecture decisions

1. **Bundle is a first-class persistent entity** — `data/bundles/<slug>/` parallels `data/stories/<slug>/`. The bundle references stories by slug; it does not snapshot them. Edits to a member story are reflected on the next bundle build.
2. **Synthetic chapter list, flat TOC** — the build pipeline produces an ordered `Array<{ title, content }>` and hands it to the same `epub-gen-memory` generator the single-story export uses. Title pages are inserted as synthetic entries between stories. No nested TOC; flat TOC works correctly across Calibre, Kindle, Apple Books.
3. **No inheritance from member stories** — bundle owns its own `title`, `authorPenName`, `description`, `language`, `cover`. Omnibus covers and metadata are typically distinct from individual-release SKUs; an inheritance-fallback model would create an awkward "is this the bundle's value or a shadow of the first story's?" state.
4. **Order + per-story overrides only** — bundle has explicit story order, and each story-ref carries optional `titleOverride` / `descriptionOverride`. No chapter-level customization.
5. **TOC outline preview, not full inline render** — the editor's preview pane is a collapsible tree (bundle → stories → chapters). Clicking a node renders that piece using the existing `renderChapterPreviewHtml` and `EPUB_STYLESHEET`. A full scrolling render of an entire bundle is heavy and mostly redundant — readers find layout bugs in the actual EPUB.

## Data model

### Storage layout

```
data/bundles/<slug>/
  bundle.json
  cover.jpg          (optional; uploaded via /api/bundles/[slug]/cover)
  exports/
    bundle-v3.epub
    bundle-v2.epub
```

No `.last-payload.json`: bundles never talk to xAI, so the Privacy panel mirror has nothing to capture for them.

### Path helpers

Extend [lib/storage/paths.ts](../../lib/storage/paths.ts) with:

- `bundlesDir()` — root `data/bundles/`
- `bundleDir(slug)` — `data/bundles/<slug>/`
- `bundleFile(slug)` — `data/bundles/<slug>/bundle.json`
- `bundleCoverPath(slug)` — `data/bundles/<slug>/cover.jpg`
- `bundleEpubPath(slug, version: EpubVersion)` — `data/bundles/<slug>/exports/bundle-v{2,3}.epub`

Routes and helpers must use these — no path concatenation in route handlers.

### Storage module

New [lib/storage/bundles.ts](../../lib/storage/bundles.ts), parallel to [lib/storage/stories.ts](../../lib/storage/stories.ts). Pure disk I/O; no network. Functions:

- `listBundles(): Promise<BundleSummary[]>` — slug, title, story count, updatedAt
- `readBundle(slug): Promise<Bundle | null>`
- `writeBundle(slug, bundle): Promise<void>`
- `createBundle({ title }): Promise<Bundle>` — generates slug via existing `lib/slug.ts`, writes initial JSON
- `deleteBundle(slug): Promise<void>` — recursive remove of `data/bundles/<slug>/`

Same locking discipline as `lib/storage/stories.ts` (read-modify-write under a lock when needed).

### Types

Added to [lib/types.ts](../../lib/types.ts):

```ts
export type Bundle = {
  slug: string;
  title: string;
  authorPenName: string;
  description: string;
  language: string;          // "en" default
  createdAt: string;
  updatedAt: string;
  stories: BundleStoryRef[]; // ordered
};

export type BundleStoryRef = {
  storySlug: string;            // FK into data/stories/
  titleOverride?: string;       // shown on title page if set; else story.title
  descriptionOverride?: string; // shown on title page if set; else story.description (omitted if neither)
};

export type BundleSummary = {
  slug: string;
  title: string;
  storyCount: number;
  updatedAt: string;
};
```

### Stale-reference handling

A `BundleStoryRef` whose `storySlug` no longer exists in `data/stories/` is treated as a missing entry:

- The UI list shows the row with a "missing story" badge.
- The build pipeline drops the entry and emits a build-time warning (surfaced in the success envelope alongside EPUBcheck warnings).
- Deleting a story does **not** cascade-delete refs from bundles. The bundle owner decides whether to remove or replace.

**Write-time validation:** `POST /api/bundles` and `PATCH /api/bundles/[slug]` do **not** verify that referenced story slugs exist. Validation happens only at build time. This keeps the storage layer pure and matches the design that a story can disappear and reappear (e.g., user temporarily moves `data/stories/`) without breaking bundle JSON.

**`BundleSummary.storyCount`** counts **all refs**, including currently-missing ones. The UI separately badges missing rows so the user sees both the configured count and the currently-resolvable count.

## Build pipeline

New module [lib/publish/epub-bundle.ts](../../lib/publish/epub-bundle.ts), sibling to [lib/publish/epub.ts](../../lib/publish/epub.ts).

### Public surface

```ts
export type BundleEpubInput = {
  bundle: Bundle;
  stories: Map<string, { story: Story; chapters: Chapter[] }>; // resolved refs
  coverPath?: string;
  version?: EpubVersion; // 2 | 3, defaults to 3
};

export async function buildBundleEpubBytes(input: BundleEpubInput): Promise<Uint8Array>;
```

The route handler resolves refs (loads each story + chapters from disk via existing storage helpers, omits missing ones with a warning) before calling the builder. The builder is pure — takes resolved data, returns bytes — which keeps it directly testable.

### Assembly

```ts
const content: Array<{ title: string; content: string }> = [];
for (const ref of bundle.stories) {
  const resolved = stories.get(ref.storySlug);
  if (!resolved) continue;
  const displayTitle = ref.titleOverride ?? resolved.story.title;
  const displayDescription = ref.descriptionOverride ?? resolved.story.description;
  content.push({
    title: displayTitle,
    content: renderStoryTitlePageHtml(displayTitle, displayDescription),
  });
  resolved.chapters.forEach((chapter, idx) => {
    content.push({
      title: chapter.title || `Chapter ${idx + 1}`,
      content: stripPreviewWrapper(
        renderChapterPreviewHtml(chapter, { chapterNumber: idx + 1 }),
      ),
    });
  });
}
```

Then the same `epub-gen-memory` call shape as `buildEpubBytes` in [lib/publish/epub.ts](../../lib/publish/epub.ts), with bundle-level metadata (`title`, `author: authorPenName`, `description`, `lang`, `cover` via `pathToFileURL` — see Section "Privacy & gotchas"), `css: EPUB_STYLESHEET`, and the `version` arg.

### New helpers in `lib/publish/epub-preview.ts`

- `renderStoryTitlePageHtml(title: string, description?: string): string` — returns a `<section class="story-title-page">` with centered `<h1>` and optional `<p>` description block. The description block is rendered **only when the trimmed description is non-empty** — `Story.description` is typed `string` (not optional), so empty-string and whitespace-only must be treated as "absent" or the title page renders an empty paragraph.
- `stripPreviewWrapper(html: string): string` — pulls out the `<div class="epub-preview">` wrapper. Used by both the single-story builder and the bundle builder; replace the inline `.replace()` calls in `buildEpubBytes` with a call to this helper to dedupe. After this dedup, run the existing single-story EPUB tests to confirm parity.

`EPUB_STYLESHEET` gains a rule for `.story-title-page { page-break-before: always; text-align: center; }` and styling for the inner `<h1>` / `<p>` to give the title page a clean visual treatment in supporting readers.

### TOC

Flat. Each title page is its own TOC entry under the story's display title; chapters follow under their numeric or named titles. Readers render this as a tidy linear list.

### Validation

`validateEpub` from [lib/publish/epub.ts](../../lib/publish/epub.ts) is reused unchanged — same warning surfacing, same `@likecoin/epubcheck-ts`-currently-broken-under-Next-16 caveat applies (it returns warnings on success and a single `validator error: …` warning on throw).

## Author-note integration

The author-note end-page feature shipped on `main` in PR #5 (commit `5d18299`). Single-story exports look up `Config.penNameProfiles[story.authorPenName]`, call `resolveAuthorNote(story, profile)` to produce a `ResolvedAuthorNote | null`, and pass it to `buildEpubBytes`, which appends it as a final content entry titled "A note from the author" with QR-code post-processing via `externalizeDataPngImages`.

Bundles get the same treatment — **one author note at the end of the entire bundle**, resolved from `bundle.authorPenName`. Per-story interleaved notes were considered and rejected: in the common case all member stories share the same pen name, so per-story notes would repeat the same content N times.

### Resolution

A new helper in [lib/publish/author-note.ts](../../lib/publish/author-note.ts):

```ts
export function resolveBundleAuthorNote(
  profile: PenNameProfile | undefined,
): ResolvedAuthorNote | null;
```

Returns `null` when the profile is missing or has no usable content (empty `defaultMessageHtml`, no email, no mailing-list URL). Otherwise returns a `ResolvedAuthorNote` populated from the profile's defaults — bundles do not have a per-bundle message override in v1.

This is a separate function from `resolveAuthorNote(story, profile)` rather than refactoring it, because:
- The bundle path has no `Story.authorNote` override field equivalent.
- The single-story function's signature is already a public-ish surface used by the existing export route — easier to add a sibling than to broaden an existing one.

### Builder integration

`BundleEpubInput` gains an optional `authorNote?: ResolvedAuthorNote` field, mirroring `EpubInput`. The bundle builder appends the author-note entry **after all stories' content** using the same logic the single-story builder uses today.

To avoid duplicating the QR-image post-processing path, the relevant block in [lib/publish/epub.ts](../../lib/publish/epub.ts) is extracted into a shared exported helper (working name `appendAuthorNoteContent`) that:
1. Calls `buildAuthorNoteHtml(authorNote)`
2. Runs the result through `externalizeDataPngImages`
3. Pushes the resulting `{ title, content }` entry onto the caller-supplied content array
4. Pushes any temp PNG paths onto a caller-supplied cleanup array

Both builders call this helper inside their existing `try { … } finally { /* cleanup tempImagePaths */ }` block. `externalizeDataPngImages` is also exported from `epub.ts` so the bundle builder's cleanup `finally` works the same way.

### Export route

`/api/bundles/[slug]/export/epub` loads `Config.penNameProfiles[bundle.authorPenName]`, calls `resolveBundleAuthorNote(profile)`, and passes the result to `buildBundleEpubBytes`. Same QR-overflow guard the single-story route uses (catch-and-rethrow that surfaces "URL too long for QR" as a 400 instead of a 500).

### Privacy & egress

The egress test extension in Section "Privacy" already asserts `recorded === []` for the bundle export route. To exercise the author-note path, the test seeds a `penNameProfiles` entry under the bundle's `authorPenName` (with a `defaultMessageHtml` of any inline content) before calling the export — this confirms the QR/sanitize path runs end-to-end without making any `fetch` calls. `qrcode` is a pure-JS encoder; it does not network.

## API routes

All under [app/api/bundles/](../../app/api/bundles/). Each is a thin adapter following the existing pattern in [app/api/](../../app/api/): parse with `readJson` from [lib/api.ts](../../lib/api.ts), call storage or builder, return an `ApiResult<T>` envelope.

| Route | Method | Purpose |
|---|---|---|
| `/api/bundles` | `GET` | List all bundles. Returns `BundleSummary[]`. |
| `/api/bundles` | `POST` | Create. Body `{ title }`. Server generates slug. Returns `Bundle`. |
| `/api/bundles/[slug]` | `GET` | Read full `Bundle`. 404 if absent. |
| `/api/bundles/[slug]` | `PATCH` | Update fields (`title`, `authorPenName`, `description`, `language`, `stories`). `stories` is replaced wholesale. Missing-story refs are accepted (the user may want to fix them later). |
| `/api/bundles/[slug]` | `DELETE` | Recursive remove of `data/bundles/<slug>/`. |
| `/api/bundles/[slug]/cover` | `PUT` | Multipart upload, mirrors `/api/stories/[slug]/cover`. |
| `/api/bundles/[slug]/cover` | `DELETE` | Remove cover. |
| `/api/bundles/[slug]/preview` | `GET` | Returns `{ bundle: { title, authorPenName, description }, stories: Array<{ storySlug, displayTitle, titlePageHtml, chapters: Array<{ title, html }>, missing?: true }> }` for the TOC outline preview. The root `bundle` block is consumed only by the tree's root label — there is no bundle-level title page in the EPUB itself; bundle metadata lives in the EPUB's package metadata. |
| `/api/bundles/[slug]/export/epub?version=2\|3` | `POST` | Build, validate, write to `exports/`, return `{ path, bytes, warnings, version }`. Mirrors `/api/stories/[slug]/export/epub`. |

### Error envelopes

`ApiResult<T>` everywhere. Build endpoint surfaces both EPUBcheck warnings and missing-story-ref warnings in the success envelope. 404 only for the bundle itself missing.

## UI

### Navigation

Add "Bundles" to the existing top nav alongside "Stories" / "Settings". Mirrors the stories nav link.

### `app/bundles/page.tsx` — bundles list

Card per bundle: title, story count, last updated. "New bundle" button at the top. Clicking a card opens the editor at `/bundles/[slug]`. Empty state: "No bundles yet. Create one to combine stories into a single EPUB."

### `app/bundles/[slug]/page.tsx` — bundle editor

Two-column layout.

**Left column — bundle config + story list:**

- Bundle metadata fields (title, author pen name, description, language) using the same blur-to-save pattern as [components/publish/ExportPage.tsx](../../components/publish/ExportPage.tsx).
- Cover upload — same UI pattern as story cover in [components/publish/ExportPage.tsx](../../components/publish/ExportPage.tsx) (inline `<input type="file" ref>`, button-triggered, multipart PUT). Not a shared React component; just the same shape duplicated. Calls `/api/bundles/[slug]/cover`.
- Story list: ordered, drag-to-reorder. Each row shows the source story's title (or its `titleOverride`), a "missing story" badge if the slug doesn't resolve, an inline edit toggle for `titleOverride` / `descriptionOverride`, and a remove button.
- "Add story…" button opens a dialog listing all stories not already in the bundle, with multi-select.
- EPUB version toggle (3 / 2) and Build button — same component pattern as `ExportPage`'s `onToggleKeyDown` keyboard handling and `lastBuildByVersion` state.

**Right column — preview pane:**

- Collapsible tree: root = bundle title; children = each story (display title); each story's children = its chapters.
- Clicking a node renders that piece in-place using `/api/bundles/[slug]/preview` data — title page or chapter HTML, styled with `EPUB_STYLESHEET`.
- Updates reactively on PATCH success via SWR revalidation of the preview endpoint.

### Reuse and conventions

- Drag-reorder uses whatever the existing chapter-reorder UI uses on the story editor page; we will not introduce a new drag library. Implementation will verify the existing approach before coding.
- SWR for `/api/bundles/[slug]` and `/api/bundles/[slug]/preview` reads.
- No Zustand needed — there is no streaming or long-running concern; the build button uses plain component state. The generation-store invariant (only one generation at a time) does not apply: bundles do not call `/api/generate`.

### Edge cases

- Deleting a bundle from the editor returns to `/bundles`.
- Slug is set at creation, immutable thereafter (matches the stories model — implementation will verify and adjust if stories actually support rename).

## Privacy & gotchas

Privacy is a project pillar. The bundler must not loosen any of the existing enforcement mechanisms.

1. **Egress test extension** — every new route is added to [tests/privacy/no-external-egress.test.ts](../../tests/privacy/no-external-egress.test.ts), each exercised against a temp `SCRIPTR_DATA_DIR` and asserting `recorded === []`:
   - `GET/POST /api/bundles`
   - `GET/PATCH/DELETE /api/bundles/[slug]`
   - `PUT/DELETE /api/bundles/[slug]/cover`
   - `GET /api/bundles/[slug]/preview`
   - `POST /api/bundles/[slug]/export/epub` (both `version=2` and `version=3`)

   None of these are added to the exempt list. Bundle code never calls xAI.

2. **No new `connect-src` origins** in [next.config.ts](../../next.config.ts).

3. **Logger discipline** — bundle code uses `logger` from [lib/logger.ts](../../lib/logger.ts), never `console.*`.

4. **`scriptr/no-telemetry`** — already covered globally; no exceptions for bundle code.

5. **Cover path gotcha (carry-over)** — `epub-gen-memory` requires `file://` URLs for disk-resident covers. Bare absolute paths silently produce 0-byte covers that strict EPUBCheck validators reject. The bundler builder uses `pathToFileURL(coverPath).href`, same as `buildEpubBytes`.

## Testing

Following the codebase's split: Vitest for unit/integration; Playwright for e2e.

### Vitest

- `tests/lib/storage/bundles.test.ts` — round-trip read/write, list, slug collision behavior, delete recursive cleanup. Pattern matches `tests/lib/storage/stories.test.ts`.
- `tests/lib/publish/epub-bundle.test.ts` — build with: 1 story / 2 stories / story with title override / story with description override / missing story ref (build succeeds, omits the entry, returns warning) / story whose source has no description (title page omits the description block) / no cover. Asserts chapter count in resulting EPUB matches `Σ(stories.chapters) + N stories` (the title pages). Reuses whatever zip-inspection helper the existing EPUB tests use.
- `tests/api/bundles.test.ts` — handler-level tests, calling handlers directly without starting a server, same pattern as existing API tests. Covers all CRUD routes plus export.
- **Privacy test extension** as listed above.

### Playwright

One spec at `tests/e2e/bundles.spec.ts`: create two stories with one chapter each → create a bundle → add both stories → reorder → set a title override on one → build EPUB → verify the file lands in `data/bundles/<slug>/exports/`. Single happy path; edge cases stay in unit tests.

## Open questions

- Are there existing chapter-reorder UI utilities to reuse for the bundle's story list, or do we need a new pattern? (Implementation discovery, not blocking.)
- Does `lib/slug.ts` need any extension for bundle slugs, or is its existing API generic enough? (Implementation discovery.)

These are explicitly low-stakes — answers should fall out of the first hour of implementation.
