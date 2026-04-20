# scriptr Publishing Kit v1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an end-to-end paste-to-EPUB workflow: a three-pane Import dialog that turns Grok web-UI paste into a first-class `Chapter`, and an Export page that builds a validated EPUB3 for the whole story — both driven by a single shared renderer so preview and export are byte-identical.

**Architecture:** Three new pure modules under `lib/publish/` (`cleanup.ts`, `epub.ts`, `epub-storage.ts`). Three new local-only API routes under `app/api/stories/[slug]/` (`chapters/import`, `cover`, `export/epub`). Two new React components under `components/publish/` (`ImportChapterDialog.tsx`, `ExportPage.tsx`). One new page at `app/s/[slug]/export/page.tsx`. Minor additive changes to [lib/types.ts](../../../lib/types.ts) (`Chapter.source?`), [lib/storage/paths.ts](../../../lib/storage/paths.ts) (cover + export paths), [lib/storage/chapters.ts](../../../lib/storage/chapters.ts) (new `createImportedChapter`), and [components/editor/ChapterList.tsx](../../../components/editor/ChapterList.tsx) (Import button + nav link to Export page). Zero new external egress.

**Tech Stack:** Next.js 16 (App Router), TypeScript, React 19, vitest, Playwright, shadcn/ui, SWR, Tailwind, plus three new runtime deps: `epub-gen-memory`, `isomorphic-dompurify`, `sharp`. `epubcheck-wasm` added as a dev dep.

**Reference spec:** [docs/superpowers/specs/2026-04-20-publishing-kit-design.md](../specs/2026-04-20-publishing-kit-design.md).

**Quality gates (run after every task unless the task's instructions say otherwise):**
- `npm run typecheck` — 0 errors.
- `npm run lint` — 0 errors.
- `npm test` — all green (tests added incrementally; green means no regressions on previously-passing tests).

At the end of every numbered task: commit. Small commits, frequent commits. Use `git add <specific files>`, never `git add -A` / `git add .`.

**Testing conventions** (established by the MVP Writer plan — follow these):
- Unit tests under `tests/lib/<module>.test.ts`; route tests under `tests/api/<route-name>.test.ts`.
- Route tests override the data dir via `process.env.SCRIPTR_DATA_DIR = await mkdtemp(…)` in `beforeEach` and restore in `afterEach`.
- Route tests import the handler directly (`const { POST } = await import("@/app/…/route")`) and call it with `ctx = { params: Promise.resolve({ slug }) }`.
- Integration tests that touch Grok mock `@/lib/grok`'s `getGrokClient` via `vi.mock`. The Publishing Kit does not call Grok, so this plan's route tests never mock Grok — but the E2E flow that opts into recap does, via the existing canned-SSE stub in [tests/e2e/golden-path.spec.ts](../../../tests/e2e/golden-path.spec.ts).
- ENOENT filesystem catches use `(err as NodeJS.ErrnoException).code === "ENOENT"`.

**Privacy pillar (non-negotiable):**
- No new routes call `fetch` to any external host. All three new routes read/write `data/` only.
- Raw paste travels only in the import request body; it is never written to disk. The import route test explicitly asserts this.
- The existing privacy smoke test (`tests/privacy/no-external-egress.test.ts`) must continue to pass without adding the new routes to the exemption list. If a route accidentally triggers egress, the smoke test fails — fix the route, don't loosen the test.

**Security — preview HTML rendering:**
- `renderChapterPreviewHtml` in `lib/publish/epub.ts` entity-escapes raw section text before emitting any tags, so the transformer itself cannot produce XSS. However the dialog still renders that HTML into the DOM via React, which is an injection surface by definition.
- Defense-in-depth: every place in the client that injects rendered HTML into the DOM routes the string through `isomorphic-dompurify`'s `sanitize()` first. Any future bug in the transformer that accidentally emits a `<script>` is caught by the sanitizer.
- Never introduce `dangerouslySetInnerHTML` without sanitizing. The plan wires sanitization from the first commit that adds the dialog; no un-sanitized injection is ever staged.

**Next.js App Router notes** (from AGENTS.md — read the docs in `node_modules/next/dist/docs/` if anything feels surprising):
- Dynamic-route params are a Promise: `async function POST(req, { params }) { const { slug } = await params; … }`.
- Route handlers do not auto-enforce a body-size limit. The import route explicitly checks `body.length` against 1 MB before parsing.
- Multipart uploads: use `await req.formData()` in the cover route.

---

## File structure

**New files** (all created by this plan):

| Path | Purpose |
|------|---------|
| `lib/publish/cleanup.ts` | Pure text-cleanup pipeline. `cleanPaste(raw, opts)` returns `{sections, warnings}`. Zero I/O, zero React. |
| `lib/publish/epub.ts` | Pure renderer. `buildEpubBytes(input)` returns bytes; `renderChapterPreviewHtml(chapter)` returns HTML. Shared transformer + CSS. |
| `lib/publish/epub-storage.ts` | Thin filesystem glue. `writeEpub`, `readCoverPath`, `writeCoverJpeg`, `ensureCoverOrFallback`. Only module in `lib/publish/` that touches disk. |
| `lib/publish/safe-html.tsx` | Tiny client helper. `<SafeHtml html={…} />` sanitizes via DOMPurify and renders. Single place that introduces an injection surface in the whole codebase. |
| `app/api/stories/[slug]/chapters/import/route.ts` | `POST` — parse body, run cleanup, create imported chapter. |
| `app/api/stories/[slug]/cover/route.ts` | `PUT` — multipart upload, validate, write `cover.jpg`. |
| `app/api/stories/[slug]/export/epub/route.ts` | `POST` — build EPUB, validate, atomic write to `exports/`. |
| `app/s/[slug]/export/page.tsx` | Thin server component — fetches story + chapters, delegates to `ExportPage`. |
| `components/publish/ImportChapterDialog.tsx` | Three-pane dialog (paste / cleanup toggles + title + recap / live preview). |
| `components/publish/ExportPage.tsx` | Two-column page (metadata form / cover + build panel). |
| `tests/lib/publish-cleanup.test.ts` | Unit tests for each cleanup step + idempotency. |
| `tests/lib/publish-epub.test.ts` | Unit tests for transformer, preview HTML, EPUB bytes. |
| `tests/api/chapters.import.test.ts` | Import route tests. |
| `tests/api/cover.test.ts` | Cover upload route tests. |
| `tests/api/export.epub.test.ts` | Export route tests. |

**Modified files:**

| Path | What changes |
|------|--------------|
| [lib/types.ts](../../../lib/types.ts) | Add `source?: "generated" \| "imported"` to `Chapter`. |
| [lib/storage/paths.ts](../../../lib/storage/paths.ts) | Add `coverPath(dataDir, slug)`, `exportsDir(dataDir, slug)`, `epubPath(dataDir, slug)`. |
| [lib/storage/chapters.ts](../../../lib/storage/chapters.ts) | Add `createImportedChapter(dataDir, slug, input)` — accepts pre-built sections + title + source. |
| [components/editor/ChapterList.tsx](../../../components/editor/ChapterList.tsx) | Add "Import chapter" button next to "New chapter". Add "Export" nav link (or — if nav lives elsewhere — add it to the appropriate nav component). |
| [tests/e2e/golden-path.spec.ts](../../../tests/e2e/golden-path.spec.ts) | Extend (or add sibling `publishing-kit.spec.ts`) — paste → preview → save → export → `.epub` on disk. |
| [README.md](../../../README.md) | Add one sentence to the privacy section about Publishing Kit being fully local. |
| [package.json](../../../package.json) | Add `epub-gen-memory`, `isomorphic-dompurify`, `sharp`, `epubcheck-wasm` as deps. |

---

## Chunk 1: Dependencies + data model + paths

Lays the groundwork: verifies the chosen EPUB libraries actually install and can emit a valid EPUB; extends types; adds filesystem-path helpers. No UI, no routes, no user-visible behavior yet. Each task is independently committable and leaves the quality gates green.

### Task 1.1: Install dependencies + EPUB smoke test

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `tests/lib/publish-epub-smoke.test.ts`

- [ ] **Step 1: Install the new deps**

```bash
npm install --save epub-gen-memory isomorphic-dompurify sharp
npm install --save-dev epubcheck-wasm
```

Expected: all four install cleanly. If any package fails to install or resolve on Node 20+, stop and investigate before continuing — the plan's rendering approach assumes `epub-gen-memory` and `epubcheck-wasm` work. If one is broken, consult the spec's "Library confirmation" fallback note (`jszip`-based EPUB build; skip validation) before deviating.

- [ ] **Step 2: Write a smoke test that builds an empty-ish EPUB with `epub-gen-memory`**

Create `tests/lib/publish-epub-smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const epub: { default: unknown } | unknown = require("epub-gen-memory");

describe("epub-gen-memory smoke", () => {
  it("is importable and exposes a callable generator", async () => {
    const candidate =
      (epub as { default?: unknown }).default ?? (epub as unknown);
    expect(typeof candidate).toBe("function");
  });

  it("produces a non-empty Buffer / Uint8Array for a minimal book", async () => {
    const mod = (await import("epub-gen-memory")) as unknown as {
      default?: (opts: unknown, content: unknown) => Promise<Buffer>;
    };
    const generator = mod.default ?? (mod as unknown as (o: unknown, c: unknown) => Promise<Buffer>);
    const bytes = await (generator as (o: unknown, c: unknown) => Promise<Buffer>)(
      { title: "Smoke", author: "Test" },
      [{ title: "Chapter 1", content: "<p>Hello.</p>" }]
    );
    expect(bytes.byteLength ?? bytes.length).toBeGreaterThan(100);
    // EPUB = ZIP; ZIP magic bytes are 0x50 0x4B 0x03 0x04.
    const first4 = Buffer.from(bytes).subarray(0, 4);
    expect(first4[0]).toBe(0x50);
    expect(first4[1]).toBe(0x4b);
  });
});
```

This test uses `require` + dynamic `import` deliberately because `epub-gen-memory`'s published export shape has shifted between versions. Lock the actual API shape in Task 3.4 once it's confirmed.

- [ ] **Step 3: Run the smoke test**

Run: `npm test -- tests/lib/publish-epub-smoke.test.ts`
Expected: PASS.

If the test fails with a missing-dependency error from `epub-gen-memory`, install whatever it requires and document in a PR note. If the library crashes on minimal input, escalate.

- [ ] **Step 4: Quality gates**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tests/lib/publish-epub-smoke.test.ts
git commit -m "chore(publishing-kit): install epub-gen-memory + sharp + isomorphic-dompurify + epubcheck-wasm

Smoke test proves epub-gen-memory can emit a valid ZIP/EPUB on Node 20+."
```

---

### Task 1.2: Add `Chapter.source` field

**Files:**
- Modify: `lib/types.ts`
- Test: `tests/lib/types.test.ts` (create if absent — a tiny type-level test)

- [ ] **Step 1: Write a failing compile-time test for `Chapter.source`**

Create or append to `tests/lib/types.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Chapter } from "@/lib/types";

describe("Chapter.source", () => {
  it("accepts 'imported' and 'generated' and undefined", () => {
    const a: Pick<Chapter, "source"> = { source: "imported" };
    const b: Pick<Chapter, "source"> = { source: "generated" };
    const c: Pick<Chapter, "source"> = {};
    expect(a.source).toBe("imported");
    expect(b.source).toBe("generated");
    expect(c.source).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/lib/types.test.ts`
Expected: FAIL — TS error that `source` doesn't exist on `Chapter`.

- [ ] **Step 3: Add the field**

Edit [lib/types.ts](../../../lib/types.ts). In the `Chapter` type, add:

```ts
export type Chapter = {
  // ... existing fields ...
  targetWords?: number;
  source?: "generated" | "imported";
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/lib/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Quality gates**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts tests/lib/types.test.ts
git commit -m "feat(types): add optional Chapter.source for import provenance"
```

---

### Task 1.3: Add `epubPath` helper (`coverPath` and `exportsDir` already exist)

**Files:**
- Modify: `lib/storage/paths.ts`
- Test: `tests/lib/paths.test.ts` (create or append)

**Context.** `lib/storage/paths.ts` already exports `coverPath(dataDir, slug)` → `…/cover.jpg` and `exportsDir(dataDir, slug)` → `…/exports`. Both compose via `storyDir(…)`. Re-exporting them would collide; the only new helper this task adds is `epubPath`.

- [ ] **Step 1: Sanity check — confirm the two existing helpers still have the signatures we expect**

```bash
grep -nE "^export function (coverPath|exportsDir|epubPath)" lib/storage/paths.ts
```

Expected output: lines for `exportsDir` and `coverPath`, nothing for `epubPath`. If `epubPath` already exists, skip this task entirely and continue to Task 1.4. If the existing `coverPath` returns anything other than `…/cover.jpg` or the existing `exportsDir` anything other than `…/exports`, escalate before proceeding — downstream code assumes the paths.

- [ ] **Step 2: Write failing test for `epubPath`**

Create or append to `tests/lib/paths.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { coverPath, exportsDir, epubPath } from "@/lib/storage/paths";

describe("publishing paths", () => {
  const dataDir = "/data";
  const slug = "my-story";

  it("coverPath (existing helper) returns the cover.jpg path under the story dir", () => {
    expect(coverPath(dataDir, slug)).toBe("/data/stories/my-story/cover.jpg");
  });

  it("exportsDir (existing helper) returns the exports subdir", () => {
    expect(exportsDir(dataDir, slug)).toBe("/data/stories/my-story/exports");
  });

  it("epubPath returns exports/<slug>.epub", () => {
    expect(epubPath(dataDir, slug)).toBe(
      "/data/stories/my-story/exports/my-story.epub"
    );
  });
});
```

The two `coverPath` / `exportsDir` tests are value-lock regression tests — they assert the EXISTING helpers continue to produce the paths this plan depends on. If someone later changes `storyDir`'s composition, these tests catch it. They should pass immediately.

- [ ] **Step 3: Run — expect `epubPath` test to fail, others to pass**

```bash
npm test -- tests/lib/paths.test.ts
```

- [ ] **Step 4: Implement `epubPath`**

Open [lib/storage/paths.ts](../../../lib/storage/paths.ts). Add `epubPath` next to the existing `exportsDir` helper, composing via it:

```ts
export function epubPath(dataDir: string, storySlug: string) {
  return join(exportsDir(dataDir, storySlug), `${storySlug}.epub`);
}
```

Follow the file's existing style — parameter name `storySlug`, no explicit return type, `join` already imported.

- [ ] **Step 5: Run — all pass**

- [ ] **Step 6: Quality gates**

```bash
npm run typecheck && npm run lint && npm test
```

- [ ] **Step 7: Commit**

```bash
git add lib/storage/paths.ts tests/lib/paths.test.ts
git commit -m "feat(paths): add epubPath helper"
```

---

### Task 1.4: Add `createImportedChapter` storage helper

A sibling of the existing `createChapter`, but takes pre-built sections + title + `source: "imported"` in one atomic write. Prevents a two-step "create empty → patch to fill" dance.

**Files:**
- Modify: `lib/storage/chapters.ts`
- Test: `tests/lib/chapters-storage.test.ts` (new file if absent, else append)

- [ ] **Step 1: Write the failing test**

Create or append to `tests/lib/chapters-storage.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStory } from "@/lib/storage/stories";
import { createImportedChapter, listChapters } from "@/lib/storage/chapters";

describe("createImportedChapter", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "scriptr-chapters-import-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates a chapter with source=imported, sections populated, and appends to order", async () => {
    const story = await createStory(dir, { title: "Book" });
    const chapter = await createImportedChapter(dir, story.slug, {
      title: "The Return",
      sectionContents: ["Scene one prose.", "Scene two prose."],
    });

    expect(chapter.source).toBe("imported");
    expect(chapter.title).toBe("The Return");
    expect(chapter.sections).toHaveLength(2);
    expect(chapter.sections[0].content).toBe("Scene one prose.");
    expect(chapter.sections[1].content).toBe("Scene two prose.");
    expect(chapter.wordCount).toBe(6);

    const chapters = await listChapters(dir, story.slug);
    expect(chapters.map((c) => c.id)).toEqual([chapter.id]);
  });

  it("accepts zero sections (edge) without crashing", async () => {
    const story = await createStory(dir, { title: "Empty" });
    const chapter = await createImportedChapter(dir, story.slug, {
      title: "Stub",
      sectionContents: [],
    });
    expect(chapter.sections).toEqual([]);
    expect(chapter.wordCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/lib/chapters-storage.test.ts`
Expected: FAIL — `createImportedChapter` not exported.

- [ ] **Step 3: Implement `createImportedChapter`**

Open [lib/storage/chapters.ts](../../../lib/storage/chapters.ts). Below `createChapter`, add:

```ts
export type NewImportedChapterInput = {
  title: string;
  sectionContents: string[];
};

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export async function createImportedChapter(
  dataDir: string,
  slug: string,
  input: NewImportedChapterInput
): Promise<Chapter> {
  const story = await getStory(dataDir, slug);
  if (!story) throw new Error(`Story not found: ${slug}`);

  const sections = input.sectionContents.map((content) => ({
    id: randomUUID(),
    content,
  }));
  const wordCount = input.sectionContents.reduce(
    (acc, s) => acc + countWords(s),
    0
  );

  const chapter: Chapter = {
    id: randomUUID(),
    title: input.title,
    summary: "",
    beats: [],
    prompt: "",
    recap: "",
    sections,
    wordCount,
    source: "imported",
  };

  const index = story.chapterOrder.length;
  const filePath = chapterFile(dataDir, slug, index, chapter.id, chapter.title);
  await mkdir(chaptersDir(dataDir, slug), { recursive: true });
  await writeFile(filePath, JSON.stringify(chapter, null, 2), "utf-8");

  await updateStory(dataDir, slug, {
    chapterOrder: [...story.chapterOrder, chapter.id],
  });

  return chapter;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/lib/chapters-storage.test.ts`
Expected: PASS.

- [ ] **Step 5: Quality gates**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add lib/storage/chapters.ts tests/lib/chapters-storage.test.ts
git commit -m "feat(storage): add createImportedChapter for paste-import flow"
```

---

## Chunk 2: Cleanup pipeline (`lib/publish/cleanup.ts`)

Pure text transformations. Each step tested independently; the full pipeline tested end-to-end. **Step order is load-bearing** — `normalizeSceneBreaks` MUST precede `normalizeDashes` or `---` scene markers get mangled. See the spec's Cleanup pipeline section for the rationale.

### Task 2.1: Type scaffolding + `cleanPaste` skeleton

**Files:**
- Create: `lib/publish/cleanup.ts`
- Create: `tests/lib/publish-cleanup.test.ts`

- [ ] **Step 1: Write a failing test for the type shape**

Create `tests/lib/publish-cleanup.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { cleanPaste, type CleanupStep } from "@/lib/publish/cleanup";

describe("cleanPaste — skeleton", () => {
  it("returns a result with sections[] and warnings[]", () => {
    const res = cleanPaste("hello world");
    expect(Array.isArray(res.sections)).toBe(true);
    expect(Array.isArray(res.warnings)).toBe(true);
  });

  it("exposes the full list of cleanup steps", () => {
    const steps: CleanupStep[] = [
      "normalizeLineEndings",
      "stripChatCruft",
      "trimTrailingWhitespace",
      "collapseInternalSpaces",
      "normalizeQuotes",
      "normalizeSceneBreaks",
      "normalizeDashes",
      "preserveMarkdownEmphasis",
      "collapseBlankLines",
      "splitIntoSections",
    ];
    expect(steps).toHaveLength(10);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/lib/publish-cleanup.test.ts`
Expected: FAIL — `Cannot find module '@/lib/publish/cleanup'`.

- [ ] **Step 3: Create the skeleton**

Create `lib/publish/cleanup.ts`:

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
  sections: string[];
  warnings: string[];
};

const DEFAULTS: Required<CleanupOptions> = {
  normalizeLineEndings: true,
  stripChatCruft: true,
  trimTrailingWhitespace: true,
  collapseInternalSpaces: true,
  normalizeQuotes: true,
  normalizeSceneBreaks: true,
  normalizeDashes: true,
  preserveMarkdownEmphasis: true,
  collapseBlankLines: true,
  splitIntoSections: true,
};

export function cleanPaste(raw: string, opts?: CleanupOptions): CleanResult {
  const on = { ...DEFAULTS, ...(opts ?? {}) };
  const warnings: string[] = [];
  let text = raw;
  // Individual steps filled in by subsequent tasks.
  const sections = on.splitIntoSections ? text.split("\n---\n") : [text];
  return { sections, warnings };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/lib/publish-cleanup.test.ts`
Expected: PASS.

- [ ] **Step 5: Quality gates**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add lib/publish/cleanup.ts tests/lib/publish-cleanup.test.ts
git commit -m "feat(publish): scaffold cleanup module with step enum"
```

---

### Task 2.2: Implement `normalizeLineEndings` (step 1)

**Files:**
- Modify: `lib/publish/cleanup.ts`
- Modify: `tests/lib/publish-cleanup.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/lib/publish-cleanup.test.ts`:

```ts
describe("normalizeLineEndings", () => {
  it("converts CRLF to LF", () => {
    const out = cleanPaste("a\r\nb\r\nc");
    expect(out.sections[0]).not.toMatch(/\r/);
    expect(out.sections[0].split("\n")).toEqual(["a", "b", "c"]);
  });

  it("converts lone CR to LF", () => {
    const out = cleanPaste("a\rb\rc");
    expect(out.sections[0]).not.toMatch(/\r/);
  });

  it("leaves already-LF text unchanged", () => {
    const out = cleanPaste("a\nb\nc");
    expect(out.sections[0]).toBe("a\nb\nc");
  });

  it("can be disabled", () => {
    const out = cleanPaste("a\r\nb", { normalizeLineEndings: false });
    expect(out.sections[0]).toContain("\r");
  });
});
```

- [ ] **Step 2: Run — expect failures**

Run: `npm test -- tests/lib/publish-cleanup.test.ts`

- [ ] **Step 3: Implement the step**

In `lib/publish/cleanup.ts`, inside `cleanPaste`, before the `splitIntoSections` logic:

```ts
if (on.normalizeLineEndings) {
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}
```

- [ ] **Step 4: Run — all pass**

- [ ] **Step 5: Commit**

```bash
git add lib/publish/cleanup.ts tests/lib/publish-cleanup.test.ts
git commit -m "feat(publish): cleanup step 1 — normalizeLineEndings"
```

---

### Task 2.3: Implement `stripChatCruft` (step 2)

**Files:**
- Modify: `lib/publish/cleanup.ts`
- Modify: `tests/lib/publish-cleanup.test.ts`

- [ ] **Step 1: Write failing tests**

Append:

```ts
describe("stripChatCruft", () => {
  const neutral = {
    normalizeQuotes: false,
    normalizeDashes: false,
    normalizeSceneBreaks: false,
    collapseBlankLines: false,
  };

  it("strips a preamble paragraph like 'Sure, here's chapter 3:'", () => {
    const raw = "Sure, here's chapter 3:\n\nShe walked in.\n\nHe waited.";
    const out = cleanPaste(raw, neutral);
    expect(out.sections[0]).not.toContain("Sure, here's chapter 3");
    expect(out.sections[0]).toContain("She walked in");
    expect(out.warnings.some((w) => /preamble|strip/i.test(w))).toBe(true);
  });

  it("strips a sign-off paragraph like 'Let me know...'", () => {
    const raw = "She walked in.\n\nHe waited.\n\nLet me know if you want me to tweak!";
    const out = cleanPaste(raw, neutral);
    expect(out.sections[0]).not.toMatch(/Let me know/);
    expect(out.sections[0]).toContain("He waited");
  });

  it("does NOT strip novel prose that happens to begin with 'Sure'", () => {
    const raw = 'Sure, it was a fine morning. "Pity," she said.\n\nHe nodded.';
    const out = cleanPaste(raw, neutral);
    expect(out.sections[0]).toContain("Sure, it was a fine morning");
  });

  it("can be disabled", () => {
    const raw = "Sure, here's chapter 3:\n\nProse.";
    const out = cleanPaste(raw, { stripChatCruft: false });
    expect(out.sections[0]).toContain("Sure, here's chapter 3");
  });
});
```

- [ ] **Step 2: Run — expect failures**

- [ ] **Step 3: Implement**

In `lib/publish/cleanup.ts`, add helper + wire in after `normalizeLineEndings`:

```ts
const PREAMBLE_PATTERNS: RegExp[] = [
  /^(sure|here(?:'s| is)|okay|got it|alright|absolutely)[\s,:\-]/i,
  /^(below|this is)\s+(?:the|a|your)\s+(?:chapter|scene|draft|version)/i,
];
const SIGNOFF_PATTERNS: RegExp[] = [
  /^(let me know|hope (?:this|you)|happy to (?:revise|tweak|continue)|feel free to)/i,
  /^(want me to (?:continue|revise|tweak)|shall i continue)/i,
];

function stripChatCruft(input: string, warnings: string[]): string {
  const paragraphs = input.split(/\n\s*\n/);
  if (paragraphs.length === 0) return input;

  const first = paragraphs[0].trim();
  // Strip preamble ONLY if the first paragraph is "obviously chat metadata":
  //  1. Matches a preamble trigger pattern (starts with "Sure, here's…", etc.), AND
  //  2. One of:
  //     a. Ends with `:` or `-` (typical chat lead-in like "Sure, here's chapter 3:"), OR
  //     b. Is a short single sentence (≤60 chars, no internal sentence-end
  //        followed by another capital/quote/opener — i.e. genuinely one utterance).
  //
  // The 60-char ceiling is the key guard against eating novel prose that
  // happens to start with "Sure," — real prose almost always runs longer
  // or contains a sentence break before the paragraph ends.
  const SENTENCE_BREAK = /\.\s+["'\u201C\u2018A-Z]/;
  const looksLikeChatPreamble =
    PREAMBLE_PATTERNS.some((p) => p.test(first)) &&
    (/[:\-]\s*$/.test(first) ||
      (first.length <= 60 && !SENTENCE_BREAK.test(first)));

  if (looksLikeChatPreamble) {
    const removed = paragraphs.shift() ?? "";
    warnings.push(
      `Stripped chat preamble: "${removed.slice(0, 50)}${removed.length > 50 ? "\u2026" : ""}"`
    );
  }

  if (paragraphs.length > 0) {
    const last = paragraphs[paragraphs.length - 1].trim();
    if (last.length <= 200 && SIGNOFF_PATTERNS.some((p) => p.test(last))) {
      const removed = paragraphs.pop() ?? "";
      warnings.push(
        `Stripped chat sign-off: "${removed.slice(0, 50)}${removed.length > 50 ? "\u2026" : ""}"`
      );
    }
  }

  return paragraphs.join("\n\n");
}

// Inside cleanPaste, after normalizeLineEndings:
if (on.stripChatCruft) {
  text = stripChatCruft(text, warnings);
}
```

The heuristic is narrow on purpose — over-stripping is the main failure mode, not under-stripping. Two escape hatches:

1. **Trailing-colon/dash test.** Chat-style lead-ins end with `:` or `-`. Novel prose almost never does.
2. **Short-single-sentence test.** If the paragraph is ≤60 chars AND contains no sentence break followed by a capital letter *or an opening quote* (to catch dialogue like `. "Pity,"`), it's plausibly a standalone chat utterance like "Okay, got it." or "Absolutely."

The "Sure, it was a fine morning..." test passes because:
- Length > 60 chars → short-sentence branch fails.
- Doesn't end with `:` or `-` → trailing-punctuation branch fails.
- Result: preamble stays. ✓

The "Sure, here's chapter 3:" test passes because it ends with `:`.

- [ ] **Step 4: Run — all pass**

- [ ] **Step 5: Commit**

```bash
git add lib/publish/cleanup.ts tests/lib/publish-cleanup.test.ts
git commit -m "feat(publish): cleanup step 2 — stripChatCruft"
```

---

### Task 2.4: Implement `trimTrailingWhitespace` + `collapseInternalSpaces` (steps 3–4)

**Files:**
- Modify: `lib/publish/cleanup.ts`
- Modify: `tests/lib/publish-cleanup.test.ts`

- [ ] **Step 1: Write failing tests**

Append:

```ts
describe("trimTrailingWhitespace + collapseInternalSpaces", () => {
  it("trims trailing spaces on each line", () => {
    const raw = "hello   \nworld  ";
    const out = cleanPaste(raw, { stripChatCruft: false });
    expect(out.sections[0]).toBe("hello\nworld");
  });

  it("collapses multiple internal spaces to one", () => {
    const raw = "hello    world";
    const out = cleanPaste(raw, { stripChatCruft: false });
    expect(out.sections[0]).toBe("hello world");
  });

  it("collapses double-space-after-period", () => {
    const raw = "A sentence.  Another sentence.";
    const out = cleanPaste(raw, { stripChatCruft: false });
    expect(out.sections[0]).toBe("A sentence. Another sentence.");
  });
});
```

- [ ] **Step 2: Run — expect failures**

- [ ] **Step 3: Implement**

Inside `cleanPaste`, after `stripChatCruft`:

```ts
if (on.trimTrailingWhitespace) {
  text = text
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n");
}
if (on.collapseInternalSpaces) {
  text = text
    .split("\n")
    .map((line) => line.replace(/ {2,}/g, " "))
    .join("\n");
}
```

- [ ] **Step 4: Run — all pass**

- [ ] **Step 5: Commit**

```bash
git add lib/publish/cleanup.ts tests/lib/publish-cleanup.test.ts
git commit -m "feat(publish): cleanup steps 3-4 — whitespace trim + collapse"
```

---

### Task 2.5: Implement `normalizeQuotes` (step 5)

**Files:**
- Modify: `lib/publish/cleanup.ts`
- Modify: `tests/lib/publish-cleanup.test.ts`

- [ ] **Step 1: Write failing tests**

Append:

```ts
describe("normalizeQuotes", () => {
  it("converts straight doubles to curly contextually", () => {
    const raw = '"You\'re here," she said.';
    const out = cleanPaste(raw, { stripChatCruft: false });
    expect(out.sections[0]).toContain("\u201CYou");
    expect(out.sections[0]).toContain(",\u201D she said");
  });

  it("uses closing single for contractions (don't, he'd)", () => {
    const raw = "don't he'd won't";
    const out = cleanPaste(raw, { stripChatCruft: false });
    expect(out.sections[0]).toBe("don\u2019t he\u2019d won\u2019t");
  });

  it("uses opening single after whitespace", () => {
    const raw = "He said, 'no.'";
    const out = cleanPaste(raw, { stripChatCruft: false });
    expect(out.sections[0]).toContain("\u2018no");
    expect(out.sections[0]).toContain("no.\u2019");
  });

  it("preserves already-curly quotes", () => {
    const raw = "\u201Calready curly\u201D";
    const out = cleanPaste(raw, { stripChatCruft: false });
    expect(out.sections[0]).toBe("\u201Calready curly\u201D");
  });

  it("can be disabled", () => {
    const raw = '"foo"';
    const out = cleanPaste(raw, { normalizeQuotes: false, stripChatCruft: false });
    expect(out.sections[0]).toBe('"foo"');
  });

  it("emits a warning with the count of converted quotes", () => {
    const raw = '"a" "b" don\'t';
    const out = cleanPaste(raw, { stripChatCruft: false });
    const msg = out.warnings.find((w) => /quote/i.test(w));
    expect(msg).toBeDefined();
    expect(msg).toMatch(/\d+/);
  });
});
```

- [ ] **Step 2: Run — expect failures**

- [ ] **Step 3: Implement**

```ts
function normalizeQuotes(input: string, warnings: string[]): string {
  let count = 0;

  let out = input.replace(/"/g, (_, offset: number, full: string) => {
    count++;
    const prev = full[offset - 1] ?? "";
    const opening = offset === 0 || /[\s([{\u2014\u2013\-]/.test(prev);
    return opening ? "\u201C" : "\u201D";
  });

  out = out.replace(/'/g, (_, offset: number, full: string) => {
    count++;
    const prev = full[offset - 1] ?? "";
    const next = full[offset + 1] ?? "";
    if (/[A-Za-z]/.test(prev) && /[A-Za-z]/.test(next)) return "\u2019";
    if (offset === 0 || /[\s([{\u2014\u2013\-]/.test(prev)) return "\u2018";
    return "\u2019";
  });

  if (count > 0) warnings.push(`Converted ${count} straight quotes to curly.`);
  return out;
}

// Inside cleanPaste, after collapseInternalSpaces:
if (on.normalizeQuotes) {
  text = normalizeQuotes(text, warnings);
}
```

- [ ] **Step 4: Run — all pass**

- [ ] **Step 5: Commit**

```bash
git add lib/publish/cleanup.ts tests/lib/publish-cleanup.test.ts
git commit -m "feat(publish): cleanup step 5 — normalizeQuotes"
```

---

### Task 2.6: Implement `normalizeSceneBreaks` (step 6 — BEFORE dashes)

**Files:**
- Modify: `lib/publish/cleanup.ts`
- Modify: `tests/lib/publish-cleanup.test.ts`

- [ ] **Step 1: Write failing tests**

Append:

```ts
describe("normalizeSceneBreaks", () => {
  const base = { stripChatCruft: false, normalizeQuotes: false };

  it("converts * * * to ---", () => {
    const raw = "a\n\n* * *\n\nb";
    const out = cleanPaste(raw, base);
    expect(out.sections).toEqual(["a", "b"]);
  });

  it("converts *** to ---", () => {
    const raw = "a\n\n***\n\nb";
    const out = cleanPaste(raw, base);
    expect(out.sections).toEqual(["a", "b"]);
  });

  it("converts a lone # to ---", () => {
    const raw = "a\n\n#\n\nb";
    const out = cleanPaste(raw, base);
    expect(out.sections).toEqual(["a", "b"]);
  });

  it("collapses 3+ blank lines to a scene break", () => {
    const raw = "a\n\n\n\nb";
    const out = cleanPaste(raw, base);
    expect(out.sections).toEqual(["a", "b"]);
  });

  it("leaves already-canonical --- markers alone", () => {
    const raw = "a\n\n---\n\nb";
    const out = cleanPaste(raw, base);
    expect(out.sections).toEqual(["a", "b"]);
  });

  it("warns per marker normalized", () => {
    const raw = "a\n\n* * *\n\nb\n\n***\n\nc";
    const out = cleanPaste(raw, base);
    const msg = out.warnings.find((w) => /scene|break/i.test(w));
    expect(msg).toBeDefined();
  });
});
```

- [ ] **Step 2: Run — expect failures**

- [ ] **Step 3: Implement**

```ts
function normalizeSceneBreaks(input: string, warnings: string[]): string {
  const MARKER_LINE = /^\s*(?:\*\s*\*\s*\*|\*{3,}|#|\u2014{3,}|-{3,}|={3,})\s*$/;
  let markersNormalized = 0;
  const lines = input.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (MARKER_LINE.test(line)) {
      if (line.trim() !== "---") markersNormalized++;
      out.push("---");
    } else {
      out.push(line);
    }
  }
  const joined = out.join("\n");
  const blankRunCollapsed = joined.replace(/\n(?:\s*\n){3,}/g, "\n\n---\n\n");
  if (blankRunCollapsed !== joined) markersNormalized++;

  if (markersNormalized > 0) {
    warnings.push(`Normalized ${markersNormalized} scene break marker(s).`);
  }
  return blankRunCollapsed;
}

// Inside cleanPaste, after normalizeQuotes:
if (on.normalizeSceneBreaks) {
  text = normalizeSceneBreaks(text, warnings);
}
```

Also update the `splitIntoSections` logic at the bottom of `cleanPaste`:

```ts
const sections = on.splitIntoSections
  ? text
      .split(/\n---\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  : [text];
```

- [ ] **Step 4: Run — all pass**

- [ ] **Step 5: Commit**

```bash
git add lib/publish/cleanup.ts tests/lib/publish-cleanup.test.ts
git commit -m "feat(publish): cleanup step 6 — normalizeSceneBreaks (before dashes)"
```

---

### Task 2.7: Implement `normalizeDashes` (step 7 — AFTER scene breaks)

**Files:**
- Modify: `lib/publish/cleanup.ts`
- Modify: `tests/lib/publish-cleanup.test.ts`

- [ ] **Step 1: Write failing tests — especially the regression guard for the ordering bug**

Append:

```ts
describe("normalizeDashes", () => {
  const base = { stripChatCruft: false, normalizeQuotes: false };

  it("converts -- to em dash", () => {
    const raw = "She walked -- slowly -- into the room.";
    const out = cleanPaste(raw, base);
    expect(out.sections[0]).toBe("She walked \u2014 slowly \u2014 into the room.");
  });

  it("does NOT touch --- scene markers (regression guard for ordering bug)", () => {
    const raw = "a\n\n---\n\nb";
    const out = cleanPaste(raw, base);
    expect(out.sections).toEqual(["a", "b"]);
  });

  it("leaves hyphens in compound words alone", () => {
    const raw = "state-of-the-art";
    const out = cleanPaste(raw, base);
    expect(out.sections[0]).toBe("state-of-the-art");
  });
});
```

- [ ] **Step 2: Run — expect failures**

- [ ] **Step 3: Implement**

```ts
function normalizeDashes(input: string): string {
  return input
    .split("\n")
    .map((line) => {
      if (line === "---") return line; // preserve our own marker
      return line.replace(/--/g, "\u2014");
    })
    .join("\n");
}

// Inside cleanPaste, after normalizeSceneBreaks:
if (on.normalizeDashes) {
  text = normalizeDashes(text);
}
```

- [ ] **Step 4: Run — all pass**

- [ ] **Step 5: Commit**

```bash
git add lib/publish/cleanup.ts tests/lib/publish-cleanup.test.ts
git commit -m "feat(publish): cleanup step 7 — normalizeDashes (skips --- markers)"
```

---

### Task 2.8: Implement `preserveMarkdownEmphasis` (step 8)

**Files:**
- Modify: `lib/publish/cleanup.ts`
- Modify: `tests/lib/publish-cleanup.test.ts`

- [ ] **Step 1: Write failing tests**

Append:

```ts
describe("preserveMarkdownEmphasis", () => {
  const base = { stripChatCruft: false, normalizeQuotes: false };

  it("leaves *italic* and **bold** in content by default (on)", () => {
    const raw = "She was *very* tired. He was **angry**.";
    const out = cleanPaste(raw, base);
    expect(out.sections[0]).toBe("She was *very* tired. He was **angry**.");
  });

  it("strips markdown markers when disabled (off), keeping inner text", () => {
    const raw = "She was *very* tired. He was **angry**.";
    const out = cleanPaste(raw, { ...base, preserveMarkdownEmphasis: false });
    expect(out.sections[0]).toBe("She was very tired. He was angry.");
  });
});
```

- [ ] **Step 2: Run — expect failures**

- [ ] **Step 3: Implement**

```ts
function preserveMarkdownEmphasis(input: string, enabled: boolean): string {
  if (enabled) return input;
  return input
    .replace(/\*\*([^*\n]+?)\*\*/g, "$1")
    .replace(/\*([^*\n]+?)\*/g, "$1");
}

// Inside cleanPaste, after normalizeDashes:
// "on" is a no-op; "off" strips markers.
text = preserveMarkdownEmphasis(text, on.preserveMarkdownEmphasis);
```

- [ ] **Step 4: Run — all pass**

- [ ] **Step 5: Commit**

```bash
git add lib/publish/cleanup.ts tests/lib/publish-cleanup.test.ts
git commit -m "feat(publish): cleanup step 8 — preserveMarkdownEmphasis"
```

---

### Task 2.9: Implement `collapseBlankLines` + finalize `splitIntoSections` (steps 9–10)

**Files:**
- Modify: `lib/publish/cleanup.ts`
- Modify: `tests/lib/publish-cleanup.test.ts`

- [ ] **Step 1: Write failing tests**

Append:

```ts
describe("collapseBlankLines + splitIntoSections", () => {
  const base = { stripChatCruft: false, normalizeQuotes: false };

  it("collapses runs of >1 blank line (that weren't scene breaks) to one", () => {
    const raw = "a\n\n\nb"; // two blank lines; not a scene break (needs 3+)
    const out = cleanPaste(raw, base);
    expect(out.sections[0]).toBe("a\n\nb");
  });

  it("splits on --- markers into multiple sections", () => {
    const raw = "first section\n\n---\n\nsecond section\n\n---\n\nthird";
    const out = cleanPaste(raw, base);
    expect(out.sections).toEqual(["first section", "second section", "third"]);
  });

  it("leading / trailing --- do not create empty sections", () => {
    const raw = "---\n\na\n\n---\n\nb\n\n---";
    const out = cleanPaste(raw, base);
    expect(out.sections).toEqual(["a", "b"]);
  });

  it("a paste with no --- returns one section", () => {
    const raw = "single scene only";
    const out = cleanPaste(raw, base);
    expect(out.sections).toEqual(["single scene only"]);
  });
});
```

- [ ] **Step 2: Run — expect failures**

- [ ] **Step 3: Implement `collapseBlankLines`**

```ts
function collapseBlankLines(input: string): string {
  // Runs of >1 blank line (but less than 3+ that became scene breaks) → 1 blank.
  return input.replace(/\n(?:\s*\n){2,}/g, "\n\n");
}

// Inside cleanPaste, after preserveMarkdownEmphasis:
if (on.collapseBlankLines) {
  text = collapseBlankLines(text);
}
```

`splitIntoSections` is already correct from Task 2.6.

- [ ] **Step 4: Run — all pass**

- [ ] **Step 5: Commit**

```bash
git add lib/publish/cleanup.ts tests/lib/publish-cleanup.test.ts
git commit -m "feat(publish): cleanup steps 9-10 — collapseBlankLines + splitIntoSections"
```

---

### Task 2.10: Idempotency + end-to-end pipeline test

**Files:**
- Modify: `tests/lib/publish-cleanup.test.ts`

- [ ] **Step 1: Write the idempotency test**

Append:

```ts
describe("cleanPaste idempotency + end-to-end", () => {
  it("running cleanPaste on its own (rejoined) output yields identical sections", () => {
    const raw = [
      "Sure, here's chapter 3:",
      "",
      'She walked in -- slowly -- and said "hi."',
      "",
      "* * *",
      "",
      "He replied, 'yes.'",
      "",
      "Let me know if you want more.",
    ].join("\n");

    const first = cleanPaste(raw);
    const rejoin = first.sections.join("\n\n---\n\n");
    const second = cleanPaste(rejoin);

    expect(second.sections).toEqual(first.sections);
  });

  it("kitchen-sink paste produces expected sections", () => {
    const raw = [
      "Here's the chapter:",
      "",
      "Chapter 3: The Return",
      "",
      'She walked into the room -- the same room. "You\'re here," she said.',
      "",
      '"I never left."',
      "",
      "***",
      "",
      "Later, in the kitchen, she poured two glasses of wine...",
      "",
      "Hope you like it!",
    ].join("\n");
    const out = cleanPaste(raw);

    expect(out.sections.join("\n")).not.toMatch(/Here's the chapter/);
    expect(out.sections.join("\n")).not.toMatch(/Hope you like it/);
    expect(out.sections.length).toBeGreaterThanOrEqual(2);
    expect(out.sections[0]).toContain("\u2014");
    expect(out.sections[0]).toContain("\u201CYou");
    expect(out.warnings.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm test -- tests/lib/publish-cleanup.test.ts`
Expected: PASS.

If idempotency fails, the most likely cause is step 7 touching our own `---` markers after rejoining. Verify the `if (line === "---") return line;` guard in `normalizeDashes` is in place.

- [ ] **Step 3: Full quality gates**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green. At this point the cleanup module is feature-complete.

- [ ] **Step 4: Commit**

```bash
git add tests/lib/publish-cleanup.test.ts
git commit -m "test(publish): cleanup pipeline idempotency + kitchen-sink"
```

---

## Chunk 3: EPUB renderer (`lib/publish/epub.ts`)

Pure renderer. `renderChapterPreviewHtml` is what the import dialog calls live in the browser; `buildEpubBytes` is what the export route calls. Both share the section-to-HTML transformer and the CSS stylesheet — one source of truth for preview-export parity.

### Task 3.1: Scaffold `lib/publish/epub.ts` with types and CSS constant

**Files:**
- Create: `lib/publish/epub.ts`
- Create: `tests/lib/publish-epub.test.ts`

- [ ] **Step 1: Write a failing scaffold test**

Create `tests/lib/publish-epub.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  renderChapterPreviewHtml,
  EPUB_STYLESHEET,
  type EpubInput,
} from "@/lib/publish/epub";
import type { Chapter } from "@/lib/types";

describe("epub module scaffold", () => {
  it("exports a stylesheet constant with key CSS rules", () => {
    expect(typeof EPUB_STYLESHEET).toBe("string");
    expect(EPUB_STYLESHEET).toMatch(/\.scene-break/);
    expect(EPUB_STYLESHEET).toMatch(/\.chapter-title/);
    expect(EPUB_STYLESHEET).toMatch(/page-break-before/);
  });

  it("renderChapterPreviewHtml returns a string wrapped in a div", () => {
    const chapter: Chapter = {
      id: "c1",
      title: "Test",
      summary: "",
      beats: [],
      prompt: "",
      recap: "",
      sections: [{ id: "s1", content: "Hello." }],
      wordCount: 1,
    };
    const html = renderChapterPreviewHtml(chapter, { chapterNumber: 1 });
    expect(html.startsWith("<div")).toBe(true);
    expect(html.endsWith("</div>")).toBe(true);
    expect(html).toContain("Chapter 1");
    expect(html).toContain("Hello.");
  });
});
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Create the scaffold**

Create `lib/publish/epub.ts`:

```ts
import type { Chapter, Story } from "@/lib/types";

export type EpubInput = {
  story: Story;
  chapters: Chapter[];
  coverPath?: string;
};

export type PreviewOpts = { chapterNumber?: number };

export const EPUB_STYLESHEET = `
body {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 1em;
  line-height: 1.5;
  color: #222;
  margin: 0;
  padding: 1.5em 1.75em;
}
h1.chapter-title {
  text-align: center;
  font-size: 1.35em;
  font-weight: 600;
  margin: 1.5em 0 0.25em;
  page-break-before: always;
}
p.chapter-subtitle {
  text-align: center;
  font-style: italic;
  font-weight: 400;
  margin: 0 0 1.25em;
}
p {
  text-align: justify;
  text-indent: 1.5em;
  margin: 0 0 0.3em;
}
p.first { text-indent: 0; }
div.scene-break {
  text-align: center;
  margin: 1em 0;
  letter-spacing: 0.3em;
}
`.trim();

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function renderChapterPreviewHtml(
  chapter: Chapter,
  opts?: PreviewOpts
): string {
  const num = opts?.chapterNumber ?? 1;
  // Minimal stub; full transformer lands in Task 3.2.
  const body = chapter.sections
    .map((s) => `<p>${escapeHtml(s.content)}</p>`)
    .join("");
  const subtitle = chapter.title
    ? `<p class="chapter-subtitle">${escapeHtml(chapter.title)}</p>`
    : "";
  return `<div class="epub-preview"><h1 class="chapter-title">Chapter ${num}</h1>${subtitle}${body}</div>`;
}
```

- [ ] **Step 4: Run — passes**

- [ ] **Step 5: Commit**

```bash
git add lib/publish/epub.ts tests/lib/publish-epub.test.ts
git commit -m "feat(publish): scaffold epub module with stylesheet + preview stub"
```

---

### Task 3.2: Implement the section-to-HTML transformer

**Files:**
- Modify: `lib/publish/epub.ts`
- Modify: `tests/lib/publish-epub.test.ts`

- [ ] **Step 1: Write failing transformer tests**

Append to `tests/lib/publish-epub.test.ts`:

```ts
describe("renderSectionHtml (transformer)", () => {
  function chapterWith(contents: string[]): Chapter {
    return {
      id: "c1",
      title: "T",
      summary: "",
      beats: [],
      prompt: "",
      recap: "",
      sections: contents.map((c, i) => ({ id: `s${i}`, content: c })),
      wordCount: 0,
    };
  }

  it("escapes HTML entities in raw text", () => {
    const html = renderChapterPreviewHtml(chapterWith(["<script>alert(1)</script>"]));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("transforms **bold** to <strong>", () => {
    const html = renderChapterPreviewHtml(chapterWith(["He was **angry**."]));
    expect(html).toContain("<strong>angry</strong>");
    expect(html).not.toContain("**");
  });

  it("transforms *italic* to <em>", () => {
    const html = renderChapterPreviewHtml(chapterWith(["She was *tired*."]));
    expect(html).toContain("<em>tired</em>");
  });

  it("supports nested italic inside bold via two-pass order", () => {
    const html = renderChapterPreviewHtml(chapterWith(["**bold with *italic* inside**"]));
    expect(html).toContain("<strong>bold with <em>italic</em> inside</strong>");
  });

  it("wraps each blank-line-separated paragraph in its own <p>", () => {
    const html = renderChapterPreviewHtml(chapterWith(["para one.\n\npara two."]));
    // Count unadorned <p> (not <p class=...>) — should be 2.
    const pCount = (html.match(/<p>/g) ?? []).length;
    expect(pCount).toBe(2);
  });

  it("renders a scene-break div between sections within a chapter", () => {
    const html = renderChapterPreviewHtml(chapterWith(["one", "two"]));
    expect(html).toContain('<div class="scene-break">* * *</div>');
  });

  it("collapses single newlines within a paragraph to spaces", () => {
    const html = renderChapterPreviewHtml(
      chapterWith(["line one\nline two\n\nnew para."])
    );
    expect(html).toContain("<p>line one line two</p>");
    expect(html).toContain("<p>new para.</p>");
  });
});
```

- [ ] **Step 2: Run — expect multiple failures**

- [ ] **Step 3: Implement the transformer**

Replace the body of `renderChapterPreviewHtml` with:

```ts
export function renderSectionHtml(content: string): string {
  let t = escapeHtml(content);
  t = t.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/\*([^*\n]+?)\*/g, "<em>$1</em>");

  const paragraphs = t
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  return paragraphs
    .map((p) => `<p>${p.replace(/\n/g, " ")}</p>`)
    .join("");
}

export function renderChapterPreviewHtml(
  chapter: Chapter,
  opts?: PreviewOpts
): string {
  const num = opts?.chapterNumber ?? 1;
  const sectionHtml = chapter.sections
    .map((s) => renderSectionHtml(s.content))
    .join('<div class="scene-break">* * *</div>');
  const subtitle = chapter.title
    ? `<p class="chapter-subtitle">${escapeHtml(chapter.title)}</p>`
    : "";
  return `<div class="epub-preview"><h1 class="chapter-title">Chapter ${num}</h1>${subtitle}${sectionHtml}</div>`;
}
```

- [ ] **Step 4: Run — all pass**

- [ ] **Step 5: Commit**

```bash
git add lib/publish/epub.ts tests/lib/publish-epub.test.ts
git commit -m "feat(publish): renderSectionHtml transformer (entities, emphasis, paragraphs)"
```

---

### Task 3.3: Implement `buildEpubBytes`

The exact `epub-gen-memory` API shape depends on the installed version. Task 1.1's smoke test confirmed the library is callable; read `node_modules/epub-gen-memory/README.md` or the `.d.ts` before writing this step. The snippet below assumes the common default-export signature `(options, contentArray) => Promise<Buffer>`; adapt if the installed version differs.

**Files:**
- Modify: `lib/publish/epub.ts`
- Modify: `tests/lib/publish-epub.test.ts`

- [ ] **Step 1: Write failing tests**

Append:

```ts
import { buildEpubBytes } from "@/lib/publish/epub";
import type { Story } from "@/lib/types";

describe("buildEpubBytes", () => {
  function story(): Story {
    return {
      slug: "test-book",
      title: "Test Book",
      authorPenName: "J. Doe",
      description: "A tiny test.",
      copyrightYear: 2026,
      language: "en",
      bisacCategory: "FIC027000",
      keywords: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      chapterOrder: ["c1", "c2"],
    };
  }

  function chapters(): Chapter[] {
    return [
      {
        id: "c1",
        title: "Opening",
        summary: "",
        beats: [],
        prompt: "",
        recap: "",
        sections: [{ id: "s1", content: "It began." }],
        wordCount: 2,
      },
      {
        id: "c2",
        title: "Ending",
        summary: "",
        beats: [],
        prompt: "",
        recap: "",
        sections: [{ id: "s2", content: "It ended." }],
        wordCount: 2,
      },
    ];
  }

  it("produces a ZIP-magic-byte-prefixed buffer", async () => {
    const bytes = await buildEpubBytes({ story: story(), chapters: chapters() });
    expect(bytes.byteLength).toBeGreaterThan(500);
    const b = Buffer.from(bytes);
    expect(b[0]).toBe(0x50);
    expect(b[1]).toBe(0x4b);
  });

  it("handles missing coverPath without crashing", async () => {
    const bytes = await buildEpubBytes({
      story: story(),
      chapters: chapters(),
      coverPath: undefined,
    });
    expect(bytes.byteLength).toBeGreaterThan(500);
  });
});
```

- [ ] **Step 2: Run — expect failures**

- [ ] **Step 3: Implement**

Add to `lib/publish/epub.ts`:

```ts
// eslint-disable-next-line @typescript-eslint/no-require-imports
const epubGen: unknown = require("epub-gen-memory");

type EpubGenFn = (
  options: {
    title: string;
    author: string;
    description?: string;
    lang?: string;
    cover?: string;
    ignoreFailedDownloads?: boolean;
    css?: string;
  },
  content: Array<{ title: string; content: string }>
) => Promise<Buffer>;

function getGenerator(): EpubGenFn {
  const mod = epubGen as { default?: EpubGenFn } & EpubGenFn;
  return (mod.default ?? mod) as EpubGenFn;
}

export async function buildEpubBytes(input: EpubInput): Promise<Uint8Array> {
  const { story, chapters, coverPath } = input;

  const content = chapters.map((chapter, idx) => {
    const inner = renderChapterPreviewHtml(chapter, { chapterNumber: idx + 1 });
    // Strip the outer .epub-preview wrapper — not meaningful in the package XHTML.
    const stripped = inner
      .replace(/^<div class="epub-preview">/, "")
      .replace(/<\/div>$/, "");
    return {
      title: chapter.title || `Chapter ${idx + 1}`,
      content: stripped,
    };
  });

  const generator = getGenerator();
  const buffer = await generator(
    {
      title: story.title,
      author: story.authorPenName,
      description: story.description,
      lang: story.language || "en",
      cover: coverPath,
      ignoreFailedDownloads: true,
      css: EPUB_STYLESHEET,
    },
    content
  );

  return new Uint8Array(buffer);
}
```

If the smoke test revealed a different API shape, adapt `EpubGenFn` accordingly.

- [ ] **Step 4: Run — all pass**

- [ ] **Step 5: Commit**

```bash
git add lib/publish/epub.ts tests/lib/publish-epub.test.ts
git commit -m "feat(publish): buildEpubBytes packages chapters into EPUB3"
```

---

### Task 3.4: Add `validateEpub` using `epubcheck-wasm`

**Files:**
- Modify: `lib/publish/epub.ts`
- Modify: `tests/lib/publish-epub.test.ts`

- [ ] **Step 1: Write failing test**

Append:

```ts
import { validateEpub } from "@/lib/publish/epub";

describe("validateEpub", () => {
  it("returns a warnings array (possibly empty) for a built EPUB", async () => {
    const bytes = await buildEpubBytes({ story: story(), chapters: chapters() });
    const result = await validateEpub(bytes);
    expect(Array.isArray(result.warnings)).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Implement — read `epubcheck-wasm` README first**

Read `node_modules/epubcheck-wasm/README.md` to confirm the API shape. The snippet below is a common shape; adapt if needed:

```ts
// eslint-disable-next-line @typescript-eslint/no-require-imports
const epubcheck: unknown = require("epubcheck-wasm");

export type ValidationResult = { warnings: string[] };

export async function validateEpub(bytes: Uint8Array): Promise<ValidationResult> {
  try {
    const mod = epubcheck as {
      default?: (b: Uint8Array) => Promise<{ messages?: Array<{ message: string }> }>;
      validate?: (b: Uint8Array) => Promise<{ messages?: Array<{ message: string }> }>;
    };
    const fn = mod.default ?? mod.validate;
    if (!fn) return { warnings: ["epubcheck-wasm API not recognized"] };
    const report = await fn(bytes);
    const warnings = (report.messages ?? []).map((m) => m.message);
    return { warnings };
  } catch (err) {
    return {
      warnings: [`epubcheck-wasm threw: ${(err as Error).message ?? String(err)}`],
    };
  }
}
```

- [ ] **Step 4: Run — passes**

- [ ] **Step 5: Commit**

```bash
git add lib/publish/epub.ts tests/lib/publish-epub.test.ts
git commit -m "feat(publish): validateEpub wraps epubcheck-wasm with graceful fallback"
```

---

## Chunk 4: Storage glue + API routes

Wire the pure modules to filesystem and HTTP. Each route has unit tests following the project's established pattern.

### Task 4.1: Implement `lib/publish/epub-storage.ts`

Atomic EPUB write (temp → rename), cover read/write, SVG-to-JPEG fallback via `sharp`.

**Files:**
- Create: `lib/publish/epub-storage.ts`
- Create: `tests/lib/publish-epub-storage.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/publish-epub-storage.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStory } from "@/lib/storage/stories";
import {
  writeEpub,
  readCoverPath,
  writeCoverJpeg,
  ensureCoverOrFallback,
} from "@/lib/publish/epub-storage";

describe("epub-storage", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "scriptr-epub-storage-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writeEpub writes atomically to exports/<slug>.epub", async () => {
    const story = await createStory(dir, { title: "Book" });
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
    const path = await writeEpub(dir, story.slug, bytes);
    expect(path.endsWith(`/exports/${story.slug}.epub`)).toBe(true);
    const stats = await stat(path);
    expect(stats.size).toBe(bytes.length);
  });

  it("writeCoverJpeg writes a JPEG file", async () => {
    const story = await createStory(dir, { title: "B" });
    const tinyJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const path = await writeCoverJpeg(dir, story.slug, tinyJpeg);
    expect(path.endsWith("/cover.jpg")).toBe(true);
    const written = await readFile(path);
    expect(written.length).toBeGreaterThan(0);
  });

  it("readCoverPath returns null when no cover on disk", async () => {
    const story = await createStory(dir, { title: "B" });
    const path = await readCoverPath(dir, story.slug);
    expect(path).toBeNull();
  });

  it("readCoverPath returns the path when a cover exists", async () => {
    const story = await createStory(dir, { title: "B" });
    await writeCoverJpeg(dir, story.slug, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]));
    const path = await readCoverPath(dir, story.slug);
    expect(path).not.toBeNull();
    expect(path!.endsWith("/cover.jpg")).toBe(true);
  });

  it("ensureCoverOrFallback generates a JPEG when none exists", async () => {
    const story = await createStory(dir, { title: "Test Book" });
    const path = await ensureCoverOrFallback(dir, story.slug, {
      title: "Test Book",
      author: "J. Doe",
    });
    expect(path.endsWith("/cover.jpg")).toBe(true);
    const bytes = await readFile(path);
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
  });

  it("ensureCoverOrFallback returns the existing cover if present", async () => {
    const story = await createStory(dir, { title: "T" });
    const existing = await writeCoverJpeg(
      dir,
      story.slug,
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])
    );
    const returned = await ensureCoverOrFallback(dir, story.slug, {
      title: "T",
      author: "A",
    });
    expect(returned).toBe(existing);
  });
});
```

- [ ] **Step 2: Run — expect failures**

- [ ] **Step 3: Implement**

Create `lib/publish/epub-storage.ts`:

```ts
import { mkdir, writeFile, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";
import sharp from "sharp";
import { coverPath, epubPath, exportsDir } from "@/lib/storage/paths";

export async function writeEpub(
  dataDir: string,
  slug: string,
  bytes: Uint8Array
): Promise<string> {
  const finalPath = epubPath(dataDir, slug);
  const tempPath = `${finalPath}.tmp`;
  await mkdir(exportsDir(dataDir, slug), { recursive: true });
  await writeFile(tempPath, bytes);
  await rename(tempPath, finalPath);
  return finalPath;
}

export async function writeCoverJpeg(
  dataDir: string,
  slug: string,
  jpegBytes: Buffer
): Promise<string> {
  const path = coverPath(dataDir, slug);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, jpegBytes);
  return path;
}

export async function readCoverPath(
  dataDir: string,
  slug: string
): Promise<string | null> {
  const path = coverPath(dataDir, slug);
  try {
    await stat(path);
    return path;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function ensureCoverOrFallback(
  dataDir: string,
  slug: string,
  meta: { title: string; author: string }
): Promise<string> {
  const existing = await readCoverPath(dataDir, slug);
  if (existing) return existing;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="2560" viewBox="0 0 1600 2560">
  <rect width="1600" height="2560" fill="#2a2a2a"/>
  <text x="800" y="1200" text-anchor="middle" font-family="Georgia, serif" font-size="96" fill="#f5f5f5" font-weight="600">${escapeXml(meta.title)}</text>
  <text x="800" y="1360" text-anchor="middle" font-family="Georgia, serif" font-size="56" fill="#bbbbbb" font-style="italic">${escapeXml(meta.author)}</text>
</svg>`;

  let jpeg: Buffer;
  try {
    // Happy path: sharp rasterizes the SVG via librsvg.
    jpeg = await sharp(Buffer.from(svg, "utf-8")).jpeg({ quality: 88 }).toBuffer();
  } catch {
    // Fallback: sharp binary lacks SVG support on this platform (rare, but
    // musl-based CI images sometimes ship without libvips SVG bindings).
    // Produce a solid dark-grey 1600x2560 JPEG. No title text, but a valid
    // JPEG so the EPUB build doesn't fail.
    jpeg = await sharp({
      create: {
        width: 1600,
        height: 2560,
        channels: 3,
        background: { r: 0x2a, g: 0x2a, b: 0x2a },
      },
    })
      .jpeg({ quality: 88 })
      .toBuffer();
  }

  return writeCoverJpeg(dataDir, slug, jpeg);
}
```

- [ ] **Step 4: Run — all pass**

- [ ] **Step 5: Quality gates**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add lib/publish/epub-storage.ts tests/lib/publish-epub-storage.test.ts
git commit -m "feat(publish): epub-storage — atomic writeEpub + cover fallback"
```

---

### Task 4.2: Implement `POST /api/stories/[slug]/chapters/import` route

**Files:**
- Create: `app/api/stories/[slug]/chapters/import/route.ts`
- Create: `tests/api/chapters.import.test.ts`

- [ ] **Step 1: Write failing route tests**

Create `tests/api/chapters.import.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { createStory } from "@/lib/storage/stories";
import { listChapters } from "@/lib/storage/chapters";

describe("/api/stories/[slug]/chapters/import", () => {
  const originalEnv = process.env;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scriptr-import-api-"));
    process.env = { ...originalEnv, SCRIPTR_DATA_DIR: tmpDir };
    delete process.env.XAI_API_KEY;
  });
  afterEach(async () => {
    process.env = originalEnv;
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function callPost(slug: string, body: unknown) {
    const { POST } = await import(
      "@/app/api/stories/[slug]/chapters/import/route"
    );
    const req = new Request(`http://localhost/api/stories/${slug}/chapters/import`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }) as unknown as NextRequest;
    const ctx = { params: Promise.resolve({ slug }) };
    return POST(req, ctx);
  }

  it("rejects empty paste with 400", async () => {
    const story = await createStory(tmpDir, { title: "S" });
    const res = await callPost(story.slug, { raw: "   " });
    expect(res.status).toBe(400);
  });

  it("rejects paste over 1 MB with 413", async () => {
    const story = await createStory(tmpDir, { title: "S" });
    const huge = "x".repeat(1_100_000);
    const res = await callPost(story.slug, { raw: huge });
    expect(res.status).toBe(413);
  });

  it("returns 404 for unknown story", async () => {
    const res = await callPost("nope", { raw: "some prose" });
    expect(res.status).toBe(404);
  });

  it("creates a chapter with source=imported and returns { chapter, warnings }", async () => {
    const story = await createStory(tmpDir, { title: "S" });
    const raw = [
      "Chapter 1: Opening",
      "",
      "She walked in.",
      "",
      "* * *",
      "",
      "He waited.",
    ].join("\n");
    const res = await callPost(story.slug, { raw, title: "Opening" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.chapter.source).toBe("imported");
    expect(body.data.chapter.title).toBe("Opening");
    expect(body.data.chapter.sections.length).toBe(2);
    expect(Array.isArray(body.data.warnings)).toBe(true);

    const chapters = await listChapters(tmpDir, story.slug);
    expect(chapters).toHaveLength(1);
  });

  it("does NOT leak the raw paste to any non-chapter file", async () => {
    const story = await createStory(tmpDir, { title: "S" });
    const uniqueMarker = "UNIQUE_CANARY_STRING_9f3b";
    const raw = `${uniqueMarker} prose after the canary.`;
    const res = await callPost(story.slug, { raw });
    expect(res.status).toBe(201);

    async function walk(dir: string): Promise<string[]> {
      const entries = await readdir(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) files.push(...(await walk(p)));
        else files.push(p);
      }
      return files;
    }
    const files = await walk(tmpDir);
    for (const f of files) {
      const content = await readFile(f, "utf-8").catch(() => "");
      // Canary may appear in the saved chapter prose — that's expected.
      // Failure condition: canary appearing in a non-chapter file would
      // indicate the route is logging the raw body somewhere.
      if (content.includes(uniqueMarker) && !f.includes("/chapters/")) {
        throw new Error(`raw paste leaked to non-chapter file: ${f}`);
      }
    }
  });

  it("emits cleanup warnings when input has preamble or scene breaks", async () => {
    const story = await createStory(tmpDir, { title: "S" });
    const raw = "Sure, here's the chapter:\n\nScene one.\n\n* * *\n\nScene two.";
    const res = await callPost(story.slug, { raw });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.warnings.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run — expect failures (route doesn't exist)**

- [ ] **Step 3: Implement the route**

Create `app/api/stories/[slug]/chapters/import/route.ts`:

```ts
import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api";
import { getStory } from "@/lib/storage/stories";
import { createImportedChapter } from "@/lib/storage/chapters";
import { effectiveDataDir } from "@/lib/config";
import { cleanPaste, type CleanupOptions } from "@/lib/publish/cleanup";

type Ctx = { params: Promise<{ slug: string }> };

const MAX_PASTE_BYTES = 1_000_000;

function inferTitle(raw: string): string {
  // Rule 1: "Chapter N" heading regex.
  const m = raw.match(
    /^(?:chapter|ch\.?)\s+(\d+|[ivxlcdm]+)(?:\s*[:\-\u2014.]\s*(.+))?$/im
  );
  if (m) {
    const explicit = m[2]?.trim();
    if (explicit) return explicit;
    return `Chapter ${m[1]}`;
  }
  // Rule 2: Short standalone line followed by a blank line.
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i].trim();
    const next = lines[i + 1].trim();
    if (line.length >= 3 && line.length <= 60 && next.length === 0) {
      return line;
    }
  }
  // Rule 3: First-paragraph truncation.
  const firstPara = raw.trim().split(/\n\s*\n/)[0] ?? "";
  if (firstPara.length <= 60) return firstPara;
  const trunc = firstPara.slice(0, 60);
  const lastSpace = trunc.lastIndexOf(" ");
  return (lastSpace > 20 ? trunc.slice(0, lastSpace) : trunc) + "\u2026";
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;

  const story = await getStory(effectiveDataDir(), slug);
  if (!story) return fail("story not found", 404);

  // Explicit body-size guard — Next.js does not enforce.
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

  const { sections, warnings } = cleanPaste(raw, cleanupOptions);
  if (sections.length === 0) {
    return fail("no prose detected after cleanup", 400);
  }

  const title = providedTitle ?? inferTitle(raw);
  const chapter = await createImportedChapter(effectiveDataDir(), slug, {
    title,
    sectionContents: sections,
  });

  return ok({ chapter, warnings }, { status: 201 });
}
```

- [ ] **Step 4: Run — all pass**

- [ ] **Step 5: Quality gates**

```bash
npm run typecheck && npm run lint && npm test
```

- [ ] **Step 6: Commit**

```bash
git add app/api/stories/\[slug\]/chapters/import/route.ts tests/api/chapters.import.test.ts
git commit -m "feat(api): POST /stories/[slug]/chapters/import"
```

---

### Task 4.3: Implement `PUT /api/stories/[slug]/cover` route

**Files:**
- Create: `app/api/stories/[slug]/cover/route.ts`
- Create: `tests/api/cover.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/api/cover.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { createStory } from "@/lib/storage/stories";
import { coverPath } from "@/lib/storage/paths";

describe("/api/stories/[slug]/cover PUT", () => {
  const originalEnv = process.env;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scriptr-cover-api-"));
    process.env = { ...originalEnv, SCRIPTR_DATA_DIR: tmpDir };
  });
  afterEach(async () => {
    process.env = originalEnv;
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function callPut(slug: string, file: Blob, fieldName = "cover") {
    const { PUT } = await import("@/app/api/stories/[slug]/cover/route");
    const form = new FormData();
    form.append(fieldName, file, "cover.jpg");
    const req = new Request(`http://localhost/api/stories/${slug}/cover`, {
      method: "PUT",
      body: form,
    }) as unknown as NextRequest;
    const ctx = { params: Promise.resolve({ slug }) };
    return PUT(req, ctx);
  }

  it("returns 404 for unknown story", async () => {
    const jpg = new Blob([Buffer.from([0xff, 0xd8, 0xff])], { type: "image/jpeg" });
    const res = await callPut("nope", jpg);
    expect(res.status).toBe(404);
  });

  it("rejects non-image MIME with 415", async () => {
    const story = await createStory(tmpDir, { title: "S" });
    const txt = new Blob(["hello"], { type: "text/plain" });
    const res = await callPut(story.slug, txt);
    expect(res.status).toBe(415);
  });

  it("rejects over-10MB with 413", async () => {
    const story = await createStory(tmpDir, { title: "S" });
    const huge = new Uint8Array(11 * 1024 * 1024);
    huge[0] = 0xff; huge[1] = 0xd8; huge[2] = 0xff;
    const blob = new Blob([huge], { type: "image/jpeg" });
    const res = await callPut(story.slug, blob);
    expect(res.status).toBe(413);
  });

  it("writes cover.jpg and returns 200", async () => {
    const story = await createStory(tmpDir, { title: "S" });
    const jpg = new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])], {
      type: "image/jpeg",
    });
    const res = await callPut(story.slug, jpg);
    expect(res.status).toBe(200);
    const statResult = await stat(coverPath(tmpDir, story.slug));
    expect(statResult.isFile()).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect failures**

- [ ] **Step 3: Implement**

Create `app/api/stories/[slug]/cover/route.ts`:

```ts
import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api";
import { getStory } from "@/lib/storage/stories";
import { effectiveDataDir } from "@/lib/config";
import { writeCoverJpeg } from "@/lib/publish/epub-storage";
import sharp from "sharp";

type Ctx = { params: Promise<{ slug: string }> };

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED = new Set(["image/jpeg", "image/png"]);

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;

  const story = await getStory(effectiveDataDir(), slug);
  if (!story) return fail("story not found", 404);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("expected multipart/form-data body");
  }

  const entry = form.get("cover");
  if (!(entry instanceof File)) {
    return fail("missing 'cover' field");
  }
  if (!ACCEPTED.has(entry.type)) {
    return fail(`unsupported image type: ${entry.type}`, 415);
  }
  if (entry.size > MAX_BYTES) {
    return fail("cover exceeds 10 MB limit", 413);
  }

  const inputBytes = Buffer.from(await entry.arrayBuffer());
  const jpegBytes =
    entry.type === "image/jpeg"
      ? inputBytes
      : await sharp(inputBytes).jpeg({ quality: 92 }).toBuffer();

  const path = await writeCoverJpeg(effectiveDataDir(), slug, jpegBytes);

  const warnings: string[] = [];
  try {
    const meta = await sharp(jpegBytes).metadata();
    if ((meta.width ?? 0) < 1600 || (meta.height ?? 0) < 2560) {
      warnings.push(
        `Cover is ${meta.width}x${meta.height}; KDP recommends at least 1600x2560.`
      );
    }
  } catch {
    /* ignore metadata failures */
  }

  return ok({ path, warnings });
}
```

- [ ] **Step 4: Run — all pass**

- [ ] **Step 5: Commit**

```bash
git add app/api/stories/\[slug\]/cover/route.ts tests/api/cover.test.ts
git commit -m "feat(api): PUT /stories/[slug]/cover"
```

---

### Task 4.4: Implement `POST /api/stories/[slug]/export/epub` route

**Files:**
- Create: `app/api/stories/[slug]/export/epub/route.ts`
- Create: `tests/api/export.epub.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/api/export.epub.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { createStory } from "@/lib/storage/stories";
import { createImportedChapter } from "@/lib/storage/chapters";
import { epubPath } from "@/lib/storage/paths";

describe("/api/stories/[slug]/export/epub POST", () => {
  const originalEnv = process.env;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scriptr-export-api-"));
    process.env = { ...originalEnv, SCRIPTR_DATA_DIR: tmpDir };
  });
  afterEach(async () => {
    process.env = originalEnv;
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function callPost(slug: string) {
    const { POST } = await import("@/app/api/stories/[slug]/export/epub/route");
    const req = new Request(`http://localhost/api/stories/${slug}/export/epub`, {
      method: "POST",
    }) as unknown as NextRequest;
    const ctx = { params: Promise.resolve({ slug }) };
    return POST(req, ctx);
  }

  it("returns 404 for unknown story", async () => {
    const res = await callPost("nope");
    expect(res.status).toBe(404);
  });

  it("returns 400 when story has no chapters", async () => {
    const story = await createStory(tmpDir, { title: "Empty" });
    const res = await callPost(story.slug);
    expect(res.status).toBe(400);
  });

  it("builds and writes an EPUB file, returns path + bytes + warnings", async () => {
    const story = await createStory(tmpDir, { title: "Book" });
    await createImportedChapter(tmpDir, story.slug, {
      title: "One",
      sectionContents: ["Hello, world."],
    });
    const res = await callPost(story.slug);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.path).toBe(epubPath(tmpDir, story.slug));
    expect(body.data.bytes).toBeGreaterThan(500);
    expect(Array.isArray(body.data.warnings)).toBe(true);
    const s = await stat(body.data.path);
    expect(s.isFile()).toBe(true);
  });

  it("is idempotent — re-running overwrites the previous .epub", async () => {
    const story = await createStory(tmpDir, { title: "Book" });
    await createImportedChapter(tmpDir, story.slug, {
      title: "One",
      sectionContents: ["Hi."],
    });
    const first = await callPost(story.slug);
    expect(first.status).toBe(200);
    const second = await callPost(story.slug);
    expect(second.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run — expect failures**

- [ ] **Step 3: Implement**

Create `app/api/stories/[slug]/export/epub/route.ts`:

```ts
import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api";
import { getStory } from "@/lib/storage/stories";
import { listChapters } from "@/lib/storage/chapters";
import { effectiveDataDir } from "@/lib/config";
import { buildEpubBytes, validateEpub } from "@/lib/publish/epub";
import { ensureCoverOrFallback, writeEpub } from "@/lib/publish/epub-storage";

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  const dataDir = effectiveDataDir();

  const story = await getStory(dataDir, slug);
  if (!story) return fail("story not found", 404);

  const chapters = await listChapters(dataDir, slug);
  if (chapters.length === 0) {
    return fail("story has no chapters to export", 400);
  }

  const coverPath = await ensureCoverOrFallback(dataDir, slug, {
    title: story.title,
    author: story.authorPenName,
  });

  const bytes = await buildEpubBytes({ story, chapters, coverPath });
  const { warnings: validationWarnings } = await validateEpub(bytes);
  const path = await writeEpub(dataDir, slug, bytes);

  return ok({ path, bytes: bytes.byteLength, warnings: validationWarnings });
}
```

- [ ] **Step 4: Run — all pass**

- [ ] **Step 5: Quality gates + privacy smoke**

```bash
npm run typecheck && npm run lint && npm test
npm test -- tests/privacy/no-external-egress.test.ts
```

All green. If the privacy smoke fails, one of the new routes is calling `fetch` — trace and fix the route, NOT the test.

- [ ] **Step 6: Commit**

```bash
git add app/api/stories/\[slug\]/export/epub/route.ts tests/api/export.epub.test.ts
git commit -m "feat(api): POST /stories/[slug]/export/epub"
```

---

## Chunk 5: Import UI

Three-pane dialog. Live cleanup + live preview via the pure `cleanPaste` + `renderChapterPreviewHtml` running client-side. Save calls the import route; if recap opt-in is checked, the client fires a follow-up to `/api/generate/recap`.

### Task 5.1: Implement `SafeHtml` helper

A one-file wrapper around React's HTML-injection API. **Every HTML-injection site in this plan uses this component.** No raw `dangerouslySetInnerHTML` anywhere in `components/publish/**`.

**Files:**
- Create: `lib/publish/safe-html.tsx`

- [ ] **Step 1: Write the component**

Create `lib/publish/safe-html.tsx`:

```tsx
"use client";

import DOMPurify from "isomorphic-dompurify";

type Props = {
  html: string;
  className?: string;
};

/**
 * Render trusted HTML through DOMPurify as a defense-in-depth layer. The
 * HTML arriving here is already produced by renderChapterPreviewHtml, which
 * entity-escapes raw text before adding tags — so the sanitizer should
 * never actually remove anything in normal operation. Its job is to catch
 * regressions: if a future transformer bug emits a <script> or onclick
 * attribute, the sanitizer strips it before it reaches the DOM.
 */
export function SafeHtml({ html, className }: Props) {
  const clean = DOMPurify.sanitize(html, {
    // Allowlist: the exact set of tags and classes the transformer emits.
    ALLOWED_TAGS: ["div", "h1", "p", "strong", "em", "span"],
    ALLOWED_ATTR: ["class"],
  });
  return (
    <div
      className={className}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
```

- [ ] **Step 2: Quality gates**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors. The `eslint-disable-next-line` is intentional — this is the one controlled injection point in the codebase, and every other component renders through `SafeHtml` so there are no others to lint.

- [ ] **Step 3: Commit**

```bash
git add lib/publish/safe-html.tsx
git commit -m "feat(publish): SafeHtml — sanitized injection via DOMPurify"
```

---

### Task 5.2: Scaffold `ImportChapterDialog.tsx`

**Files:**
- Create: `components/publish/ImportChapterDialog.tsx`

- [ ] **Step 1: Read existing dialog patterns**

Read [components/library/NewStoryDialog.tsx](../../../components/library/NewStoryDialog.tsx) to understand how dialogs are constructed in this project (shadcn / base-ui primitives, state, toast). Mirror that pattern. If shadcn `Dialog`, `Checkbox`, `Button`, `Textarea`, `Input` primitives exist in [components/ui/](../../../components/ui/), use them throughout — the snippet below uses raw HTML for portability; swap in the real primitives before committing.

- [ ] **Step 2: Create the component**

Create `components/publish/ImportChapterDialog.tsx`:

```tsx
"use client";

import { useMemo, useState, useCallback } from "react";
import { toast } from "sonner";
import { cleanPaste, type CleanupOptions } from "@/lib/publish/cleanup";
import { renderChapterPreviewHtml, EPUB_STYLESHEET } from "@/lib/publish/epub";
import { SafeHtml } from "@/lib/publish/safe-html";
import type { Chapter } from "@/lib/types";

type Props = {
  slug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (chapter: Chapter) => void;
};

type DraftOptions = Required<CleanupOptions>;

const DEFAULT_OPTIONS: DraftOptions = {
  normalizeLineEndings: true,
  stripChatCruft: true,
  trimTrailingWhitespace: true,
  collapseInternalSpaces: true,
  normalizeQuotes: true,
  normalizeSceneBreaks: true,
  normalizeDashes: true,
  preserveMarkdownEmphasis: true,
  collapseBlankLines: true,
  splitIntoSections: true,
};

export function ImportChapterDialog({
  slug,
  open,
  onOpenChange,
  onImported,
}: Props) {
  const [raw, setRaw] = useState("");
  const [title, setTitle] = useState("");
  const [options, setOptions] = useState<DraftOptions>(DEFAULT_OPTIONS);
  const [generateRecap, setGenerateRecap] = useState(false);
  const [saving, setSaving] = useState(false);

  const cleaned = useMemo(() => cleanPaste(raw, options), [raw, options]);

  const previewChapter: Chapter | null = useMemo(() => {
    if (cleaned.sections.length === 0) return null;
    return {
      id: "preview",
      title: title || "Untitled",
      summary: "",
      beats: [],
      prompt: "",
      recap: "",
      sections: cleaned.sections.map((c, i) => ({ id: `p${i}`, content: c })),
      wordCount: 0,
    };
  }, [cleaned, title]);

  const previewHtml = useMemo(
    () => (previewChapter ? renderChapterPreviewHtml(previewChapter) : ""),
    [previewChapter]
  );

  const handleSave = useCallback(async () => {
    if (!raw.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/stories/${slug}/chapters/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          raw,
          cleanupOptions: options,
          title: title || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        toast.error(body.error ?? `Import failed (${res.status})`);
        return;
      }
      const chapter = body.data.chapter as Chapter;
      toast.success(`Imported "${chapter.title}".`);
      onImported(chapter);

      if (generateRecap) {
        // Fire-and-forget; recap runs async via existing route.
        // IMPORTANT: before committing, open app/api/generate/recap/route.ts
        // and confirm the POST body shape matches. The MVP uses
        // { storySlug, chapterId } (see tests/api/generate.recap.test.ts);
        // adjust here if the route has since changed its request contract.
        fetch("/api/generate/recap", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ storySlug: slug, chapterId: chapter.id }),
        }).catch(() => {
          toast.error("Recap failed to start; you can regenerate later.");
        });
      }

      onOpenChange(false);
      setRaw("");
      setTitle("");
    } finally {
      setSaving(false);
    }
  }, [raw, options, title, slug, generateRecap, onImported, onOpenChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-stretch justify-center">
      <div className="bg-background border border-border rounded w-full max-w-[1400px] m-4 flex flex-col">
        <div className="border-b border-border px-4 py-2 text-sm font-semibold">
          Import chapter from paste
        </div>
        <div className="grid grid-cols-[1fr_280px_1fr] flex-1 min-h-0">
          <div className="p-4 border-r border-border flex flex-col gap-2">
            <div className="text-xs uppercase text-muted-foreground">
              Paste raw prose
            </div>
            <textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              className="flex-1 font-mono text-xs p-2 bg-muted rounded resize-none"
              placeholder="Paste a chapter from Grok web UI here."
              data-testid="import-paste"
            />
          </div>

          <div className="p-4 bg-muted/30 border-r border-border overflow-auto flex flex-col gap-4">
            <div>
              <div className="text-xs uppercase text-muted-foreground mb-2">
                Cleanup
              </div>
              <div className="flex flex-col gap-1 text-xs">
                {(
                  [
                    ["stripChatCruft", "Strip chat cruft"],
                    ["normalizeQuotes", "Curly quotes"],
                    ["normalizeDashes", "Em-dashes"],
                    ["normalizeSceneBreaks", "Normalize scene breaks"],
                    ["collapseBlankLines", "Collapse blank lines"],
                    ["preserveMarkdownEmphasis", "Preserve markdown emphasis"],
                  ] as [keyof DraftOptions, string][]
                ).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={options[key]}
                      onChange={(e) =>
                        setOptions((prev) => ({
                          ...prev,
                          [key]: e.target.checked,
                        }))
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            {cleaned.warnings.length > 0 && (
              <div>
                <div className="text-xs uppercase text-muted-foreground mb-1">
                  Warnings
                </div>
                <ul className="text-xs text-muted-foreground flex flex-col gap-0.5">
                  {cleaned.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <label className="text-xs text-muted-foreground">
                Chapter title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="border border-border rounded px-2 py-1 text-sm bg-background"
                placeholder="Auto-detected if blank"
                data-testid="import-title"
              />
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={generateRecap}
                  onChange={(e) => setGenerateRecap(e.target.checked)}
                />
                Generate recap via Grok (sends prose to xAI)
              </label>
            </div>
          </div>

          <div className="p-4 flex flex-col gap-2 overflow-auto">
            <div className="text-xs uppercase text-muted-foreground">
              EPUB preview
            </div>
            <style>{EPUB_STYLESHEET}</style>
            <SafeHtml
              html={previewHtml}
              className="flex-1 overflow-auto border border-border rounded p-4 bg-background"
            />
            <div className="text-xs text-muted-foreground">
              {cleaned.sections.length} section
              {cleaned.sections.length === 1 ? "" : "s"}
            </div>
          </div>
        </div>

        <div className="border-t border-border px-4 py-3 flex justify-end gap-2">
          <button
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="px-4 py-1.5 text-sm border border-border rounded hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !raw.trim()}
            className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded disabled:opacity-50"
            data-testid="import-save"
          >
            {saving ? "Saving\u2026" : "Save chapter"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Quality gates**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors. (No component tests yet — the E2E in Chunk 7 covers behavior.)

- [ ] **Step 4: Commit**

```bash
git add components/publish/ImportChapterDialog.tsx
git commit -m "feat(publish): ImportChapterDialog three-pane UI"
```

---

### Task 5.3: Wire "Import chapter" button into `ChapterList.tsx`

**Files:**
- Modify: `components/editor/ChapterList.tsx`

- [ ] **Step 1: Read the existing component**

Read [components/editor/ChapterList.tsx](../../../components/editor/ChapterList.tsx) fully. Identify the "New chapter" button and note its surrounding layout. The "Import chapter" button lives next to it.

- [ ] **Step 2: Add state + dialog + button**

Three additive edits — do NOT restructure the file:

1. Imports:

```tsx
import { useState } from "react";
import { ImportChapterDialog } from "@/components/publish/ImportChapterDialog";
```

(If `useState` already imported, skip.)

2. State:

```tsx
const [importOpen, setImportOpen] = useState(false);
```

3. Next to the "New chapter" button:

```tsx
<button
  onClick={() => setImportOpen(true)}
  className="..." // match existing button class signature
>
  Import chapter
</button>

<ImportChapterDialog
  slug={slug}  // wire from existing props
  open={importOpen}
  onOpenChange={setImportOpen}
  onImported={() => {
    // Trigger a chapter-list refresh.
    // ChapterList uses SWR keyed on `/api/stories/${slug}/chapters` —
    // call `mutate()` from that SWR hook to re-fetch. If ChapterList
    // doesn't expose mutate directly, lift the callback to the parent
    // that holds the SWR hook. `router.refresh()` from next/navigation
    // is a portable fallback but triggers a full server re-render.
  }}
/>
```

Exact refresh mechanism: open the file and find the existing SWR call — typical pattern:

```tsx
const { data, mutate } = useSWR<Chapter[]>(`/api/stories/${slug}/chapters`, fetcher);
// …
onImported={() => mutate()}
```

If no SWR hook exists in ChapterList (e.g. the chapter list comes from a server-rendered prop), fall back to `router.refresh()` from `next/navigation`.

- [ ] **Step 3: Manual smoke**

```bash
npm run dev
```

Open `http://127.0.0.1:3000`, navigate to a story, click "Import chapter", paste a short block, toggle options, verify preview updates live, save, confirm chapter appears.

- [ ] **Step 4: Quality gates**

```bash
npm run typecheck && npm run lint && npm test
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add components/editor/ChapterList.tsx
git commit -m "feat(editor): wire Import chapter button + dialog into ChapterList"
```

---

## Chunk 6: Export UI

Metadata form, cover upload, build button. One server page, one client component.

### Task 6.1: Create the export server page

**Files:**
- Create: `app/s/[slug]/export/page.tsx`

- [ ] **Step 1: Write the server component**

Create `app/s/[slug]/export/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { effectiveDataDir } from "@/lib/config";
import { getStory } from "@/lib/storage/stories";
import { listChapters } from "@/lib/storage/chapters";
import { ExportPage } from "@/components/publish/ExportPage";

type Params = { params: Promise<{ slug: string }> };

export default async function Page({ params }: Params) {
  const { slug } = await params;
  const dataDir = effectiveDataDir();
  const [story, chapters] = await Promise.all([
    getStory(dataDir, slug),
    listChapters(dataDir, slug),
  ]);
  if (!story) notFound();
  const wordCount = chapters.reduce((a, c) => a + c.wordCount, 0);
  return (
    <ExportPage
      story={story}
      chapterCount={chapters.length}
      wordCount={wordCount}
    />
  );
}
```

Mirror whatever server-component conventions [app/s/[slug]/read/page.tsx](../../../app/s/[slug]/read/page.tsx) uses for story loading and error handling.

- [ ] **Step 2: Skip gates (page won't build until Task 6.2 creates `ExportPage`)**

Commit combined with Task 6.2.

---

### Task 6.2: Implement `ExportPage.tsx`

**Files:**
- Create: `components/publish/ExportPage.tsx`

- [ ] **Step 1: Write the component**

Create `components/publish/ExportPage.tsx`:

```tsx
"use client";

import { useState, useRef } from "react";
import { toast } from "sonner";
import type { Story } from "@/lib/types";

type Props = {
  story: Story;
  chapterCount: number;
  wordCount: number;
};

type LastBuild = { path: string; bytes: number; warnings: string[] };

export function ExportPage({ story, chapterCount, wordCount }: Props) {
  const [draft, setDraft] = useState<Story>(story);
  const [saving, setSaving] = useState(false);
  const [building, setBuilding] = useState(false);
  const [lastBuild, setLastBuild] = useState<LastBuild | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const patch = async (fields: Partial<Story>) => {
    setSaving(true);
    try {
      // Existing stories route exports PATCH (not PUT); use it as-is.
      const res = await fetch(`/api/stories/${story.slug}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(fields),
      });
      const body = await res.json();
      if (!body.ok) toast.error(body.error ?? "Save failed");
      else setDraft((d) => ({ ...d, ...fields }));
    } finally {
      setSaving(false);
    }
  };

  const handleBlur = <K extends keyof Story>(key: K, value: Story[K]) => {
    if (draft[key] === value) return;
    void patch({ [key]: value } as Partial<Story>);
  };

  const handleCoverSelect = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append("cover", file);
    const res = await fetch(`/api/stories/${story.slug}/cover`, {
      method: "PUT",
      body: form,
    });
    const body = await res.json();
    if (!body.ok) {
      toast.error(body.error ?? "Cover upload failed");
      return;
    }
    if (body.data.warnings?.length) {
      toast.warning(body.data.warnings.join(" "));
    } else {
      toast.success("Cover uploaded.");
    }
  };

  const handleBuild = async () => {
    setBuilding(true);
    try {
      const res = await fetch(`/api/stories/${story.slug}/export/epub`, {
        method: "POST",
      });
      const body = await res.json();
      if (!body.ok) {
        toast.error(body.error ?? "Build failed");
        return;
      }
      setLastBuild(body.data);
      toast.success("EPUB built.");
    } finally {
      setBuilding(false);
    }
  };

  const canBuild =
    draft.title.trim() !== "" &&
    draft.authorPenName.trim() !== "" &&
    draft.description.trim() !== "" &&
    chapterCount > 0 &&
    !building;

  return (
    <div className="max-w-5xl mx-auto p-6 grid grid-cols-[1fr_340px] gap-8">
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold">Book metadata</h1>

        <Field label="Title">
          <input
            type="text"
            defaultValue={draft.title}
            onBlur={(e) => handleBlur("title", e.target.value)}
          />
        </Field>
        <Field label="Subtitle (optional)">
          <input
            type="text"
            defaultValue={draft.subtitle ?? ""}
            onBlur={(e) => handleBlur("subtitle", e.target.value)}
          />
        </Field>
        <Field label="Author pen name">
          <input
            type="text"
            defaultValue={draft.authorPenName}
            onBlur={(e) => handleBlur("authorPenName", e.target.value)}
          />
        </Field>
        <Field label="Description / blurb">
          <textarea
            defaultValue={draft.description}
            rows={4}
            onBlur={(e) => handleBlur("description", e.target.value)}
            data-testid="export-description"
          />
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Copyright year">
            <input
              type="number"
              defaultValue={draft.copyrightYear}
              onBlur={(e) =>
                handleBlur(
                  "copyrightYear",
                  Number(e.target.value) || draft.copyrightYear
                )
              }
            />
          </Field>
          <Field label="Language">
            <input
              type="text"
              defaultValue={draft.language}
              onBlur={(e) => handleBlur("language", e.target.value)}
            />
          </Field>
          <Field label="ISBN (optional)">
            <input
              type="text"
              defaultValue={draft.isbn ?? ""}
              onBlur={(e) => handleBlur("isbn", e.target.value || undefined)}
            />
          </Field>
        </div>
        <Field label="BISAC category">
          <input
            type="text"
            defaultValue={draft.bisacCategory}
            onBlur={(e) => handleBlur("bisacCategory", e.target.value)}
          />
        </Field>
        <Field label="Keywords (comma-separated, up to 7)">
          <input
            type="text"
            defaultValue={draft.keywords.join(", ")}
            onBlur={(e) =>
              handleBlur(
                "keywords",
                e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .slice(0, 7)
              )
            }
          />
        </Field>
        {saving ? (
          <div className="text-xs text-muted-foreground">Saving\u2026</div>
        ) : null}
      </div>

      <div className="flex flex-col gap-5">
        <div>
          <h2 className="text-sm font-semibold mb-2">Cover image</h2>
          <div
            className="border border-dashed border-border rounded aspect-[2/3] max-w-[240px] flex items-center justify-center bg-muted text-xs text-muted-foreground text-center p-4 cursor-pointer"
            onClick={() => fileRef.current?.click()}
          >
            Drop JPEG/PNG here or click to choose.
            <br />
            1600\u00d72560 recommended.
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png"
            onChange={handleCoverSelect}
            className="hidden"
          />
          <div className="text-xs text-muted-foreground mt-1">
            2:3 ratio, \u226410 MB
          </div>
        </div>

        <div className="border-t border-border pt-4">
          <h2 className="text-sm font-semibold mb-1">Build</h2>
          <div className="text-xs text-muted-foreground mb-2">
            {chapterCount} chapter{chapterCount === 1 ? "" : "s"} \u00b7{" "}
            {wordCount.toLocaleString()} words
          </div>
          <button
            onClick={handleBuild}
            disabled={!canBuild}
            className="w-full bg-primary text-primary-foreground rounded py-1.5 text-sm disabled:opacity-50"
            data-testid="export-build"
          >
            {building ? "Building\u2026" : "Build EPUB"}
          </button>
        </div>

        {lastBuild && (
          <div className="rounded border border-green-700 bg-green-950/40 p-3 text-xs text-green-200">
            <div>\u2713 Built {(lastBuild.bytes / 1024).toFixed(0)} KB</div>
            <div className="font-mono text-green-300 break-all mt-1">
              {lastBuild.path}
            </div>
            {lastBuild.warnings.length > 0 && (
              <details className="mt-2">
                <summary>{lastBuild.warnings.length} warning(s)</summary>
                <ul className="mt-1 text-green-300">
                  {lastBuild.warnings.map((w, i) => (
                    <li key={i}>\u00b7 {w}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
```

**CRITICAL — Unicode escapes in JSX text are rendered LITERALLY.** The snippet above contains sequences like `Saving\u2026`, `1600\u00d72560`, `\u2713 Built`, `\u00b7 {w}` written directly as JSX text. TypeScript / React does NOT interpret `\u2026` inside a bare JSX text node — users would see the literal six-character sequence `\u2026` on screen, not an ellipsis. Fix pattern: either paste the literal character (`…`, `×`, `✓`, `·`) or wrap the string in `{"\u2026"}`.

**Concrete pre-commit verification step** (do not skip):

```bash
grep -nE '>\s*[^<{]*\\u[0-9a-fA-F]{4}' components/publish/ExportPage.tsx
```

Expected output: empty. If any line matches, there is still an un-escaped `\uXXXX` sitting in a JSX text node — replace with the literal character or `{"\uXXXX"}`. Re-run grep until empty before committing.

Character reference:
- `\u2026` → `…` (horizontal ellipsis)
- `\u00d7` → `×` (multiplication sign)
- `\u2713` → `✓` (check mark)
- `\u00b7` → `·` (middle dot)

Use shadcn `Input`, `Textarea`, `Button`, `Field` primitives from [components/ui/](../../../components/ui/) if available — swap in before committing.

- [ ] **Step 2: Verify `PATCH /api/stories/[slug]` accepts the metadata fields**

Read [app/api/stories/[slug]/route.ts](../../../app/api/stories/[slug]/route.ts) and confirm the exported handler is `PATCH` (it is — not `PUT`). Confirm it accepts every field the form uses: `title`, `subtitle`, `authorPenName`, `description`, `copyrightYear`, `language`, `isbn`, `bisacCategory`, `keywords`. If there's an `allowed` list that omits any, extend it. If a field is missing, add a corresponding test in [tests/api/stories.slug.test.ts](../../../tests/api/stories.slug.test.ts) asserting round-trip.

**Important:** The snippet uses `method: "PATCH"`. Do NOT change it to `PUT`; the route does not export a `PUT` handler and every autosave would 405.

- [ ] **Step 3: Quality gates**

```bash
npm run typecheck && npm run lint && npm test
```

- [ ] **Step 4: Manual smoke**

```bash
npm run dev
```

Navigate to `/s/<slug>/export`. Edit a field → blur → check `data/stories/<slug>/story.json` updates. Upload a JPEG cover → check `data/stories/<slug>/cover.jpg`. Click Build EPUB → check `data/stories/<slug>/exports/<slug>.epub`. Open the `.epub` in Calibre / Apple Books / Kindle Previewer — verify cover shows, chapters titled correctly, scene breaks render as centered `* * *`, curly quotes and em-dashes display.

- [ ] **Step 5: Commit**

```bash
git add app/s/\[slug\]/export/page.tsx components/publish/ExportPage.tsx
git commit -m "feat(publish): ExportPage with metadata form + cover + build"
```

If Step 2 required a route edit:

```bash
git add app/api/stories/\[slug\]/route.ts tests/api/stories.slug.test.ts
git commit -m "feat(api): extend PUT /stories/[slug] to accept publishing metadata fields"
```

---

### Task 6.3: Add the Export nav link

**Files:**
- Modify: whichever component renders the "Read" link on the story page (likely [components/editor/NavPane.tsx](../../../components/editor/NavPane.tsx) or similar)

- [ ] **Step 1: Find the existing "Read" link**

Use Grep to find `Link href={`/s/${slug}/read`}` (or equivalent). That component is where the new Export link goes.

- [ ] **Step 2: Add the Export link as a sibling**

```tsx
<Link href={`/s/${slug}/export`}>Export</Link>
```

Style it to match the Read link.

- [ ] **Step 3: Manual smoke**

Navigate to a story; confirm both "Read" and "Export" links visible and click correctly.

- [ ] **Step 4: Quality gates + commit**

```bash
npm run typecheck && npm run lint && npm test
git add <the component you modified>
git commit -m "feat(nav): add Export link next to Read on story page"
```

---

## Chunk 7: E2E + privacy + docs + final quality gates

### Task 7.1: Playwright spec for the full import → export flow

**Files:**
- Create: `tests/e2e/publishing-kit.spec.ts`

- [ ] **Step 1: Read the existing e2e setup**

Read [tests/e2e/golden-path.spec.ts](../../../tests/e2e/golden-path.spec.ts) in full. Note:
- Isolated dev server (`SCRIPTR_DATA_DIR=/tmp/scriptr-e2e`, port 3001, `reuseExistingServer: false`).
- Canned SSE stub for Grok.
- Navigation + assertion patterns.

- [ ] **Step 2: Write the spec**

Create `tests/e2e/publishing-kit.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const SAMPLE_PASTE = `Sure, here's the chapter:

Chapter 1: Opening

She walked in -- slowly -- and said "hi."

* * *

He replied, 'later.'

Let me know what you think!`;

test("import paste \u2192 preview \u2192 save \u2192 export EPUB on disk", async ({ page }) => {
  const DATA_DIR = process.env.SCRIPTR_DATA_DIR!;
  expect(DATA_DIR).toBeTruthy();

  // Seed a story via the API.
  const createRes = await page.request.post(
    "http://127.0.0.1:3001/api/stories",
    { data: { title: "Publishing Kit E2E", authorPenName: "Test Author" } }
  );
  expect(createRes.ok()).toBeTruthy();
  const { data: story } = await createRes.json();

  await page.goto(`http://127.0.0.1:3001/s/${story.slug}`);

  await page.getByRole("button", { name: /import chapter/i }).click();

  await page.getByTestId("import-paste").fill(SAMPLE_PASTE);

  // Preview populated — scope to .epub-preview since "Chapter 1" also
  // appears in the paste textarea (raw source) which would make the
  // locator ambiguous.
  const preview = page.locator(".epub-preview").first();
  await expect(preview).toContainText("Chapter 1");
  await expect(preview).toContainText("\u2014");

  await page.getByTestId("import-save").click();

  // Chapter appears in list
  await expect(page.getByText(/Opening/)).toBeVisible();

  // Navigate to export
  await page.goto(`http://127.0.0.1:3001/s/${story.slug}/export`);

  const descField = page.getByTestId("export-description");
  await descField.fill("A tiny end-to-end test book.");
  await descField.blur();

  await page.getByTestId("export-build").click();

  // Success UI
  await expect(page.getByText(/Built \d+ KB/)).toBeVisible({ timeout: 15_000 });

  // File on disk
  const epubPath = join(
    DATA_DIR,
    "stories",
    story.slug,
    "exports",
    `${story.slug}.epub`
  );
  expect(existsSync(epubPath)).toBe(true);
});
```

- [ ] **Step 3: Run the spec**

```bash
npm run e2e -- tests/e2e/publishing-kit.spec.ts
```

Expected: PASS. Test runs against the same isolated dev server as the golden path.

If a selector is brittle, add / fix `data-testid` attributes on the component — do not loosen the test by fuzzy-matching.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/publishing-kit.spec.ts
git commit -m "test(e2e): import paste \u2192 save \u2192 export EPUB end-to-end"
```

---

### Task 7.2: Verify the privacy smoke test passes

- [ ] **Step 1: Run**

```bash
npm test -- tests/privacy/no-external-egress.test.ts
```

Expected: PASS. The test boots every non-generate route in-process, stubs `globalThis.fetch`, and asserts the recorded URL list is empty.

If the test FAILS and the failure names `chapters/import`, `cover`, or `export/epub`, the route is accidentally calling `fetch` — find it and remove it. **Do not add routes to the exemption list** — that defeats the guardrail.

- [ ] **Step 2: Commit any fix**

Only if a fix was required:

```bash
git commit -m "fix(publish): restore local-only invariant"
```

---

### Task 7.3: Update the README privacy section

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Find the enforcement list**

Read [README.md](../../../README.md) §"Privacy — what this app sends externally, and to whom". Locate the numbered "Concrete enforcement" list.

- [ ] **Step 2: Add one bullet**

```markdown
11. **Publishing Kit is local-only.** Paste-import, cover upload, and EPUB export all run entirely on your machine. No paste, cover image, or exported file is ever sent over the network.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): note Publishing Kit is local-only"
```

---

### Task 7.4: Final full quality gates + manual acceptance

- [ ] **Step 1: Run every gate**

```bash
npm run typecheck
npm run lint
npm test
npm run e2e
```

Every one: 0 errors / all green. If any gate fails, loop back and fix the root cause.

- [ ] **Step 2: Manual acceptance walk-through**

```bash
npm run dev
```

Open `http://127.0.0.1:3000`. Walk the complete user journey:

1. Create a new story.
2. Click "Import chapter" — paste a Grok-style block with preamble, em-dash intent, scene break, sign-off. Verify preview renders clean typography, warnings populate, scene break splits into two sections. Save.
3. Repeat for a second chapter (multi-chapter book).
4. Navigate to Export (new link).
5. Fill missing metadata (description at minimum).
6. Upload a cover JPEG/PNG — confirm `data/stories/<slug>/cover.jpg` exists.
7. Click Build EPUB. Open the resulting `.epub` in Calibre / Apple Books / Kindle Previewer. Verify: cover shows; chapter titles correct; scene breaks render as centered `* * *`; em-dashes + curly quotes display.
8. Re-build without changes — confirm second build succeeds (file mtime changes).

- [ ] **Step 3: If everything passes, tag**

```bash
git tag -a v0.2.0-publishing-kit -m "Publishing Kit v1: paste-import + EPUB export"
```

- [ ] **Step 4: Update the memory checkpoint**

If you have auto-memory, note in a memory file that Publishing Kit v1 shipped, what it does, what it defers (DOCX, PDF, multi-chapter paste), and the resolved `epubcheck-wasm` / `epub-gen-memory` API shapes. Reference the tag so future sessions can verify with `git tag --list`.

- [ ] **Step 5: Follow-up loop**

During acceptance you may notice out-of-scope issues (cover UX clumsy, BISAC text input would be nicer as dropdown, etc.). List them in a follow-up note rather than patching here. The plan is scoped to "paste-to-EPUB ships"; polish and v2 features go in their own plan.

---

## Summary

After executing all 7 chunks:

- **New modules:** `lib/publish/cleanup.ts`, `lib/publish/epub.ts`, `lib/publish/epub-storage.ts`, `lib/publish/safe-html.tsx` — all pure or thinly-I/O-wrapped.
- **New routes:** 3 local-only POST / PUT handlers under `app/api/stories/[slug]/`.
- **New UI:** one dialog component, one export page + server component, two nav tweaks.
- **New tests:** ~5 unit files, 3 route files, 1 e2e file — each following the project's established conventions.
- **Zero new external egress.** Privacy smoke test passes untouched.
- **Public artifacts:** `data/stories/<slug>/cover.jpg`, `data/stories/<slug>/exports/<slug>.epub`, both gitignored under `data/`.

The user can now paste from Grok's web UI, clean up the chapter, and produce an EPUB ready for upload to Amazon KDP or Smashwords — entirely on their local machine.
