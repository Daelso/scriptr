# Copy Prompt for Web UI Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a **Copy prompt** action in the chapter editor that exports the exact full-chapter prompt scriptr would send to the Grok API, so the user can paste it into the Grok web UI (free) instead of paying for API access.

**Architecture:** Extract the priorRecaps / lastChapterFullText assembly from the generate route into a shared server helper (`lib/prompt-assembly.ts`). Add a read-only GET route `/api/stories/[slug]/chapters/[id]/prompt` that returns `{system, user, meta}`. Refactor the generate route's `handleFull` to call the same helper — guaranteeing byte-identical prompts between API-mode and export-mode. Add a `CopyPromptDialog` component (shadcn Dialog) wired to a small button in the editor's empty-state action area.

**Tech Stack:** TypeScript · Next.js App Router · React 19 · Tailwind · shadcn/ui · Vitest · Playwright · no new dependencies.

**Spec:** [docs/superpowers/specs/2026-04-21-copy-prompt-for-webui-design.md](../specs/2026-04-21-copy-prompt-for-webui-design.md)

**Pre-read (skim before starting):**
- [lib/prompts.ts](../../../lib/prompts.ts) — `buildChapterPrompt` (pure, unchanged)
- [app/api/generate/route.ts:240-280](../../../app/api/generate/route.ts) — the code being extracted
- [lib/api.ts](../../../lib/api.ts) — `ok` / `fail` envelope helpers
- [CLAUDE.md](../../../CLAUDE.md) — privacy pillar, test conventions
- [tests/privacy/no-external-egress.test.ts](../../../tests/privacy/no-external-egress.test.ts) — the test you'll extend

**Conventions this plan follows (non-negotiable):**
- Tests live in `tests/` mirroring the source tree. Vitest for unit/integration, Playwright for e2e.
- Component tests opt into jsdom with `// @vitest-environment jsdom` at the file top AND use a **manual React 19 render harness** with `createRoot` — the project does **not** use `@testing-library/react`. See [tests/components/editor/StreamOverlay.test.tsx](../../../tests/components/editor/StreamOverlay.test.tsx) for the canonical pattern.
- API route tests invoke handlers directly via dynamic import (e.g. `const { GET } = await import("@/app/api/…/route")`) with a `mkdtemp`-ed `SCRIPTR_DATA_DIR`. See [tests/api/chapters.item.test.ts](../../../tests/api/chapters.item.test.ts).
- Commit after each green-test cycle. Prefer many small commits over few large ones.

---

## Chunk 1: Shared helper (`lib/prompt-assembly.ts`)

### Task 1.1: Scaffold module + test file with first failing test

**Files:**
- Create: `lib/prompt-assembly.ts`
- Create: `tests/lib/prompt-assembly.test.ts`

- [ ] **Step 1: Write the test file scaffolding with the first failing test (chapter 1, no priorRecaps)**

Create `tests/lib/prompt-assembly.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStory, getStory, updateStory } from "@/lib/storage/stories";
import { createChapter, getChapter, listChapters } from "@/lib/storage/chapters";
import { saveBible, getBible } from "@/lib/storage/bible";
import {
  assembleChapterPrompt,
  StoryNotFoundError,
  BibleNotFoundError,
  ChapterNotFoundError,
} from "@/lib/prompt-assembly";
import { buildChapterPrompt } from "@/lib/prompts";
import { loadConfig, saveConfig } from "@/lib/config";
import { resolveStyleRules } from "@/lib/style";
import type { Bible } from "@/lib/types";

const SAMPLE_BIBLE: Bible = {
  characters: [{ name: "Alice", description: "curious cat" }],
  setting: "an attic",
  pov: "third-limited",
  tone: "whimsical",
  styleNotes: "short sentences",
  nsfwPreferences: "fade to black",
};

describe("assembleChapterPrompt", () => {
  const originalEnv = process.env;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scriptr-prompt-assembly-"));
    process.env = { ...originalEnv, SCRIPTR_DATA_DIR: tmpDir };
    delete process.env.XAI_API_KEY;
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function seed() {
    const story = await createStory(tmpDir, { title: "Test Story" });
    await saveBible(tmpDir, story.slug, SAMPLE_BIBLE);
    const ch1 = await createChapter(tmpDir, story.slug, {
      title: "Chapter One",
      beats: ["opens with Alice waking"],
    });
    return { story, ch1 };
  }

  it("chapter 1: returns empty priorRecaps, chapterIndex 1", async () => {
    const { story, ch1 } = await seed();
    const result = await assembleChapterPrompt(tmpDir, story.slug, ch1.id);
    expect(result.meta.chapterIndex).toBe(1);
    expect(result.meta.priorRecapCount).toBe(0);
    expect(result.meta.includesLastChapterFullText).toBe(false);
    expect(result.user).toContain("# Story bible");
    expect(result.user).toContain("(no prior chapters)");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/prompt-assembly.test.ts`
Expected: **FAIL** with "Failed to resolve import '@/lib/prompt-assembly'".

- [ ] **Step 3: Create the module with typed errors and stub implementation**

Create `lib/prompt-assembly.ts`:

```ts
import { loadConfig } from "@/lib/config";
import { getStory } from "@/lib/storage/stories";
import { getBible } from "@/lib/storage/bible";
import { getChapter, listChapters } from "@/lib/storage/chapters";
import { buildChapterPrompt, type PromptPair } from "@/lib/prompts";
import { resolveStyleRules } from "@/lib/style";

export class StoryNotFoundError extends Error {
  constructor(slug: string) {
    super(`story not found: ${slug}`);
    this.name = "StoryNotFoundError";
  }
}

export class BibleNotFoundError extends Error {
  constructor(slug: string) {
    super(`bible not found: ${slug}`);
    this.name = "BibleNotFoundError";
  }
}

export class ChapterNotFoundError extends Error {
  constructor(chapterId: string) {
    super(`chapter not found: ${chapterId}`);
    this.name = "ChapterNotFoundError";
  }
}

export type AssembledPromptMeta = {
  /** 1-based position of this chapter within the story's chapter order. */
  chapterIndex: number;
  /** Number of prior chapters that contributed a recap entry (equals chapterIndex - 1). */
  priorRecapCount: number;
  /** True if the prior chapter's full text is embedded in the prompt (per config). */
  includesLastChapterFullText: boolean;
  /** The model that generate-mode WOULD use for this chapter, given current config. */
  model: string;
};

export type AssembledPrompt = PromptPair & { meta: AssembledPromptMeta };

/**
 * Reads story / bible / chapter / config from disk, assembles priorRecaps
 * and lastChapterFullText, calls buildChapterPrompt, returns the full prompt
 * plus metadata describing what went in. Single source of truth for
 * "what would scriptr send to Grok for this chapter's full-chapter prompt?"
 *
 * Does NOT read or validate XAI_API_KEY — the whole point of the export
 * feature is to work with zero Grok credentials configured.
 */
export async function assembleChapterPrompt(
  dataDir: string,
  storySlug: string,
  chapterId: string,
): Promise<AssembledPrompt> {
  const story = await getStory(dataDir, storySlug);
  if (!story) throw new StoryNotFoundError(storySlug);

  const bible = await getBible(dataDir, storySlug);
  if (!bible) throw new BibleNotFoundError(storySlug);

  const chapter = await getChapter(dataDir, storySlug, chapterId);
  if (!chapter) throw new ChapterNotFoundError(chapterId);

  const config = await loadConfig(dataDir);

  const allChapters = await listChapters(dataDir, storySlug);
  const chapterIndex = allChapters.findIndex((c) => c.id === chapter.id);
  if (chapterIndex < 0) throw new ChapterNotFoundError(chapterId);

  const priorRecaps =
    chapterIndex > 0
      ? allChapters
          .slice(0, chapterIndex)
          .map((c, i) => ({ chapterIndex: i + 1, recap: c.recap }))
      : [];

  const lastChapterFullText =
    config.includeLastChapterFullText && chapterIndex > 0
      ? allChapters[chapterIndex - 1].sections.map((s) => s.content).join("\n---\n")
      : undefined;

  const { system, user } = buildChapterPrompt({
    story,
    bible,
    priorRecaps,
    chapter,
    includeLastChapterFullText: config.includeLastChapterFullText,
    lastChapterFullText,
    style: resolveStyleRules(config, bible),
  });

  return {
    system,
    user,
    meta: {
      chapterIndex: chapterIndex + 1,
      priorRecapCount: priorRecaps.length,
      includesLastChapterFullText: lastChapterFullText !== undefined,
      model: story.modelOverride ?? config.defaultModel,
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/prompt-assembly.test.ts`
Expected: **PASS** (1 test).

- [ ] **Step 5: Commit**

```bash
git add lib/prompt-assembly.ts tests/lib/prompt-assembly.test.ts
git commit -m "feat(prompt-assembly): extract chapter prompt assembly into shared helper"
```

---

### Task 1.2: Chapter N with priorRecaps

**Files:**
- Modify: `tests/lib/prompt-assembly.test.ts`

- [ ] **Step 1: Add a failing test for priorRecaps assembly**

Append to the `describe("assembleChapterPrompt", …)` block in `tests/lib/prompt-assembly.test.ts`:

```ts
  it("chapter 3: priorRecaps contains chapters 1 and 2 with 1-based indexing", async () => {
    const story = await createStory(tmpDir, { title: "Three-Chapter Story" });
    await saveBible(tmpDir, story.slug, SAMPLE_BIBLE);
    const ch1 = await createChapter(tmpDir, story.slug, {
      title: "Ch1",
      recap: "Alice wakes and finds a key.",
    });
    const ch2 = await createChapter(tmpDir, story.slug, {
      title: "Ch2",
      recap: "She unlocks a mysterious door.",
    });
    const ch3 = await createChapter(tmpDir, story.slug, { title: "Ch3" });

    const result = await assembleChapterPrompt(tmpDir, story.slug, ch3.id);
    expect(result.meta.chapterIndex).toBe(3);
    expect(result.meta.priorRecapCount).toBe(2);
    // Use ASCII em-dash codepoint (\u2014) to match formatPriorRecaps output.
    expect(result.user).toContain("Ch.1 \u2014 Alice wakes and finds a key.");
    expect(result.user).toContain("Ch.2 \u2014 She unlocks a mysterious door.");
    // Negative: chapter 3's own recap must NOT appear in priorRecaps.
    expect(result.user).not.toContain("Ch.3 \u2014");
    // Silence unused-var lint on ch1/ch2 by asserting they exist.
    expect(ch1.id).toBeTruthy();
    expect(ch2.id).toBeTruthy();
  });
```

- [ ] **Step 2: Run the test — it should pass immediately (behavior matches the generate route)**

Run: `npx vitest run tests/lib/prompt-assembly.test.ts`
Expected: **PASS** (2 tests). If it fails, inspect the priorRecaps slicing logic — the bug is in the helper, not the test.

- [ ] **Step 3: Commit**

```bash
git add tests/lib/prompt-assembly.test.ts
git commit -m "test(prompt-assembly): verify priorRecaps slicing for chapter N"
```

---

### Task 1.3: `includeLastChapterFullText` config toggle

**Files:**
- Modify: `tests/lib/prompt-assembly.test.ts`

- [ ] **Step 1: Add two tests covering both config values**

Append to the `describe` block:

```ts
  it("lastChapterFullText: omitted when config.includeLastChapterFullText is false (default)", async () => {
    const { story } = await seed();
    const ch2 = await createChapter(tmpDir, story.slug, { title: "Ch2" });
    // Note: seed() creates ch1 with one beat; we didn't write any sections
    // to ch1, so even if the config were on, the "full text" would be empty.
    // But for this test we're explicitly verifying the flag flips, not content.
    const result = await assembleChapterPrompt(tmpDir, story.slug, ch2.id);
    expect(result.meta.includesLastChapterFullText).toBe(false);
    expect(result.user).not.toContain("Prior chapter full text (for continuity):");
  });

  it("lastChapterFullText: included when config.includeLastChapterFullText is true", async () => {
    const story = await createStory(tmpDir, { title: "With Last Chapter" });
    await saveBible(tmpDir, story.slug, SAMPLE_BIBLE);
    const ch1 = await createChapter(tmpDir, story.slug, {
      title: "Ch1",
      sections: [{ id: "s1", content: "Once upon a time." }],
    });
    const ch2 = await createChapter(tmpDir, story.slug, { title: "Ch2" });
    // saveConfig takes a Partial<Config> and merges it with defaults.
    await saveConfig(tmpDir, { includeLastChapterFullText: true });

    const result = await assembleChapterPrompt(tmpDir, story.slug, ch2.id);
    expect(result.meta.includesLastChapterFullText).toBe(true);
    expect(result.user).toContain("Prior chapter full text (for continuity):");
    expect(result.user).toContain("Once upon a time.");
    expect(ch1.id).toBeTruthy();
  });
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run tests/lib/prompt-assembly.test.ts`
Expected: **PASS** (4 tests total).

- [ ] **Step 3: Commit**

```bash
git add tests/lib/prompt-assembly.test.ts
git commit -m "test(prompt-assembly): cover includeLastChapterFullText toggle"
```

---

### Task 1.4: Model resolution (`modelOverride ?? defaultModel`)

**Files:**
- Modify: `tests/lib/prompt-assembly.test.ts`

- [ ] **Step 1: Add two model-resolution tests**

```ts
  it("meta.model: falls back to config.defaultModel when story has no override", async () => {
    const { story, ch1 } = await seed();
    const config = await loadConfig(tmpDir);
    const result = await assembleChapterPrompt(tmpDir, story.slug, ch1.id);
    expect(result.meta.model).toBe(config.defaultModel);
  });

  it("meta.model: uses story.modelOverride when present", async () => {
    const { story, ch1 } = await seed();
    await updateStory(tmpDir, story.slug, { modelOverride: "grok-4-fast-reasoning" });
    const result = await assembleChapterPrompt(tmpDir, story.slug, ch1.id);
    expect(result.meta.model).toBe("grok-4-fast-reasoning");
  });
```

- [ ] **Step 2: Run and commit**

Run: `npx vitest run tests/lib/prompt-assembly.test.ts`
Expected: **PASS** (6 tests total).

```bash
git add tests/lib/prompt-assembly.test.ts
git commit -m "test(prompt-assembly): verify modelOverride fallback"
```

---

### Task 1.5: Three not-found error paths

**Files:**
- Modify: `tests/lib/prompt-assembly.test.ts`

- [ ] **Step 1: Add error-path tests**

```ts
  it("throws StoryNotFoundError when slug unknown", async () => {
    await expect(
      assembleChapterPrompt(tmpDir, "nonexistent-slug", "whatever"),
    ).rejects.toThrow(StoryNotFoundError);
  });

  it("throws BibleNotFoundError when bible.json missing", async () => {
    const story = await createStory(tmpDir, { title: "Bible-less" });
    // Deliberately do NOT call saveBible.
    const ch1 = await createChapter(tmpDir, story.slug, { title: "Ch1" });
    await expect(
      assembleChapterPrompt(tmpDir, story.slug, ch1.id),
    ).rejects.toThrow(BibleNotFoundError);
  });

  it("throws ChapterNotFoundError when chapter id unknown", async () => {
    const { story } = await seed();
    await expect(
      assembleChapterPrompt(tmpDir, story.slug, "nonexistent-chapter-id"),
    ).rejects.toThrow(ChapterNotFoundError);
  });
```

- [ ] **Step 2: Run and commit**

Run: `npx vitest run tests/lib/prompt-assembly.test.ts`
Expected: **PASS** (9 tests total).

```bash
git add tests/lib/prompt-assembly.test.ts
git commit -m "test(prompt-assembly): verify three not-found error paths"
```

---

### Task 1.6: Byte-for-byte guardrail test

The central promise of this feature is that the exported prompt is *identical* to the API-mode prompt. This test locks that in by computing the prompt two ways (via the helper; directly via `buildChapterPrompt` with manually-assembled inputs) and asserting they match character-for-character.

**Files:**
- Modify: `tests/lib/prompt-assembly.test.ts`

- [ ] **Step 1: Add the guardrail test**

```ts
  it("byte-for-byte: helper output matches direct buildChapterPrompt call with same inputs", async () => {
    const story = await createStory(tmpDir, { title: "Guardrail Story" });
    await saveBible(tmpDir, story.slug, SAMPLE_BIBLE);
    const ch1 = await createChapter(tmpDir, story.slug, {
      title: "Ch1",
      recap: "Alice wakes.",
    });
    const ch2 = await createChapter(tmpDir, story.slug, {
      title: "Ch2",
      beats: ["She finds a key", "She unlocks a door"],
    });

    // Helper path.
    const viaHelper = await assembleChapterPrompt(tmpDir, story.slug, ch2.id);

    // Direct path — replicate the inline assembly from the pre-refactor
    // generate route EXACTLY. If this test starts failing after a helper
    // change, the helper diverged from "extract without transform".
    const config = await loadConfig(tmpDir);
    const s = await getStory(tmpDir, story.slug);
    const b = await getBible(tmpDir, story.slug);
    const c = await getChapter(tmpDir, story.slug, ch2.id);
    const all = await listChapters(tmpDir, story.slug);
    const idx = all.findIndex((x) => x.id === c!.id);
    const priorRecaps = all
      .slice(0, idx)
      .map((cc, i) => ({ chapterIndex: i + 1, recap: cc.recap }));
    const lastText =
      config.includeLastChapterFullText && idx > 0
        ? all[idx - 1].sections.map((ss) => ss.content).join("\n---\n")
        : undefined;
    const direct = buildChapterPrompt({
      story: s!,
      bible: b!,
      priorRecaps,
      chapter: c!,
      includeLastChapterFullText: config.includeLastChapterFullText,
      lastChapterFullText: lastText,
      style: resolveStyleRules(config, b!),
    });

    expect(viaHelper.system).toBe(direct.system);
    expect(viaHelper.user).toBe(direct.user);
    expect(ch1.id).toBeTruthy(); // silence unused-var
  });
```

- [ ] **Step 2: Run and commit**

Run: `npx vitest run tests/lib/prompt-assembly.test.ts`
Expected: **PASS** (10 tests total).

```bash
git add tests/lib/prompt-assembly.test.ts
git commit -m "test(prompt-assembly): byte-for-byte guardrail against direct buildChapterPrompt"
```

---

## Chunk 2: Generate route refactor

### Task 2.1: Refactor `handleFull` to call the helper

**Files:**
- Modify: `app/api/generate/route.ts` (lines ~240-275 in `handleFull`)

- [ ] **Step 1: Baseline — run the existing generate tests and confirm they pass**

Run: `npx vitest run tests/api/generate.test.ts`
Expected: **PASS** (all tests green). Note the count — you'll compare after the refactor.

- [ ] **Step 2: Apply the refactor**

Open [app/api/generate/route.ts](../../../app/api/generate/route.ts). Replace the current `handleFull` prologue (the per-entity fetches + pre-checks + inline priorRecaps / lastChapterFullText assembly + `buildChapterPrompt` call + the `const model = story.modelOverride ?? config.defaultModel` line; roughly lines 239–277) with a `try { … } catch { … }` block that delegates to the helper. The rest of `handleFull` (the `.last-payload.json` write at line 280, the client acquisition, the `runChapterStream` call) must remain unchanged.

**Add imports at the top of the file** (merge with the existing imports; do not duplicate):

```ts
import {
  assembleChapterPrompt,
  StoryNotFoundError,
  BibleNotFoundError,
  ChapterNotFoundError,
} from "@/lib/prompt-assembly";
```

**Replace lines 239–277** (from `const dataDir = effectiveDataDir();` through `const model = story.modelOverride ?? config.defaultModel;`) with exactly this block:

```ts
  const dataDir = effectiveDataDir();
  const config = await loadConfig(dataDir);

  let prompt: { system: string; user: string };
  let model: string;
  try {
    const assembled = await assembleChapterPrompt(dataDir, body.storySlug, body.chapterId);
    prompt = { system: assembled.system, user: assembled.user };
    model = assembled.meta.model;
  } catch (e) {
    if (e instanceof StoryNotFoundError) return json400("story not found");
    if (e instanceof BibleNotFoundError) return json400("bible not found");
    if (e instanceof ChapterNotFoundError) return json400("chapter not found");
    throw e;
  }

  // Re-fetch story and chapter for downstream use.
  // - `chapter.sections` is the initial sections snapshot for the stream.
  // - `story` is passed directly to runChapterStream for recap generation
  //   and other per-story behavior.
  // The helper already validated their existence, so the non-null assertions are safe.
  const story = (await getStory(dataDir, body.storySlug))!;
  const chapter = (await getChapter(dataDir, body.storySlug, body.chapterId))!;
```

Key invariants the replacement must preserve:

1. `config` remains in scope — it is used later (`config.autoRecap` at ~line 314, `getGrokClient(config)` at ~line 289).
2. `story` remains in scope — `runChapterStream({ ..., story })` at ~line 315 requires it.
3. `chapter.sections` is used as `initialSections: [...chapter.sections]` in the `runChapterStream` call at ~line 310.
4. `prompt` and `model` are the same shape as before (`{ system, user }` and `string` respectively).
5. The `.last-payload.json` write at ~line 280 still receives `{ model, mode: body.mode, system: prompt.system, user: prompt.user }` — same keys, same values, same `lastPayloadFile(dataDir, body.storySlug)` path. Do not touch this write.

**Do NOT touch:** `handleSection`, `handleContinue`, the `json400` helper, the `runChapterStream` call body, the `.last-payload.json` write, or any imports except the ones listed above.

- [ ] **Step 3: Run the existing generate tests again — they MUST pass unchanged**

Run: `npx vitest run tests/api/generate.test.ts`
Expected: **PASS** with the same test count as step 1. If any previously-green test now fails, the refactor introduced behavior drift — the most likely culprit is a misordered variable assignment before the stream call, or a renamed local. Debug; do not proceed until every generate test is green.

- [ ] **Step 4: Run the privacy egress test to confirm the refactor didn't break it**

Run: `npx vitest run tests/privacy/no-external-egress.test.ts`
Expected: **PASS**.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: exit 0, no errors.

- [ ] **Step 6: Commit**

```bash
git add app/api/generate/route.ts
git commit -m "refactor(generate): use assembleChapterPrompt helper in handleFull"
```

---

## Chunk 3: API route + egress test extension

### Task 3.1: Route tests (happy path + three 404 paths)

**Files:**
- Create: `tests/api/stories/chapters/prompt.test.ts`

- [ ] **Step 1: Write the tests — they will all fail until the route exists**

Create `tests/api/stories/chapters/prompt.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { createStory } from "@/lib/storage/stories";
import { createChapter } from "@/lib/storage/chapters";
import { saveBible } from "@/lib/storage/bible";
import type { Bible } from "@/lib/types";

const BIBLE: Bible = {
  characters: [{ name: "Alice", description: "curious cat" }],
  setting: "attic",
  pov: "third-limited",
  tone: "whimsical",
  styleNotes: "",
  nsfwPreferences: "",
};

describe("GET /api/stories/[slug]/chapters/[id]/prompt", () => {
  const originalEnv = process.env;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scriptr-prompt-route-"));
    process.env = { ...originalEnv, SCRIPTR_DATA_DIR: tmpDir };
    delete process.env.XAI_API_KEY;
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function callGet(slug: string, id: string) {
    const { GET } = await import(
      "@/app/api/stories/[slug]/chapters/[id]/prompt/route"
    );
    const req = new Request(
      `http://localhost/api/stories/${slug}/chapters/${id}/prompt`,
    ) as unknown as NextRequest;
    const ctx = { params: Promise.resolve({ slug, id }) };
    return GET(req, ctx);
  }

  it("200: happy path returns { ok, data: { system, user, meta } }", async () => {
    const story = await createStory(tmpDir, { title: "Happy Path" });
    await saveBible(tmpDir, story.slug, BIBLE);
    const chapter = await createChapter(tmpDir, story.slug, {
      title: "Ch1",
      beats: ["Alice wakes"],
    });

    const res = await callGet(story.slug, chapter.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.data.system).toBe("string");
    expect(body.data.system.length).toBeGreaterThan(0);
    expect(typeof body.data.user).toBe("string");
    expect(body.data.user).toContain("# Story bible");
    expect(body.data.meta.chapterIndex).toBe(1);
    expect(body.data.meta.priorRecapCount).toBe(0);
    expect(body.data.meta.includesLastChapterFullText).toBe(false);
    expect(typeof body.data.meta.model).toBe("string");
  });

  it("404: story not found", async () => {
    const res = await callGet("nonexistent-slug", "whatever-id");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "story not found" });
  });

  it("404: bible not found (story exists but no bible.json)", async () => {
    const story = await createStory(tmpDir, { title: "Bible-less" });
    const chapter = await createChapter(tmpDir, story.slug, { title: "Ch1" });
    // No saveBible call.
    const res = await callGet(story.slug, chapter.id);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "bible not found" });
  });

  it("404: chapter not found", async () => {
    const story = await createStory(tmpDir, { title: "No-chapter Story" });
    await saveBible(tmpDir, story.slug, BIBLE);
    const res = await callGet(story.slug, "nonexistent-chapter-id");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "chapter not found" });
  });
});
```

- [ ] **Step 2: Run the tests — they fail because the route doesn't exist yet**

Run: `npx vitest run tests/api/stories/chapters/prompt.test.ts`
Expected: **FAIL** with "Failed to resolve import" on the route file.

- [ ] **Step 3: Create the route**

Create `app/api/stories/[slug]/chapters/[id]/prompt/route.ts`:

```ts
import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api";
import { effectiveDataDir } from "@/lib/config";
import {
  assembleChapterPrompt,
  StoryNotFoundError,
  BibleNotFoundError,
  ChapterNotFoundError,
} from "@/lib/prompt-assembly";

type Ctx = { params: Promise<{ slug: string; id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  try {
    const prompt = await assembleChapterPrompt(effectiveDataDir(), slug, id);
    return ok(prompt);
  } catch (e) {
    if (e instanceof StoryNotFoundError) return fail("story not found", 404);
    if (e instanceof BibleNotFoundError) return fail("bible not found", 404);
    if (e instanceof ChapterNotFoundError) return fail("chapter not found", 404);
    throw e;
  }
}
```

- [ ] **Step 4: Run the tests — they should all pass**

Run: `npx vitest run tests/api/stories/chapters/prompt.test.ts`
Expected: **PASS** (4 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add app/api/stories/\[slug\]/chapters/\[id\]/prompt/route.ts tests/api/stories/chapters/prompt.test.ts
git commit -m "feat(api): GET /api/stories/[slug]/chapters/[id]/prompt"
```

---

### Task 3.2: Extend the privacy egress test

**Files:**
- Modify: `tests/privacy/no-external-egress.test.ts`

- [ ] **Step 1: Locate the block of route invocations inside the main `it("exercising every non-generate route records zero fetches", …)` test. Before the final `expect(recorded).toEqual([])` assertion, add a new invocation for the prompt route.**

Find the line that looks like `// ── DELETE /api/stories/[slug] ────────────────────────────────────────` (or wherever the last route block is, before the final assertion). Immediately before the final `expect(recorded).toEqual([])`, insert a new block. You will need to re-use existing seed data (the story `slug` and a chapter `id`) — `ch1.id` is still valid at that point per the existing test flow, but `ch2` has been deleted. Check the test's current state first (chapter `ch1` should still exist, and the story has a bible put via PUT earlier). Use `ch1.id`.

Insert this block after the `PATCH /api/stories/[slug]/chapters/[id]` block (the one that updates `ch1`'s summary) and before the `DELETE /api/stories/[slug]/chapters/[id]` block (which deletes `ch2`):

```ts
    // ── GET /api/stories/[slug]/chapters/[id]/prompt ──────────────────────
    {
      const { GET } = await import(
        "@/app/api/stories/[slug]/chapters/[id]/prompt/route"
      );
      const req = makeReq(
        `http://localhost/api/stories/${slug}/chapters/${ch1.id}/prompt`,
      );
      const ctx = { params: Promise.resolve({ slug, id: ch1.id }) };
      const res = await GET(req, ctx);
      expect(res.status).toBe(200);
    }
```

- [ ] **Step 2: Also update the "ROUTES EXERCISED" doc comment at the top of the file**

Find the `─── ROUTES EXERCISED ───` section in the file header. The existing entries are column-aligned (method names padded with two spaces for GET / POST / PUT). Add a new line after `GET  /api/stories/[slug]/chapters/[id]` preserving the alignment:

```
 *   GET  /api/stories/[slug]/chapters/[id]/prompt
```

- [ ] **Step 3: Run the privacy test**

Run: `npx vitest run tests/privacy/no-external-egress.test.ts`
Expected: **PASS**. The final `recorded === []` assertion must hold.

- [ ] **Step 4: Commit**

```bash
git add tests/privacy/no-external-egress.test.ts
git commit -m "test(privacy): cover new prompt route in egress test"
```

---

## Chunk 4: UI — `CopyPromptDialog` + editor wiring

### Task 4.1: Extract the button trigger component

The trigger is a small standalone component so the existing `GenerateChapterButton` stays unchanged and the button can be unit-tested independently. It only needs `onClick`; dialog state lives in the parent (EditorPane).

**Files:**
- Create: `components/editor/CopyPromptButton.tsx`

- [ ] **Step 1: Create the button component**

```tsx
"use client";

import { Clipboard } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CopyPromptButtonProps {
  onClick: () => void;
  /** Disabled during the initial fetch or when story context is incomplete. */
  disabled?: boolean;
}

/**
 * Secondary button next to GenerateChapterButton in the empty-state CTA area.
 * Opens the CopyPromptDialog. Kept presentational; all state lives in the
 * parent EditorPane so Generate and Copy-prompt share empty-state layout.
 */
export function CopyPromptButton({ onClick, disabled }: CopyPromptButtonProps) {
  return (
    <Button variant="outline" onClick={onClick} disabled={disabled}>
      <Clipboard className="h-4 w-4" aria-hidden="true" />
      Copy prompt
    </Button>
  );
}
```

- [ ] **Step 2: Commit — no test yet; trivial presentational component**

```bash
git add components/editor/CopyPromptButton.tsx
git commit -m "feat(editor): CopyPromptButton trigger component"
```

---

### Task 4.2: `CopyPromptDialog` — test harness + loading/success rendering

The dialog is a client component that, on open, fires `GET /api/stories/[slug]/chapters/[id]/prompt` and renders one of three states: loading, error, or success.

**Files:**
- Create: `components/editor/CopyPromptDialog.tsx`
- Create: `tests/components/editor/CopyPromptDialog.test.tsx`

- [ ] **Step 1: Write the test harness with a loading-state test and a success-state test. These fail because the component doesn't exist yet.**

Create `tests/components/editor/CopyPromptDialog.test.tsx`:

```tsx
// @vitest-environment jsdom
/**
 * Tests for CopyPromptDialog. Manual React 19 render harness — the project
 * does not use @testing-library/react. Mirrors the pattern in
 * tests/components/editor/StreamOverlay.test.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CopyPromptDialog } from "@/components/editor/CopyPromptDialog";

type Mounted = { container: HTMLDivElement; root: Root; unmount: () => void };

function mount(element: React.ReactElement): Mounted {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root!: Root;
  act(() => {
    root = createRoot(container);
    root.render(element);
  });
  return {
    container,
    root,
    unmount: () => {
      act(() => { root.unmount(); });
      container.remove();
    },
  };
}

/** Flush pending microtasks (fetch promise resolution + React state updates). */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const SAMPLE_PROMPT = {
  ok: true,
  data: {
    system: "You are a novelist writing Chapter 2 of Test Story.",
    user: "# Story bible\nCharacters:\n- Alice\n\n# Current chapter: Ch2\nBeats:\n- She finds a key",
    meta: {
      chapterIndex: 2,
      priorRecapCount: 1,
      includesLastChapterFullText: false,
      model: "grok-4-fast-reasoning",
    },
  },
};

describe("CopyPromptDialog", () => {
  let originalFetch: typeof globalThis.fetch;
  let originalClipboard: Clipboard | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    // jsdom has no clipboard by default; capture whatever it does have to restore.
    originalClipboard = (globalThis.navigator as Navigator & { clipboard?: Clipboard }).clipboard;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalClipboard === undefined) {
      // biome-ignore lint/performance/noDelete: test cleanup
      delete (globalThis.navigator as Navigator & { clipboard?: Clipboard }).clipboard;
    } else {
      Object.defineProperty(globalThis.navigator, "clipboard", {
        configurable: true,
        value: originalClipboard,
      });
    }
    vi.restoreAllMocks();
  });

  it("renders loading state immediately after open", async () => {
    globalThis.fetch = vi.fn(
      () => new Promise<Response>(() => {}),
    ) as typeof globalThis.fetch; // never resolves → stays in loading
    const { container, unmount } = mount(
      <CopyPromptDialog open slug="s" chapterId="c" onOpenChange={() => {}} />,
    );
    // Dialog portals to document.body, so query there.
    expect(document.body.textContent).toContain("Building prompt");
    expect(container).toBeTruthy();
    unmount();
  });

  it("renders preview and meta strip on success", async () => {
    globalThis.fetch = vi.fn(
      () => Promise.resolve(new Response(JSON.stringify(SAMPLE_PROMPT), { status: 200 })),
    ) as typeof globalThis.fetch;
    const { unmount } = mount(
      <CopyPromptDialog open slug="s" chapterId="c" onOpenChange={() => {}} />,
    );
    await flush();
    expect(document.body.textContent).toContain("Chapter 2");
    expect(document.body.textContent).toContain("1 prior recap");
    expect(document.body.textContent).toContain("grok-4-fast-reasoning");
    expect(document.body.textContent).toContain("# Story bible");
    unmount();
  });
});
```

- [ ] **Step 2: Run the tests — they should fail (module doesn't exist)**

Run: `npx vitest run tests/components/editor/CopyPromptDialog.test.tsx`
Expected: **FAIL** on import.

- [ ] **Step 3: Create the component with enough to pass both tests**

Create `components/editor/CopyPromptDialog.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";

type Meta = {
  chapterIndex: number;
  priorRecapCount: number;
  includesLastChapterFullText: boolean;
  model: string;
};

type PromptData = { system: string; user: string; meta: Meta };

type FetchState =
  | { status: "loading" }
  | { status: "success"; data: PromptData }
  | { status: "error"; error: string };

interface CopyPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  chapterId: string;
}

export function CopyPromptDialog({
  open,
  onOpenChange,
  slug,
  chapterId,
}: CopyPromptDialogProps) {
  const [state, setState] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState({ status: "loading" });
    (async () => {
      try {
        const res = await fetch(
          `/api/stories/${slug}/chapters/${chapterId}/prompt`,
        );
        const json = (await res.json()) as
          | { ok: true; data: PromptData }
          | { ok: false; error: string };
        if (cancelled) return;
        if (json.ok) {
          setState({ status: "success", data: json.data });
        } else {
          setState({ status: "error", error: json.error });
        }
      } catch {
        if (!cancelled) setState({ status: "error", error: "network error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, slug, chapterId]);

  const pasteable =
    state.status === "success"
      ? `${state.data.system}\n\n${state.data.user}`
      : "";

  async function handleCopy() {
    if (!pasteable) return;
    try {
      await navigator.clipboard.writeText(pasteable);
      toast.success("Prompt copied");
    } catch {
      toast.message("Select and copy manually (Cmd/Ctrl+C)");
    }
  }

  function handleRetry() {
    // Re-trigger the effect by toggling a local key.
    setState({ status: "loading" });
    (async () => {
      try {
        const res = await fetch(
          `/api/stories/${slug}/chapters/${chapterId}/prompt`,
        );
        const json = (await res.json()) as
          | { ok: true; data: PromptData }
          | { ok: false; error: string };
        if (json.ok) setState({ status: "success", data: json.data });
        else setState({ status: "error", error: json.error });
      } catch {
        setState({ status: "error", error: "network error" });
      }
    })();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Copy chapter prompt</DialogTitle>
          <DialogDescription>
            The exact prompt scriptr would send to Grok for this chapter.
            Paste it into the Grok web UI chat, then bring the prose back via
            Import chapter.
          </DialogDescription>
        </DialogHeader>

        {state.status === "loading" && (
          <div className="py-8 text-sm text-muted-foreground">Building prompt…</div>
        )}

        {state.status === "error" && (
          <div className="py-4">
            <div className="text-sm text-destructive">Error: {state.error}</div>
            <Button variant="outline" onClick={handleRetry} className="mt-3">
              Retry
            </Button>
          </div>
        )}

        {state.status === "success" && (
          <>
            <div className="text-xs text-muted-foreground">
              Chapter {state.data.meta.chapterIndex} ·{" "}
              {state.data.meta.priorRecapCount}{" "}
              {state.data.meta.priorRecapCount === 1
                ? "prior recap"
                : "prior recaps"}{" "}
              · last-chapter full text:{" "}
              {state.data.meta.includesLastChapterFullText ? "on" : "off"} ·
              model: {state.data.meta.model}
            </div>
            <ScrollArea className="h-96 rounded border bg-muted/40">
              <pre className="p-3 text-xs font-mono whitespace-pre-wrap break-words">
                {pasteable}
              </pre>
            </ScrollArea>
            <div className="text-xs text-muted-foreground">
              ~{pasteable.length} chars · ~{Math.ceil(pasteable.length / 4)} tokens (rough)
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            onClick={handleCopy}
            disabled={state.status !== "success"}
          >
            Copy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/components/editor/CopyPromptDialog.test.tsx`
Expected: **PASS** (2 tests). If the `ScrollArea` import fails, check that `components/ui/scroll-area.tsx` exists — it's part of shadcn/ui; if missing, either install it via the project's shadcn generator or substitute a plain `<div className="max-h-96 overflow-auto …">`.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add components/editor/CopyPromptDialog.tsx tests/components/editor/CopyPromptDialog.test.tsx
git commit -m "feat(editor): CopyPromptDialog with loading and success states"
```

---

### Task 4.3: Copy action + clipboard fallback test

**Files:**
- Modify: `tests/components/editor/CopyPromptDialog.test.tsx`

- [ ] **Step 1: Add clipboard-happy-path and clipboard-fallback tests**

Append to the `describe("CopyPromptDialog", …)` block:

```tsx
  it("Copy button writes `${system}\\n\\n${user}` to clipboard and fires success toast", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const { toast } = await import("sonner");
    const successSpy = vi.spyOn(toast, "success").mockImplementation(() => "id");

    globalThis.fetch = vi.fn(
      () => Promise.resolve(new Response(JSON.stringify(SAMPLE_PROMPT), { status: 200 })),
    ) as typeof globalThis.fetch;

    const { unmount } = mount(
      <CopyPromptDialog open slug="s" chapterId="c" onOpenChange={() => {}} />,
    );
    await flush();

    // Find the Copy button by text.
    const buttons = Array.from(
      document.body.querySelectorAll("button"),
    ) as HTMLButtonElement[];
    const copyBtn = buttons.find((b) => b.textContent?.trim() === "Copy");
    expect(copyBtn).toBeDefined();
    await act(async () => {
      copyBtn!.click();
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith(
      `${SAMPLE_PROMPT.data.system}\n\n${SAMPLE_PROMPT.data.user}`,
    );
    expect(successSpy).toHaveBeenCalledWith("Prompt copied");
    unmount();
  });

  it("Copy: falls back to manual-copy toast when clipboard.writeText rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const { toast } = await import("sonner");
    const messageSpy = vi.spyOn(toast, "message").mockImplementation(() => "id");

    globalThis.fetch = vi.fn(
      () => Promise.resolve(new Response(JSON.stringify(SAMPLE_PROMPT), { status: 200 })),
    ) as typeof globalThis.fetch;

    const { unmount } = mount(
      <CopyPromptDialog open slug="s" chapterId="c" onOpenChange={() => {}} />,
    );
    await flush();

    const copyBtn = Array.from(
      document.body.querySelectorAll("button"),
    ).find((b) => b.textContent?.trim() === "Copy") as HTMLButtonElement;
    await act(async () => {
      copyBtn.click();
      await flush();
    });

    expect(writeText).toHaveBeenCalled();
    expect(messageSpy).toHaveBeenCalledWith("Select and copy manually (Cmd/Ctrl+C)");
    unmount();
  });
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run tests/components/editor/CopyPromptDialog.test.tsx`
Expected: **PASS** (4 tests total).

- [ ] **Step 3: Commit**

```bash
git add tests/components/editor/CopyPromptDialog.test.tsx
git commit -m "test(editor): CopyPromptDialog clipboard happy path and fallback"
```

---

### Task 4.4: Error state + Retry button test

**Files:**
- Modify: `tests/components/editor/CopyPromptDialog.test.tsx`

- [ ] **Step 1: Add an error-state test with a functioning Retry button**

Append to the `describe` block:

```tsx
  it("renders error state and Retry re-fetches", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ ok: false, error: "bible not found" }),
            { status: 404 },
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(SAMPLE_PROMPT), { status: 200 }),
      );
    }) as typeof globalThis.fetch;

    const { unmount } = mount(
      <CopyPromptDialog open slug="s" chapterId="c" onOpenChange={() => {}} />,
    );
    await flush();
    expect(document.body.textContent).toContain("Error: bible not found");

    const retryBtn = Array.from(
      document.body.querySelectorAll("button"),
    ).find((b) => b.textContent?.trim() === "Retry") as HTMLButtonElement;
    expect(retryBtn).toBeDefined();

    await act(async () => {
      retryBtn.click();
      await flush();
    });

    expect(callCount).toBe(2);
    expect(document.body.textContent).toContain("# Story bible");
    unmount();
  });
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run tests/components/editor/CopyPromptDialog.test.tsx`
Expected: **PASS** (5 tests total).

- [ ] **Step 3: Commit**

```bash
git add tests/components/editor/CopyPromptDialog.test.tsx
git commit -m "test(editor): CopyPromptDialog error state and Retry"
```

---

### Task 4.5: Wire Copy-prompt button + dialog into `EditorPane`

The button belongs in the empty-state CTA area — same slot as the Generate button. After generation, that slot unmounts; that's acceptable for v1 (users who want to regenerate will use the Import dialog round-trip on a fresh chapter, or can live without re-copying).

**Files:**
- Modify: `components/editor/EditorPane.tsx`

- [ ] **Step 1: Add imports and dialog state**

At the top of `EditorPane.tsx`, alongside the other `components/editor/*` imports, add:

```tsx
import { CopyPromptButton } from "@/components/editor/CopyPromptButton";
import { CopyPromptDialog } from "@/components/editor/CopyPromptDialog";
```

Inside the `EditorPane` function body, alongside the existing `useState` calls (look for `pendingDeleteSectionId` or similar local state), add:

```tsx
const [copyPromptOpen, setCopyPromptOpen] = useState(false);
```

- [ ] **Step 2: Add the button to the `generateSlot` prop and render the dialog**

Find the `generateSlot={…}` prop passed to `<SectionList />` (it currently contains just `<GenerateChapterButton …/>`). Replace with:

```tsx
generateSlot={
  <div className="flex flex-col items-center gap-2">
    <GenerateChapterButton
      onGenerate={handleGenerate}
      disabled={generateDisabled}
    />
    {chapterId ? (
      <CopyPromptButton onClick={() => setCopyPromptOpen(true)} />
    ) : null}
  </div>
}
```

Then, inside the existing return's top-level `<div>` (where the other Dialog for `pendingDeleteSectionId` is rendered), add the CopyPromptDialog sibling:

```tsx
{chapterId ? (
  <CopyPromptDialog
    open={copyPromptOpen}
    onOpenChange={setCopyPromptOpen}
    slug={slug}
    chapterId={chapterId}
  />
) : null}
```

- [ ] **Step 3: Typecheck and run the full test suite**

```bash
npm run typecheck
npm test
```

Both must exit 0 / green. If the EditorPane has its own component test that asserts on `generateSlot` markup, update it to accommodate the wrapping `<div className="flex flex-col …">`.

- [ ] **Step 4: Manually smoke-test in the dev server (UI feature — do not skip)**

```bash
npm run dev
```

Open `http://127.0.0.1:3000/`, open an existing story with an empty chapter (or create one), and verify:
1. The "Copy prompt" button appears below "Generate chapter" in the empty state.
2. Clicking it opens the dialog.
3. The preview contains `# Story bible`, `# Prior chapter recaps`, `# Current chapter: <title>`.
4. The meta strip shows the right chapter index, recap count, and model.
5. Clicking Copy shows the "Prompt copied" toast; the clipboard contains the combined prompt (paste into a scratch document to verify).
6. Close and re-open — the preview re-fetches (so edits to beats/summary in the editor appear).

If any of those fail, fix before proceeding. Type-checking and unit tests verify code correctness, not feature correctness — the manual smoke is non-negotiable for UI work.

- [ ] **Step 5: Commit**

```bash
git add components/editor/EditorPane.tsx
git commit -m "feat(editor): wire Copy-prompt button and dialog into empty-state CTA"
```

---

## Chunk 5: End-to-end test

### Task 5.1: Playwright e2e — open dialog, verify content, click Copy

**Files:**
- Create: `tests/e2e/copy-prompt.spec.ts`

- [ ] **Step 1: Write the e2e test**

Mirrors the pattern in [tests/e2e/publishing-kit.spec.ts](../../../tests/e2e/publishing-kit.spec.ts).

Create `tests/e2e/copy-prompt.spec.ts`:

```ts
/**
 * Copy-prompt E2E: create story → add a chapter with beats → open editor
 * → click "Copy prompt" → verify dialog content → click Copy → verify toast.
 *
 * Runs against the isolated dev server on port 3001 with SCRIPTR_DATA_DIR=/tmp/scriptr-e2e
 * (see playwright.config.ts). No Grok traffic — this feature has no external surface.
 */
import { test, expect } from "@playwright/test";

test("copy prompt dialog opens, renders preview, copy action fires a toast", async ({
  page,
}) => {
  // Seed a story.
  const createRes = await page.request.post(
    "http://127.0.0.1:3001/api/stories",
    { data: { title: "Copy Prompt E2E", authorPenName: "Test Author" } },
  );
  expect(createRes.ok()).toBeTruthy();
  const { data: story } = (await createRes.json()) as {
    data: { slug: string };
  };

  // Put a minimal bible.
  await page.request.put(
    `http://127.0.0.1:3001/api/stories/${story.slug}/bible`,
    {
      data: {
        characters: [{ name: "Alice", description: "curious cat" }],
        setting: "attic",
        pov: "third-limited",
        tone: "whimsical",
        styleNotes: "",
        nsfwPreferences: "",
      },
    },
  );

  // Add a chapter with beats.
  const chapterRes = await page.request.post(
    `http://127.0.0.1:3001/api/stories/${story.slug}/chapters`,
    { data: { title: "Opening", beats: ["Alice wakes up"] } },
  );
  expect(chapterRes.ok()).toBeTruthy();

  // Navigate to the editor.
  await page.goto(`http://127.0.0.1:3001/s/${story.slug}`);

  // The empty state shows both Generate and Copy prompt.
  const copyPromptBtn = page.getByRole("button", { name: /copy prompt/i });
  await expect(copyPromptBtn).toBeVisible();
  await copyPromptBtn.click();

  // Dialog opens — preview contains the expected sections.
  await expect(page.getByText("Copy chapter prompt")).toBeVisible();
  // The preview is inside a <pre>; scope the assertion to dialog content.
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("# Story bible");
  await expect(dialog).toContainText("# Prior chapter recaps");
  await expect(dialog).toContainText("# Current chapter:");
  await expect(dialog).toContainText("Alice wakes up");

  // Click Copy. The toast that appears can be either the success path
  // ("Prompt copied") or the clipboard-fallback path ("Select and copy
  // manually…") — Chromium's clipboard permission under Playwright is
  // flaky. Either outcome is acceptable; assert that one of them appears.
  await dialog.getByRole("button", { name: /^copy$/i }).click();
  await expect(
    page
      .getByText(/Prompt copied|Select and copy manually/)
      .first(),
  ).toBeVisible({ timeout: 5_000 });
});
```

- [ ] **Step 2: Run the e2e test**

Run: `npm run e2e -- tests/e2e/copy-prompt.spec.ts`
Expected: **PASS**. If the dialog locator is ambiguous (because `getByRole("dialog")` matches multiple hidden dialogs), narrow with `.last()` or add a `data-testid="copy-prompt-dialog"` prop to `DialogContent` in `CopyPromptDialog.tsx` and scope with `page.getByTestId`.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/copy-prompt.spec.ts
git commit -m "test(e2e): copy-prompt dialog flow"
```

---

## Final verification

- [ ] **Step 1: Run the full unit/integration suite**

Run: `npm test`
Expected: **all green**. Count should be greater than the pre-plan baseline by the count of tests this plan added (10 helper + 4 route + 5 component = 19 new `it` blocks, plus the one egress insertion).

- [ ] **Step 2: Run typecheck + lint**

```bash
npm run typecheck
npm run lint
```

Both exit 0. In particular, `npm run lint` must not complain about `scriptr/no-telemetry` — this feature adds no new packages.

- [ ] **Step 3: Run the full e2e suite**

Run: `npm run e2e`
Expected: all specs pass, including the pre-existing golden-path and publishing-kit suites plus the new copy-prompt spec.

- [ ] **Step 4: Skim the diff**

```bash
git log --oneline main..HEAD
git diff main..HEAD --stat
```

Expected: ~9 new files, ~2 modified files, ~600–700 lines added, ~25 lines removed (the inline block in `handleFull`). No changes outside `app/api/`, `lib/`, `components/editor/`, `tests/`, or the two spec/plan docs.

- [ ] **Step 5: Finishing the branch**

Use @superpowers:finishing-a-development-branch to decide whether to open a PR, merge, or continue iterating.

---

## Appendix: debugging notes

**If the byte-for-byte guardrail test fails:** The helper's priorRecaps / lastChapterFullText assembly logic has diverged from the inline generate-route logic it was supposed to replace. Diff the helper's body against [app/api/generate/route.ts:251-265](../../../app/api/generate/route.ts) (pre-refactor — use `git show main:app/api/generate/route.ts`) and align.

**If the existing `tests/api/generate.test.ts` fails after Task 2.1 (`.last-payload.json` content drift):** the refactor silently dropped or reordered one of `{ model, mode, system, user }`. Re-read the original write and replicate it exactly — this file's contents are load-bearing for the Privacy panel.

**If Playwright's clipboard write throws in the e2e test and the fallback toast doesn't appear:** the `navigator.clipboard` object may be undefined entirely under Playwright's Chromium config. Check if a `try { await navigator.clipboard.writeText(…) }` without a `catch` is being hit before the object exists. The component's try/catch already covers this, but if a new code path is added that doesn't, the e2e will surface it.

**Storage helper names confirmed against the codebase at plan-write time:** `saveBible` (not `putBible`), `saveConfig` (not `writeConfig`, and it takes `Partial<Config>` — no need to spread existing config into it), `updateStory`, `createStory`, `getStory`, `createChapter`, `getChapter`, `listChapters`. If any of these have been renamed by the time you implement, run `rg "^export" lib/storage/*.ts lib/config.ts` to find the current names.
