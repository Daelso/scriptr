# NovelAI import: bracket-title extraction

**Date:** 2026-05-08
**Scope:** NovelAI import only (`/api/import/novelai/parse` and the lib/novelai split pipeline). Live generation, EPUB import, and manual paste are out of scope.

## Problem

NovelAI exports often place the chapter's title at the top of the chapter body in square brackets, on its own line:

```
[Chosen by the Goddess]

The morning light spilled across the temple floor...
```

Today, scriptr's NovelAI importer leaves that line in the body and leaves the chapter title empty (or set only from a `Chapter N: Title` heading, which the bracket-style files don't have). The user has to delete the bracket line by hand and retype the title in the import preview, for every chapter.

Goal: detect that line, lift the inner text into the chapter's `title`, and remove the line from the body — surfacing the result in the existing import preview so the user can edit before committing.

## Non-goals

- Lenient matching of `[...]` anywhere in the first paragraph. Risk of grabbing in-line bracketed editorial notes is too high.
- Bare title-cased / ALL-CAPS first-line detection. Authors disagree on convention; bracket form is unambiguous.
- Running this extraction on live generation output, EPUB imports, or freeform paste in the editor. The chosen scope is NovelAI import.
- Requiring every chapter to have a bracket title. Chapters without one fall through to the existing splitter behavior unchanged.

## Design

### New module: `lib/novelai/title-extract.ts`

A single pure function:

```ts
export type TitleExtractResult = { title: string | null; body: string };

export function extractBracketTitle(body: string): TitleExtractResult;
```

Behavior:

- Find the first non-blank line of `body`.
- If it matches `^\s*\[(.+?)\]\s*$` (strict: bracket spans the whole line, after trimming), capture the inner text, trim it, and:
  - If the trimmed inner text is empty, return `{ title: null, body }` (no change).
  - Otherwise return `{ title: <trimmed inner>, body: <body with the matched line + immediately following blank line(s) removed> }`.
- If the first non-blank line does not match, return `{ title: null, body }` (body unchanged — never mutate without a match).
- Handles `\r\n` line endings.
- Preserves leading blank lines that occur *after* the stripped block only if non-blank content followed (i.e. don't accidentally collapse interior whitespace; only strip the matched line and the run of blank lines immediately following it).

This is the only public surface of the module. No knobs, no options.

### Integration: `lib/novelai/split.ts`

In `splitChunkIntoChapters`, immediately before each `finalize(...)` return path, map every `ProposedChapter` through `extractBracketTitle`:

```ts
function applyBracketTitles(chapters: ProposedChapter[]): ProposedChapter[] {
  return chapters.map((c) => {
    const { title: bracket, body } = extractBracketTitle(c.body);
    if (!bracket) return c;
    return { title: bracket, body };
  });
}
```

When the bracket title is found, it **fully replaces** any existing title from the splitter (e.g. one captured from `Chapter 3: Moonrise`). Rationale: a bracket title is a deliberate authorial choice; a `Chapter N: Title` heading is a structural artifact. The user explicitly asked for bracket-wins.

The chapter-number prefix is already rendered automatically by every chapter-displaying surface from chapter order:

- EPUB body: [lib/publish/epub-preview.ts:146](../../lib/publish/epub-preview.ts#L146) emits `<h1>Chapter N</h1>` plus a separate `<p class="chapter-subtitle">{title}</p>` per chapter.
- EPUB TOC and per-chapter title metadata: [lib/publish/epub.ts:198](../../lib/publish/epub.ts#L198) and [lib/publish/epub-bundle.ts:69](../../lib/publish/epub-bundle.ts#L69) use `chapter.title || \`Chapter ${idx + 1}\``.

So storing the bracket text alone in `chapter.title` is correct: at order index 2 the EPUB will render `<h1>Chapter 3</h1>` with `Chosen by the Goddess` as the subtitle, and the TOC entry will read `Chosen by the Goddess`. No embedded chapter numbers in `title`, which keeps slugged filenames and EPUB nav clean.

### Ordering of post-processing steps

`applyBracketTitles` runs **after** the existing empty-chunk filters in each split path. Concretely, the new helper is the last transformation before `finalize(...)`:

```ts
// after the existing .filter((c) => c.body.length > 0 || c.title.length > 0)
const titled = applyBracketTitles(chapters);
return finalize(titled, "...");
```

Consequence: if a chapter's body is *only* a bracket line and nothing else, the body becomes empty after extraction but the chapter is **kept** (it has a non-empty `title`). The existing rule-split filter at [lib/novelai/split.ts:131](../../lib/novelai/split.ts#L131) drops chapters with empty body, but only runs *before* extraction, so a bracket-only chunk between two `***` rules would already have been dropped before extraction had a chance — meaning a bracket-only chunk in rule-split mode is silently lost today and continues to be lost. This is acceptable: a chunk with no prose isn't a real chapter. The unit and integration tests below cover this case explicitly so future readers don't get surprised.

`applyBracketTitles` runs in all three split paths (`splitByChapterHeading`, `splitByHorizontalRules`, single-chapter fallback) so a bracket-titled chapter is detected regardless of which split source the file matched.

### Multi-story files

The `////` story-split runs at the outer level and produces N chunks. Each chunk goes through `splitChunkIntoChapters` independently, so bracket extraction works per-story without any extra plumbing.

### UX

No new UI. The existing [components/import/ChapterEditList.tsx](../../components/import/ChapterEditList.tsx) already shows a `title` input + `body` textarea per chapter in the parse → commit preview. Extracted titles arrive pre-populated; bracket lines are already removed from the body. The user can correct, rename, or undo any extraction before clicking commit. If the heuristic mis-fires (e.g. a chapter whose first line is `[Author's note]` and isn't really a title), the user sees it and edits it before commit — no silent commits to disk.

The parse route ([app/api/import/novelai/parse/route.ts](../../app/api/import/novelai/parse/route.ts)) and commit route ([app/api/import/novelai/commit/route.ts](../../app/api/import/novelai/commit/route.ts)) require no changes — the post-processing is internal to `splitProseIntoStories`.

## Privacy

This is pure, local string parsing inside `lib/novelai/`. No new API routes, no new outbound traffic, no new ESLint allowlist entries needed. The egress test in [tests/privacy/no-external-egress.test.ts](../../tests/privacy/no-external-egress.test.ts) does not need extension.

## Testing

### Unit: `tests/lib/novelai/title-extract.test.ts` (new)

- Extracts when bracket is the first non-blank line at offset 0.
- Extracts when bracket is the first non-blank line preceded by blank lines.
- Strips the matched line *and* any blank lines immediately following it.
- Returns `{ title: null, body }` (no body change) when first non-blank line is prose, even if the prose contains a `[bracket]` later.
- Returns `{ title: null, body }` for `[]`, `[ ]`, `[\t]`.
- Trims whitespace inside the brackets: `[  Title  ]` → `Title`.
- Handles `\r\n` line endings.
- Does not match a multi-line bracket span (regex is per-line).
- Does not match if the bracket has trailing prose on the same line: `[Title] and the morning light...` is left alone.
- Bracket-only body (input is just `[Title]\n` with no prose after) returns `{ title: "Title", body: "" }`.

### Integration: `tests/lib/novelai/split.test.ts` (additions)

(File may not exist yet; add it if not, otherwise extend.)

- Heading-split + bracket-title combined: input has `Chapter 3: Moonrise\n\n[Chosen by the Goddess]\n\n...`. Resulting `ProposedChapter` has `title === "Chosen by the Goddess"` (bracket fully **replaced** the heading-derived "Moonrise" — assert this exact value, not a concatenation) and `body` has no heading line and no bracket line.
- Bracket-only chunk in single-chapter fallback: input is just `[Title]` with no other content. Result is one chapter with `title === "Title"`, `body === ""`.
- Rule-split + bracket-title: chapter delimited by `***` opens with `[Title]\n\n...`. Resulting title is extracted, body cleaned.
- Single-chapter fallback + bracket-title: no headings, no rules, just `[Title]\n\n<prose>`. Title extracted, body cleaned, `splitSource: "none"`.
- Multi-story file (`////` markers) where each story has its own `[Title]` first line: each story's chapter ends up with the right extracted title.
- No bracket present: existing splitter output is byte-identical to today (regression guard).

## Open questions

None blocking. If during implementation it turns out the existing fixture corpus in [lib/novelai/__fixtures__/](../../lib/novelai/__fixtures__/) lacks a bracket-title example, add a small synthetic one inline in the test file rather than committing a new fixture.

## Rollout

Single PR; no migration. Existing committed chapters are not retroactively re-extracted (that would mutate user data without consent and is out of scope). Only new imports run through the new path.
