# BISAC Searchable Select — Design Spec

**Date:** 2026-04-27
**Status:** Draft

## Problem

The EPUB export page exposes the BISAC subject category as a free-form text input ([components/publish/ExportPage.tsx:263-269](../../../components/publish/ExportPage.tsx#L263-L269)). The user must type a code like `FIC027000` from memory or look it up externally. This is error-prone and friction-heavy. We want a searchable dropdown backed by the full BISG subject heading list (~10,000 entries) so the user can search by code or by human-readable label.

## Non-goals

- **Multi-select.** KDP and Smashwords accept 2–3 BISAC codes per book, but the existing `Story.bisacCategory: string` schema is single-valued. Upgrading to multi-select is a separate, schema-changing concern and is deferred.
- **Auto-suggest from bible/keywords.** Out of scope.
- **A "fiction-only" filter toggle.** The full list is available; users who want fiction-only can type "fiction" or "fic".
- **Server-side search.** All filtering happens client-side against an in-memory list.

## Architecture

```
Build time (manual, on annual BISG update):
  scripts/data/bisac-source.csv  (committed)
        └── scripts/build-bisac-codes.ts (manual run)
              └── public/bisac-codes.json (committed)

Runtime (browser):
  ExportPage
    └── BisacCombobox (new component)
          ├── On first popover open: SWR fetch /bisac-codes.json
          ├── @base-ui/react/combobox primitive (already in deps)
          └── On select: calls onChange(code) → patch({bisacCategory: code})
```

**No backend changes.** The JSON is a static asset under `public/`, served by Next.js's built-in static file handler. No new API route, no new fetch destination — origin-relative request only.

**No storage/schema changes.** `Story.bisacCategory: string` continues to hold a single code. The data file `data/stories/<slug>/story.json` shape is unchanged.

**No telemetry / egress concerns.** The privacy egress test ([tests/privacy/no-external-egress.test.ts](../../../tests/privacy/no-external-egress.test.ts)) does not need changes — we are not adding an API route, and the static JSON fetch never leaves the origin. CSP headers in [next.config.ts](../../../next.config.ts) need no changes.

## Component design

### File: `components/publish/BisacCombobox.tsx`

**Props:**

```ts
type Props = {
  value: string;                  // current BISAC code (may be unknown to the list)
  onChange: (code: string) => void;
  disabled?: boolean;
};
```

**Primitive:** `@base-ui/react/combobox` — already a transitive dep used by [components/ui/select.tsx](../../../components/ui/select.tsx). Provides a controlled popover with listbox + filterable input, proper a11y, keyboard navigation, focus management.

**Trigger (collapsed):**

- Visually matches the existing `<Input>` (same `Input` className from `components/ui/input.tsx`) so the export page layout doesn't shift.
- Displays the formatted label of the currently-selected code: `FIC027000 — Fiction / Romance / Erotica`.
- If `value` is not in the loaded JSON (rare edge case — retired or non-standard code), shows the raw code in muted color and an inline hint: `not in current BISAC list`. The value is preserved (no auto-clear, no data loss).
- Clicking the trigger opens the popover.

**Popover (expanded):**

- Width matches or slightly exceeds the trigger.
- Top: a search input, autofocused on open.
- Below: a scrollable list rendered from the filtered + capped results (see "Filtering and performance").
- Each row: a single line in option-A format from brainstorming — `FIC027000 — Fiction / Romance / Erotica`.
- Empty-state row when no matches: `No BISAC codes match — try a different term.`
- Loading state on first open before JSON arrives: `Loading BISAC list…`. SWR caches it for the page session, so subsequent opens are instant.
- Keyboard:
  - Arrow up/down navigates highlight.
  - Enter selects the highlighted row.
  - Esc closes the popover.

**Save semantics:**

- Saves immediately on selection — calls `onChange(code)` synchronously, which the parent wires to `patch({ bisacCategory: code })`.
- Differs from the existing input's blur-save semantics, which is acceptable: net win is fewer "I edited but forgot to blur" mistakes.

### Wiring in ExportPage

Replace the existing block:

```tsx
<Field label="BISAC category">
  <Input
    type="text"
    defaultValue={draft.bisacCategory}
    onBlur={(e) => handleBlur("bisacCategory", e.target.value)}
  />
</Field>
```

with:

```tsx
<Field label="BISAC category">
  <BisacCombobox
    value={draft.bisacCategory}
    onChange={(code) => {
      if (draft.bisacCategory === code) return;
      void patch({ bisacCategory: code });
    }}
  />
</Field>
```

`handleBlur` cannot be reused as-is because the combobox doesn't blur-to-save; we call `patch` directly. The existing `patch` helper in `ExportPage.tsx` already updates `draft` on success and toasts on failure.

## Filtering and performance

**Filter rules** (case-insensitive throughout):

1. Trim and lowercase the query.
2. Split on whitespace into tokens.
3. An entry matches if **either**:
   - The first token is a prefix of the entry's code (lowercased), OR
   - **Every** token appears as a substring somewhere in the entry's lowercased label.
4. Examples:
   - `erotica` → matches `FIC027000` (label contains "erotica").
   - `fic027` → matches `FIC027000` (code prefix).
   - `romance erot` → matches `FIC027000` (both tokens in label).
   - `fic000 fiction` → matches `FIC000000` (code prefix on first token; label-token check uses other tokens). Implementation note: when the first token is a code prefix match, that single rule alone qualifies the entry — we do not also require the rest to match the label.

The exact precedence above keeps the rules predictable. A more sophisticated fuzzy matcher (Levenshtein, scoring) is YAGNI; substring + prefix is what users will actually type.

**Performance / capping:**

- After filtering, render at most the first 200 entries.
- If the filtered count exceeds 200, show a footer row: `200+ more — keep typing to narrow.`
- The unfiltered list (when the search input is empty) also caps at 200 — the user is expected to type before scrolling.
- **No virtualization library.** With the cap at 200, virtualization isn't needed. If profiling later shows jank we can drop in `@tanstack/react-virtual`, but we are not adding a dep upfront for a problem we don't have.

**Performance acceptance:** in Chrome devtools, opening the popover and typing one character should complete in <16ms (a single frame). If it doesn't, virtualize.

## Data file

### `public/bisac-codes.json`

Format — array of `{ c, l }` objects (short keys to keep size down):

```json
[
  { "c": "ANT000000", "l": "ANTIQUES & COLLECTIBLES / General" },
  { "c": "FIC000000", "l": "FICTION / General" },
  { "c": "FIC027000", "l": "FICTION / Romance / Erotica" }
]
```

- `c`: BISAC code, format `^[A-Z]{3}\d{6}$`.
- `l`: human-readable hierarchical label, top-level subject in ALL CAPS (matches BISG conventions), levels separated by ` / `.
- Sorted by code ascending — reproducible diffs when the source is updated.

**Estimated size:** ~400 KB raw, ~80 KB gzipped over the wire. Fetched once per page session; SWR caches it.

**Committed to git, not gitignored.** Annual updates will produce a clear, reviewable diff.

### `scripts/data/bisac-source.csv`

The raw source CSV from a public BISAC mirror, committed alongside the build script. The exact mirror URL is intentionally not locked in this spec — the implementer should select a reputable public source (e.g., a known open-source mirror) and document the provenance in a comment at the top of `scripts/build-bisac-codes.ts`. A reasonable default is one of the publicly maintained MIT-licensed BISAC datasets on GitHub; the implementer must confirm license compatibility before committing.

**Format expected:** two columns, `code,label`. The script must be tolerant of common CSV quirks (BOM, quoted labels containing commas, CRLF line endings).

### `scripts/build-bisac-codes.ts`

A standalone Node script (not part of `npm run build`). Reads `scripts/data/bisac-source.csv`, normalizes:

- Validates each row's code matches `^[A-Z]{3}\d{6}$`; invalid rows abort the script with an error pointing at the row number.
- Trims whitespace from labels.
- Deduplicates by code (last wins; warns on duplicates).
- Sorts ascending by code.
- Writes `public/bisac-codes.json`.

Run manually after pulling a new source CSV: `npx tsx scripts/build-bisac-codes.ts`. Documented in the script header.

## Testing

### New: `tests/components/publish/BisacCombobox.test.tsx` (jsdom)

Covers:

- Trigger renders the formatted label of the stored code.
- Trigger renders the raw code + "not in list" hint when the stored code is unknown.
- Clicking the trigger opens the popover; search input is autofocused.
- Typing a code prefix filters to the matching entry (`fic027` → `FIC027000`).
- Typing a single label token filters by substring (`erotica` → `FIC027000`).
- Typing multiple label tokens requires all to match (`romance erot` → `FIC027000`).
- An impossible query shows the empty-state row.
- Selecting a row calls `onChange` with the code.
- The 200-cap footer appears when the un-narrowed list exceeds 200.

The test mocks the `fetch` of `/bisac-codes.json` with a small fixture (~10 entries) — we don't need the real list to test the component.

### New: `tests/lib/bisac-codes.test.ts` (node)

Loads the real `public/bisac-codes.json` and asserts:

- Parses as valid JSON.
- Has more than 5,000 entries (sanity check that the full list is present).
- Every entry has both `c` (string) and `l` (string).
- All codes match `^[A-Z]{3}\d{6}$`.
- Codes are unique.
- Entries are sorted ascending by code.

This catches regressions if the build script outputs malformed data.

### Updated: `tests/components/publish/ExportPage.test.tsx`

The existing test that exercises the BISAC text input must be updated to drive the combobox instead — open the popover, search/select, assert the PATCH fires with the chosen code. Other assertions in this file remain unchanged.

### Untouched

- All fixtures using `bisacCategory: "FIC027000"` continue to work — schema is unchanged.
- The privacy egress test ([tests/privacy/no-external-egress.test.ts](../../../tests/privacy/no-external-egress.test.ts)) needs no changes — no new API route was added.

## Rollout

Single PR. No feature flag, no data migration. On first run after upgrade:

- Stored codes that exist in the loaded JSON: display normally as `CODE — Label`.
- Stored codes that don't: display verbatim with the "not in list" hint; the user can choose a real entry from the dropdown when they're ready.

## Open questions

None blocking implementation. The CSV source URL is a small choice the implementer can make and document in the script header.

## Deferred / future work

- Multi-select for the 2–3-codes-per-book convention used by KDP and Smashwords.
- Auto-suggest based on bible content, keywords, or genre.
- Annual update automation (a small CI job that detects when the source file changes and regenerates the JSON).
