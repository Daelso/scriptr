# NovelAI bracket-title extraction implementation plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [docs/superpowers/specs/2026-05-08-novelai-bracket-title-extract-design.md](../specs/2026-05-08-novelai-bracket-title-extract-design.md)

**Goal:** When a NovelAI-imported chapter starts with a `[Title]` line on its own, lift the inner text into `chapter.title` and strip the line from the body, surfacing the result in the existing parse-preview UI without any new UI work.

**Architecture:** A pure helper `extractBracketTitle(body)` in a new module `lib/novelai/title-extract.ts`. A wrapper `applyBracketTitles` runs once per split path inside `lib/novelai/split.ts`, immediately before `finalize(...)`. No new API routes, no UI changes, no privacy-test changes. Bracket titles fully replace any heading-derived titles; chapter numbering is already auto-rendered everywhere from chapter order, so storing only the bracket text is correct.

**Tech Stack:** TypeScript, Vitest (`node` env, no jsdom needed). No new dependencies.

---

## File Structure

**Create:**
- `lib/novelai/title-extract.ts` — exports `extractBracketTitle(body: string) → { title: string | null; body: string }`. Pure function, no imports.
- `tests/lib/novelai/title-extract.test.ts` — unit tests for the helper.

**Modify:**
- `lib/novelai/split.ts` — import `extractBracketTitle`, add private `applyBracketTitles` wrapper, call it once at each `finalize(...)` site (three call sites: heading split, rule split, single-chapter fallback).
- `tests/lib/novelai/split.test.ts` — add a `describe` block exercising bracket extraction across all three split paths and through `////` story markers.

**Untouched (verified during spec review):**
- `app/api/import/novelai/parse/route.ts` and `commit/route.ts` — operate on `ProposedChapter[]`, no shape change.
- `components/import/ChapterEditList.tsx` — already shows `title` + `body` per chapter; extracted titles arrive pre-populated.
- `tests/privacy/no-external-egress.test.ts` — no new routes.

---

## Chunk 1: Pure helper + unit tests

### Task 1: Create the failing unit-test scaffolding for `extractBracketTitle`

**Files:**
- Create: `tests/lib/novelai/title-extract.test.ts`

- [ ] **Step 1: Write the failing test file**

Write `tests/lib/novelai/title-extract.test.ts` with the full suite below. The module under test does not exist yet, so the import will throw at test load time — that's the "failing" signal for this step.

```ts
import { describe, it, expect } from "vitest";
import { extractBracketTitle } from "@/lib/novelai/title-extract";

describe("extractBracketTitle", () => {
  it("extracts a bracket title that is the first line", () => {
    const r = extractBracketTitle("[Chosen by the Goddess]\n\nThe morning light...");
    expect(r.title).toBe("Chosen by the Goddess");
    expect(r.body).toBe("The morning light...");
  });

  it("extracts when bracket is preceded by blank lines", () => {
    const r = extractBracketTitle("\n\n[Title]\n\nbody");
    expect(r.title).toBe("Title");
    expect(r.body).toBe("body");
  });

  it("strips the matched line and any blank lines immediately following it", () => {
    const r = extractBracketTitle("[Title]\n\n\n\nbody starts here");
    expect(r.title).toBe("Title");
    expect(r.body).toBe("body starts here");
  });

  it("trims whitespace inside the brackets", () => {
    const r = extractBracketTitle("[  Padded Title  ]\n\nbody");
    expect(r.title).toBe("Padded Title");
    expect(r.body).toBe("body");
  });

  it("handles \\r\\n line endings (normalizes output to \\n)", () => {
    // The whole NovelAI splitter pipeline normalizes line endings to \n
    // (see splitProseIntoStories itself). This helper does the same: it
    // splits on /\r?\n/ and rejoins with "\n", so CRLF inputs come out
    // with LF endings.
    const r = extractBracketTitle("[Title]\r\n\r\nbody line one\r\nbody line two");
    expect(r.title).toBe("Title");
    expect(r.body).toBe("body line one\nbody line two");
  });

  it("returns null/unchanged when first non-blank line is prose", () => {
    const original = "The morning light spilled across [the temple floor].\n\nMore prose.";
    const r = extractBracketTitle(original);
    expect(r.title).toBeNull();
    expect(r.body).toBe(original);
  });

  it("returns null/unchanged for empty input", () => {
    const r = extractBracketTitle("");
    expect(r.title).toBeNull();
    expect(r.body).toBe("");
  });

  it("returns null for empty brackets []", () => {
    const original = "[]\n\nbody";
    const r = extractBracketTitle(original);
    expect(r.title).toBeNull();
    expect(r.body).toBe(original);
  });

  it("returns null for whitespace-only brackets [   ]", () => {
    const original = "[   ]\n\nbody";
    const r = extractBracketTitle(original);
    expect(r.title).toBeNull();
    expect(r.body).toBe(original);
  });

  it("returns null for tab-only brackets [\\t]", () => {
    const original = "[\t]\n\nbody";
    const r = extractBracketTitle(original);
    expect(r.title).toBeNull();
    expect(r.body).toBe(original);
  });

  it("does not match if the bracket has trailing prose on the same line", () => {
    const original = "[Title] and the morning light...\n\nbody";
    const r = extractBracketTitle(original);
    expect(r.title).toBeNull();
    expect(r.body).toBe(original);
  });

  it("does not match a multi-line bracket span", () => {
    const original = "[Line one\nLine two]\n\nbody";
    const r = extractBracketTitle(original);
    expect(r.title).toBeNull();
    expect(r.body).toBe(original);
  });

  it("returns body='' for bracket-only input with no following prose", () => {
    const r = extractBracketTitle("[Title]");
    expect(r.title).toBe("Title");
    expect(r.body).toBe("");
  });

  it("returns body='' for bracket-only input with trailing newline", () => {
    const r = extractBracketTitle("[Title]\n");
    expect(r.title).toBe("Title");
    expect(r.body).toBe("");
  });

  it("preserves interior blank lines (only strips blanks immediately after the matched line)", () => {
    const r = extractBracketTitle("[Title]\n\nfirst para\n\nsecond para");
    expect(r.title).toBe("Title");
    expect(r.body).toBe("first para\n\nsecond para");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail at module load**

Run: `npx vitest run tests/lib/novelai/title-extract.test.ts`
Expected: FAIL — error mentions cannot resolve `@/lib/novelai/title-extract` (module does not exist yet).

- [ ] **Step 3: Commit failing tests**

```bash
git add tests/lib/novelai/title-extract.test.ts
git commit -m "test(novelai): unit tests for extractBracketTitle (failing)"
```

---

### Task 2: Implement `extractBracketTitle`

**Files:**
- Create: `lib/novelai/title-extract.ts`

- [ ] **Step 1: Write the implementation**

Create `lib/novelai/title-extract.ts` with the following exact contents:

```ts
export type TitleExtractResult = { title: string | null; body: string };

const BRACKET_LINE = /^\s*\[(.+?)\]\s*$/;

/**
 * If the first non-blank line of `body` is a bare bracket-wrapped title
 * (e.g. `[Chosen by the Goddess]`), lift the inner text and strip that
 * line — plus any blank lines immediately following it — from the body.
 *
 * Strict: bracket must span the whole line after trimming. In-line
 * brackets, multi-line bracket spans, and brackets followed by prose on
 * the same line do not match.
 */
export function extractBracketTitle(body: string): TitleExtractResult {
  const lines = body.split(/\r?\n/);

  let firstNonBlank = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().length > 0) {
      firstNonBlank = i;
      break;
    }
  }
  if (firstNonBlank === -1) return { title: null, body };

  const match = lines[firstNonBlank].match(BRACKET_LINE);
  if (!match) return { title: null, body };

  const inner = match[1].trim();
  if (inner.length === 0) return { title: null, body };

  // Skip the matched line and any run of blank lines immediately after it.
  let nextContent = firstNonBlank + 1;
  while (nextContent < lines.length && lines[nextContent].trim().length === 0) {
    nextContent++;
  }

  // Splitting on /\r?\n/ consumes the \r as part of the delimiter, so
  // CRLF input comes back as LF after rejoining. This matches what the
  // surrounding splitter already does (see splitProseIntoStories), and
  // the importer normalizes line endings end-to-end.
  const remaining = lines.slice(nextContent).join("\n");

  return { title: inner, body: remaining };
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/lib/novelai/title-extract.test.ts`
Expected: PASS — all 15 tests green.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS, no errors.

- [ ] **Step 4: Run lint**

Run: `npm run lint`
Expected: PASS, no errors. (The `scriptr/no-telemetry` rule applies but the new file imports nothing.)

- [ ] **Step 5: Commit**

```bash
git add lib/novelai/title-extract.ts
git commit -m "feat(novelai): extractBracketTitle helper

Pure function that lifts a leading [Title] line into a chapter title and
strips it from the body. Strict: bracket must span the full line; empty
or multi-line brackets do not match."
```

---

## Chunk 2: Wire into `splitProseIntoStories`

### Task 3: Add failing integration tests for bracket extraction across split paths

**Files:**
- Modify: `tests/lib/novelai/split.test.ts` (append new `describe` block at the end)

- [ ] **Step 1: Append the new test block**

Append this `describe` block to `tests/lib/novelai/split.test.ts` (after the last existing block — do not edit existing tests):

```ts
describe("splitProseIntoStories — bracket-title extraction", () => {
  it("extracts a [bracket] title in the single-chapter fallback path", () => {
    const r = splitProseIntoStories("[Chosen by the Goddess]\n\nThe morning light spilled across the temple.");
    expect(r).toHaveLength(1);
    expect(r[0].splitSource).toBe("none");
    expect(r[0].chapters).toHaveLength(1);
    expect(r[0].chapters[0].title).toBe("Chosen by the Goddess");
    expect(r[0].chapters[0].body).toBe("The morning light spilled across the temple.");
    expect(r[0].chapters[0].body).not.toContain("[Chosen by the Goddess]");
  });

  it("extracts a [bracket] title in each chapter when split by horizontal rules", () => {
    const prose = [
      "[First Title]",
      "",
      "first chapter prose",
      "",
      "***",
      "",
      "[Second Title]",
      "",
      "second chapter prose",
    ].join("\n");
    const r = splitProseIntoStories(prose);
    expect(r).toHaveLength(1);
    expect(r[0].splitSource).toBe("scenebreak-fallback");
    expect(r[0].chapters).toHaveLength(2);
    expect(r[0].chapters[0].title).toBe("First Title");
    expect(r[0].chapters[0].body).toBe("first chapter prose");
    expect(r[0].chapters[1].title).toBe("Second Title");
    expect(r[0].chapters[1].body).toBe("second chapter prose");
  });

  it("bracket REPLACES heading-derived title when both are present", () => {
    const prose = [
      "Chapter 3: Moonrise",
      "",
      "[Chosen by the Goddess]",
      "",
      "The morning light spilled across the temple.",
    ].join("\n");
    const r = splitProseIntoStories(prose);
    expect(r).toHaveLength(1);
    expect(r[0].splitSource).toBe("heading");
    expect(r[0].chapters).toHaveLength(1);
    // Bracket fully replaces "Moonrise" — assert the exact value, not a
    // concatenation.
    expect(r[0].chapters[0].title).toBe("Chosen by the Goddess");
    expect(r[0].chapters[0].body).toBe("The morning light spilled across the temple.");
    expect(r[0].chapters[0].body).not.toContain("Chapter 3");
    expect(r[0].chapters[0].body).not.toContain("[Chosen by the Goddess]");
  });

  it("uses the bracket as the title when only Chapter N (no heading title) is present", () => {
    const prose = [
      "Chapter 5",
      "",
      "[Title From Bracket]",
      "",
      "body prose",
    ].join("\n");
    const r = splitProseIntoStories(prose);
    expect(r[0].chapters).toHaveLength(1);
    expect(r[0].chapters[0].title).toBe("Title From Bracket");
    expect(r[0].chapters[0].body).toBe("body prose");
  });

  it("each story in a multi-story //// file gets its own bracket title extracted", () => {
    const prose = [
      "[Story One Title]",
      "",
      "first body",
      "",
      "////",
      "",
      "[Story Two Title]",
      "",
      "second body",
    ].join("\n");
    const r = splitProseIntoStories(prose);
    expect(r).toHaveLength(2);
    expect(r[0].chapters[0].title).toBe("Story One Title");
    expect(r[0].chapters[0].body).toBe("first body");
    expect(r[1].chapters[0].title).toBe("Story Two Title");
    expect(r[1].chapters[0].body).toBe("second body");
  });

  it("leaves the chapter unchanged when no bracket title is present", () => {
    const prose = "The morning light spilled across [a temple].\n\nMore prose.";
    const r = splitProseIntoStories(prose);
    expect(r[0].chapters[0].title).toBe("");
    expect(r[0].chapters[0].body).toBe(prose);
  });

  it("keeps a bracket-only chunk in the single-chapter fallback (title set, body empty)", () => {
    // No headings, no rules, no /// markers. Bracket-only body.
    const r = splitProseIntoStories("[Title Only]");
    expect(r).toHaveLength(1);
    expect(r[0].splitSource).toBe("none");
    expect(r[0].chapters).toHaveLength(1);
    expect(r[0].chapters[0].title).toBe("Title Only");
    expect(r[0].chapters[0].body).toBe("");
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run tests/lib/novelai/split.test.ts -t "bracket-title extraction"`
Expected: FAIL — bracket lines are still in the body, titles are empty/heading-derived.

- [ ] **Step 3: Confirm existing split tests still pass (regression baseline)**

Run: `npx vitest run tests/lib/novelai/split.test.ts`
Expected: All pre-existing tests PASS; only the new "bracket-title extraction" describe block fails. This is the regression baseline — Task 4's changes must not break any previously-passing test.

- [ ] **Step 4: Commit failing integration tests**

```bash
git add tests/lib/novelai/split.test.ts
git commit -m "test(novelai): integration tests for bracket-title extraction (failing)"
```

---

### Task 4: Wire `extractBracketTitle` into `splitProseIntoStories`

**Files:**
- Modify: `lib/novelai/split.ts`

- [ ] **Step 1: Add the import**

At the top of `lib/novelai/split.ts`, add this import alongside the existing one:

```ts
import { extractBracketTitle } from "@/lib/novelai/title-extract";
```

- [ ] **Step 2: Add the `applyBracketTitles` helper**

Add this private helper somewhere in the file (suggested location: just above `function finalize(...)` near the bottom):

```ts
function applyBracketTitles(chapters: ProposedChapter[]): ProposedChapter[] {
  return chapters.map((c) => {
    const { title: bracket, body } = extractBracketTitle(c.body);
    if (!bracket) return c;
    return { title: bracket, body };
  });
}
```

- [ ] **Step 3: Wire into `splitByChapterHeading` (heading-split path)**

Find the `return finalize(...)` at the end of `splitByChapterHeading` (currently around lines 106-109):

```ts
  return finalize(
    chapters.filter((c) => c.body.length > 0 || c.title.length > 0),
    "heading"
  );
```

Replace with:

```ts
  return finalize(
    applyBracketTitles(
      chapters.filter((c) => c.body.length > 0 || c.title.length > 0)
    ),
    "heading"
  );
```

- [ ] **Step 4: Wire into `splitByHorizontalRules` (rule-split path)**

Find the end of `splitByHorizontalRules` (currently around lines 129-133):

```ts
  const chapters: ProposedChapter[] = chunks
    .map((c) => c.join("\n").trim())
    .filter((b) => b.length > 0)
    .map((body) => ({ title: "", body }));
  return finalize(chapters, "scenebreak-fallback");
```

Replace the final `return` with:

```ts
  return finalize(applyBracketTitles(chapters), "scenebreak-fallback");
```

(Per the spec, extraction runs **after** the empty-body filter. A bracket-only chunk between two rules is dropped before extraction sees it — this matches today's behavior where empty chunks are dropped, and is documented in the spec.)

- [ ] **Step 5: Wire into the single-chapter fallback path**

Find the fallback return inside `splitChunkIntoChapters` (currently around line 69):

```ts
  return finalize([{ title: "", body: chunkProse }], "none");
```

Replace with:

```ts
  return finalize(applyBracketTitles([{ title: "", body: chunkProse }]), "none");
```

- [ ] **Step 6: Run new integration tests to verify they pass**

Run: `npx vitest run tests/lib/novelai/split.test.ts -t "bracket-title extraction"`
Expected: PASS — all 7 new tests green.

- [ ] **Step 7: Run all split tests to verify no regressions**

Run: `npx vitest run tests/lib/novelai/split.test.ts`
Expected: PASS — all tests in the file (existing + new) green.

- [ ] **Step 8: Run the full novelai test directory**

Run: `npx vitest run tests/lib/novelai/`
Expected: PASS — `decode`, `map`, `pipeline`, `split`, `text-clean`, `title-extract` all green. This catches any unintended interaction with the pipeline test.

- [ ] **Step 9: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS — no type or lint errors. (`scriptr/no-telemetry` should be unaffected; only existing module imports are in play.)

- [ ] **Step 10: Commit**

```bash
git add lib/novelai/split.ts
git commit -m "feat(novelai): apply bracket-title extraction in all split paths

After splitting prose into chapters via heading, horizontal rule, or
single-chapter fallback, lift any leading [Title] line into the chapter
title and strip it from the body. Bracket title fully replaces any
heading-derived title."
```

---

## Chunk 3: End-to-end verification

### Task 5: Run the full project quality gates

**Files:** none (verification only)

- [ ] **Step 1: Run the full Vitest suite**

Run: `npm test`
Expected: All tests pass, including the privacy egress test (which is unaffected by these changes since no new API routes were added).

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 4: Sanity-check git status is clean**

Run: `git status`
Expected: "nothing to commit, working tree clean" (all task commits are in place).

- [ ] **Step 5: Skim the final commit log for the branch**

Run: `git log --oneline -10`
Expected: At minimum, the four feature commits from Tasks 1-4 are present and readable, in dependency order:

1. `test(novelai): unit tests for extractBracketTitle (failing)`
2. `feat(novelai): extractBracketTitle helper`
3. `test(novelai): integration tests for bracket-title extraction (failing)`
4. `feat(novelai): apply bracket-title extraction in all split paths`

---

## Out of scope (deferred / not in this plan)

Per the spec:

- Live generation, EPUB import, manual paste/typing in the editor — all unchanged.
- Lenient bracket matching (anywhere in first paragraph) — not added.
- Retroactive re-extraction of already-imported chapters — explicitly excluded; existing data is not mutated.
- New UI — the existing `ChapterEditList.tsx` preview already covers the user's editing needs.

If a future change broadens scope (e.g. adding extraction to the EPUB importer), the helper in `lib/novelai/title-extract.ts` is already pure and reusable — move it to a shared location like `lib/import/title-extract.ts` at that time, not now.
