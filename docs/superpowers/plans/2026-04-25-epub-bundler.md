# EPUB Bundler Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Bundle" first-class entity that combines multiple existing stories into a single EPUB ("omnibus" / "box set") with a centered title page between each story, optional per-story title/description overrides, a TOC outline preview, and dual EPUB2/EPUB3 output.

**Architecture:** A new `Bundle` entity at `data/bundles/<slug>/bundle.json` references stories by slug. The build pipeline composes a synthetic flat chapter list — title page entry + that story's chapters, repeated per story — and hands it to the same `epub-gen-memory` generator the single-story export already uses. UI lives at `/bundles` (list) and `/bundles/[slug]` (editor with two-column layout: config + story list on the left, collapsible TOC preview on the right). The preview pane reuses the existing `SafeHtml` sanitizer for defense-in-depth on rendered chapter HTML.

**Tech Stack:** Next.js 16 (App Router, server components), TypeScript strict, React 19, Tailwind 4, shadcn/ui, SWR, `@dnd-kit/core` + `@dnd-kit/sortable` for reorder, `epub-gen-memory` for EPUB generation, `@likecoin/epubcheck-ts` for validation, `sharp` for cover handling, `jszip` (devDep) for test inspection, `isomorphic-dompurify` (via existing `SafeHtml`), Vitest, Playwright.

**Spec:** [docs/superpowers/specs/2026-04-25-epub-bundler-design.md](../specs/2026-04-25-epub-bundler-design.md)

---

## Conventions

- Every test step shows the exact `npx vitest run …` (or Playwright) command and the expected pass/fail.
- Every commit step lists the exact files to `git add`. Do **not** use `git add .` or `git add -A` — `data/` and worktree state must not leak into commits.
- All new code is TypeScript strict-mode clean; run `npm run typecheck` after each chunk.
- All new code lints clean; `npm run lint` after each chunk. The `scriptr/no-telemetry` rule must pass — bundle code must never import any tracker.
- File-path conventions in this plan use the **repo root** (`/home/chase/projects/scriptr/`).
- **Subagent cwd discipline (per AGENTS.md):** if executing in a worktree (`/home/chase/projects/scriptr/.worktrees/<name>/`), every implementer prompt must include the absolute worktree path AND every `git add` / test command must be prefixed with `cd <worktree>` or use the absolute path. After each task DONE, spot-check `git status` in the main checkout — stray files there mean a subagent wrote to the wrong cwd.
- **Privacy is a project pillar.** Bundle code must not call `fetch`, must not log raw payloads, and every new API route must be added to [tests/privacy/no-external-egress.test.ts](../../tests/privacy/no-external-egress.test.ts). No exceptions.
- TDD: every task starts with a failing test. No "I'll add tests later." A task isn't done until tests pass and a commit exists.

## File Structure

| File | Status | Responsibility |
|------|--------|----------------|
| `lib/types.ts` | modify | Add `Bundle`, `BundleStoryRef`, `BundleSummary` types |
| `lib/storage/paths.ts` | modify | Add `bundlesDir`, `bundleDir`, `bundleFile`, `bundleCoverPath`, `bundleExportsDir`, `bundleEpubPath` helpers |
| `lib/storage/bundles.ts` | **new** | Pure disk I/O for bundles: list/read/write/create/delete |
| `lib/publish/epub-preview.ts` | modify | Export `renderStoryTitlePageHtml`, `stripPreviewWrapper`; extend `EPUB_STYLESHEET` with `.story-title-page` rules |
| `lib/publish/epub.ts` | modify | Replace inline `.replace()` wrapper-strip with shared `stripPreviewWrapper`; extract author-note append + `externalizeDataPngImages` as exported helpers (no behavior change) |
| `lib/publish/author-note.ts` | modify | Add `resolveBundleAuthorNote(profile)` — resolves `ResolvedAuthorNote` from a pen-name profile alone (no Story override) |
| `lib/publish/epub-bundle.ts` | **new** | `buildBundleEpubBytes(input)` — assembles synthetic chapter list, optionally appends bundle-level author note, calls `epub-gen-memory` |
| `app/api/bundles/route.ts` | **new** | `GET` (list) + `POST` (create) |
| `app/api/bundles/[slug]/route.ts` | **new** | `GET` + `PATCH` + `DELETE` |
| `app/api/bundles/[slug]/cover/route.ts` | **new** | `PUT` (multipart upload) + `DELETE` |
| `app/api/bundles/[slug]/preview/route.ts` | **new** | `GET` — resolved bundle structure for the preview pane |
| `app/api/bundles/[slug]/export/epub/route.ts` | **new** | `POST` — build, validate, write to `exports/`, return `{ path, bytes, version, warnings }` |
| `components/layout/TopBar.tsx` | modify | Add "Bundles" nav link between "Library" and "Settings" |
| `app/bundles/page.tsx` | **new** | Bundle list page (server component shell + client list component) |
| `components/bundles/BundleList.tsx` | **new** | Client list with cards + "New bundle" dialog |
| `components/bundles/NewBundleDialog.tsx` | **new** | Title-only create form |
| `app/bundles/[slug]/page.tsx` | **new** | Bundle editor page (server shell) |
| `components/bundles/BundleEditor.tsx` | **new** | Two-column editor — root client component |
| `components/bundles/BundleMetadataPane.tsx` | **new** | Left column: bundle metadata fields (title, author, description, language) + cover + version toggle + build button |
| `components/bundles/BundleStoryList.tsx` | **new** | Drag-to-reorder story list with override editing and "Add story…" button |
| `components/bundles/AddStoryDialog.tsx` | **new** | Multi-select dialog of stories not yet in the bundle |
| `components/bundles/BundlePreviewPane.tsx` | **new** | Right column: collapsible TOC tree + render area (renders via `SafeHtml`) |
| `tests/lib/storage/bundles.test.ts` | **new** | Unit tests for bundle storage helpers |
| `tests/lib/publish-epub-bundle.test.ts` | **new** | Unit tests for `buildBundleEpubBytes` |
| `tests/lib/paths.test.ts` | modify | Add cases for new bundle path helpers |
| `tests/api/bundles.test.ts` | **new** | Handler-level tests for `/api/bundles` and `/api/bundles/[slug]` |
| `tests/api/bundles.cover.test.ts` | **new** | Handler-level tests for cover upload/delete |
| `tests/api/bundles.preview.test.ts` | **new** | Handler-level tests for `/api/bundles/[slug]/preview` |
| `tests/api/bundles.export.test.ts` | **new** | Handler-level tests for export route |
| `tests/privacy/no-external-egress.test.ts` | modify | Exercise every new bundles route, assert `recorded === []` |
| `tests/e2e/bundles.spec.ts` | **new** | E2E happy path: create stories → create bundle → reorder → override → build EPUB |

---

## Chunk 1: Foundations (types, paths, storage)

**Goal of this chunk:** Add `Bundle` types, path helpers, and a storage module that can round-trip bundle JSON and metadata. No build pipeline, no API, no UI yet. After this chunk, you can construct/persist/list/delete bundles via direct function calls.

### Task 1.1: Add Bundle types to `lib/types.ts`

**Files:**
- Modify: `lib/types.ts` (append at end)
- Test: `tests/lib/types.test.ts` (modify — exists)

- [ ] **Step 1: Write the failing test**

Append to `tests/lib/types.test.ts`:

```ts
import type { Bundle, BundleStoryRef, BundleSummary } from "@/lib/types";

describe("Bundle types", () => {
  it("Bundle has required fields and ordered stories array", () => {
    const b: Bundle = {
      slug: "omnibus",
      title: "Omnibus",
      authorPenName: "Pen",
      description: "Three short stories.",
      language: "en",
      createdAt: "2026-04-25T00:00:00.000Z",
      updatedAt: "2026-04-25T00:00:00.000Z",
      stories: [{ storySlug: "story-a" }],
    };
    expect(b.stories).toHaveLength(1);
  });

  it("BundleStoryRef supports optional title and description overrides", () => {
    const ref: BundleStoryRef = {
      storySlug: "story-b",
      titleOverride: "Book Two: Story B",
      descriptionOverride: "A new blurb for the bundle context.",
    };
    expect(ref.titleOverride).toBe("Book Two: Story B");
    expect(ref.descriptionOverride).toContain("blurb");
  });

  it("BundleSummary has slug, title, storyCount, updatedAt", () => {
    const s: BundleSummary = {
      slug: "omnibus",
      title: "Omnibus",
      storyCount: 3,
      updatedAt: "2026-04-25T00:00:00.000Z",
    };
    expect(s.storyCount).toBe(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/types.test.ts`
Expected: FAIL — TypeScript errors that `Bundle`, `BundleStoryRef`, `BundleSummary` are not exported from `@/lib/types`.

- [ ] **Step 3: Add the types**

Append to `lib/types.ts`:

```ts
export type BundleStoryRef = {
  storySlug: string;
  titleOverride?: string;
  descriptionOverride?: string;
};

export type Bundle = {
  slug: string;
  title: string;
  authorPenName: string;
  description: string;
  language: string;
  createdAt: string;
  updatedAt: string;
  stories: BundleStoryRef[];
};

export type BundleSummary = {
  slug: string;
  title: string;
  storyCount: number;
  updatedAt: string;
};
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/lib/types.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts tests/lib/types.test.ts
git commit -m "feat(types): add Bundle, BundleStoryRef, BundleSummary"
```

### Task 1.2: Add bundle path helpers to `lib/storage/paths.ts`

**Files:**
- Modify: `lib/storage/paths.ts`
- Test: `tests/lib/paths.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/lib/paths.test.ts`:

```ts
import {
  bundlesDir,
  bundleDir,
  bundleFile,
  bundleCoverPath,
  bundleExportsDir,
  bundleEpubPath,
} from "@/lib/storage/paths";

describe("bundle path helpers", () => {
  const dataDir = "/data";

  it("bundlesDir returns <dataDir>/bundles", () => {
    expect(bundlesDir(dataDir)).toBe("/data/bundles");
  });

  it("bundleDir returns <dataDir>/bundles/<slug>", () => {
    expect(bundleDir(dataDir, "omnibus")).toBe("/data/bundles/omnibus");
  });

  it("bundleFile returns <dataDir>/bundles/<slug>/bundle.json", () => {
    expect(bundleFile(dataDir, "omnibus")).toBe("/data/bundles/omnibus/bundle.json");
  });

  it("bundleCoverPath returns <dataDir>/bundles/<slug>/cover.jpg", () => {
    expect(bundleCoverPath(dataDir, "omnibus")).toBe("/data/bundles/omnibus/cover.jpg");
  });

  it("bundleExportsDir returns <dataDir>/bundles/<slug>/exports", () => {
    expect(bundleExportsDir(dataDir, "omnibus")).toBe("/data/bundles/omnibus/exports");
  });

  it("bundleEpubPath returns versioned path under exports/", () => {
    expect(bundleEpubPath(dataDir, "omnibus", 3)).toBe(
      "/data/bundles/omnibus/exports/omnibus-epub3.epub"
    );
    expect(bundleEpubPath(dataDir, "omnibus", 2)).toBe(
      "/data/bundles/omnibus/exports/omnibus-epub2.epub"
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/lib/paths.test.ts`
Expected: FAIL — bundle helpers not exported.

- [ ] **Step 3: Add the helpers**

Append to `lib/storage/paths.ts`:

```ts
export function bundlesDir(dataDir: string) {
  return join(dataDir, "bundles");
}
export function bundleDir(dataDir: string, bundleSlug: string) {
  return join(bundlesDir(dataDir), bundleSlug);
}
export function bundleFile(dataDir: string, bundleSlug: string) {
  return join(bundleDir(dataDir, bundleSlug), "bundle.json");
}
export function bundleCoverPath(dataDir: string, bundleSlug: string) {
  return join(bundleDir(dataDir, bundleSlug), "cover.jpg");
}
export function bundleExportsDir(dataDir: string, bundleSlug: string) {
  return join(bundleDir(dataDir, bundleSlug), "exports");
}
export function bundleEpubPath(
  dataDir: string,
  bundleSlug: string,
  version: EpubVersion
) {
  return join(
    bundleExportsDir(dataDir, bundleSlug),
    `${bundleSlug}-epub${version}.epub`
  );
}
```

(Filename pattern matches the single-story export's `${slug}-epub${version}.epub` — keeps both feature areas predictable.)

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/lib/paths.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/storage/paths.ts tests/lib/paths.test.ts
git commit -m "feat(paths): add bundle path helpers"
```

### Task 1.3: Implement `lib/storage/bundles.ts`

**Files:**
- Create: `lib/storage/bundles.ts`
- Test: `tests/lib/storage/bundles.test.ts` (new)

The storage module mirrors `lib/storage/stories.ts`. Pure disk I/O, no network. Functions: `createBundle`, `listBundles`, `getBundle`, `updateBundle`, `deleteBundle`.

- [ ] **Step 1: Write failing tests**

Create `tests/lib/storage/bundles.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtemp, rm, access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createBundle,
  listBundles,
  getBundle,
  updateBundle,
  deleteBundle,
} from "@/lib/storage/bundles";
import { bundleDir } from "@/lib/storage/paths";

async function withTemp(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "scriptr-bundles-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("createBundle", () => {
  it("writes bundle.json with the expected shape and creates exports/", async () => {
    await withTemp(async (dir) => {
      const bundle = await createBundle(dir, { title: "Box Set" });

      const bundlePath = join(dir, "bundles", bundle.slug, "bundle.json");
      const exportsPath = join(dir, "bundles", bundle.slug, "exports");
      await expect(access(bundlePath)).resolves.toBeUndefined();
      await expect(access(exportsPath)).resolves.toBeUndefined();

      const data = JSON.parse(await readFile(bundlePath, "utf-8"));
      expect(data.slug).toBe("box-set");
      expect(data.title).toBe("Box Set");
      expect(data.authorPenName).toBe("");
      expect(data.description).toBe("");
      expect(data.language).toBe("en");
      expect(data.stories).toEqual([]);
      expect(data.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(data.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  it("slug collision yields unique slug", async () => {
    await withTemp(async (dir) => {
      const a = await createBundle(dir, { title: "Collection" });
      const b = await createBundle(dir, { title: "Collection" });
      expect(a.slug).toBe("collection");
      expect(b.slug).toBe("collection-2");
    });
  });
});

describe("listBundles", () => {
  it("returns empty array when bundles dir does not exist", async () => {
    await withTemp(async (dir) => {
      expect(await listBundles(dir)).toEqual([]);
    });
  });

  it("returns BundleSummary entries sorted by updatedAt desc", async () => {
    await withTemp(async (dir) => {
      const a = await createBundle(dir, { title: "Alpha" });
      await new Promise((r) => setTimeout(r, 10));
      const b = await createBundle(dir, { title: "Beta" });

      const list = await listBundles(dir);
      expect(list).toHaveLength(2);
      expect(list[0].slug).toBe(b.slug);
      expect(list[1].slug).toBe(a.slug);
      expect(list[0].storyCount).toBe(0);
    });
  });

  it("storyCount counts ALL refs including missing slugs", async () => {
    await withTemp(async (dir) => {
      const created = await createBundle(dir, { title: "Mixed" });
      await updateBundle(dir, created.slug, {
        stories: [
          { storySlug: "exists-but-not-on-disk-1" },
          { storySlug: "exists-but-not-on-disk-2" },
        ],
      });
      const list = await listBundles(dir);
      expect(list[0].storyCount).toBe(2);
    });
  });

  it("skips malformed bundle.json entries", async () => {
    await withTemp(async (dir) => {
      const good = await createBundle(dir, { title: "Good" });

      const { mkdir, writeFile } = await import("node:fs/promises");
      await mkdir(join(dir, "bundles", "broken"), { recursive: true });
      await writeFile(join(dir, "bundles", "broken", "bundle.json"), "not json");

      const list = await listBundles(dir);
      expect(list).toHaveLength(1);
      expect(list[0].slug).toBe(good.slug);
    });
  });
});

describe("getBundle", () => {
  it("returns the bundle for an existing slug", async () => {
    await withTemp(async (dir) => {
      const created = await createBundle(dir, { title: "Findable" });
      const found = await getBundle(dir, created.slug);
      expect(found?.slug).toBe(created.slug);
      expect(found?.title).toBe("Findable");
    });
  });

  it("returns null for a missing slug", async () => {
    await withTemp(async (dir) => {
      expect(await getBundle(dir, "nope")).toBeNull();
    });
  });
});

describe("updateBundle", () => {
  it("applies patch, bumps updatedAt, preserves slug+createdAt", async () => {
    await withTemp(async (dir) => {
      const created = await createBundle(dir, { title: "Original" });
      await new Promise((r) => setTimeout(r, 10));
      const updated = await updateBundle(dir, created.slug, {
        title: "Renamed",
        authorPenName: "Pen",
        description: "Blurb",
        stories: [{ storySlug: "story-a", titleOverride: "Book One" }],
      });
      expect(updated.title).toBe("Renamed");
      expect(updated.authorPenName).toBe("Pen");
      expect(updated.description).toBe("Blurb");
      expect(updated.stories).toEqual([
        { storySlug: "story-a", titleOverride: "Book One" },
      ]);
      expect(updated.slug).toBe(created.slug);
      expect(updated.createdAt).toBe(created.createdAt);
      expect(updated.updatedAt).not.toBe(created.updatedAt);
    });
  });

  it("attempt to override slug or createdAt is ignored", async () => {
    await withTemp(async (dir) => {
      const created = await createBundle(dir, { title: "Immutable Bits" });
      const updated = await updateBundle(dir, created.slug, {
        // @ts-expect-error — intentionally pass forbidden fields to verify they're stripped
        slug: "hacked",
        // @ts-expect-error
        createdAt: "1999-01-01T00:00:00.000Z",
      });
      expect(updated.slug).toBe(created.slug);
      expect(updated.createdAt).toBe(created.createdAt);
    });
  });

  it("throws when slug not found", async () => {
    await withTemp(async (dir) => {
      await expect(updateBundle(dir, "nope", { title: "x" })).rejects.toThrow(
        /not found/i
      );
    });
  });
});

describe("deleteBundle", () => {
  it("removes the entire bundle folder", async () => {
    await withTemp(async (dir) => {
      const b = await createBundle(dir, { title: "Ephemeral" });
      const path = bundleDir(dir, b.slug);
      await deleteBundle(dir, b.slug);
      await expect(access(path)).rejects.toThrow();
    });
  });

  it("delete is idempotent (no throw when slug already gone)", async () => {
    await withTemp(async (dir) => {
      await expect(deleteBundle(dir, "never-existed")).resolves.toBeUndefined();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/storage/bundles.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the storage module**

Create `lib/storage/bundles.ts`:

```ts
import { mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { bundleDir, bundleFile, bundleExportsDir, bundlesDir } from "@/lib/storage/paths";
import { toSlug, uniqueSlug } from "@/lib/slug";
import type { Bundle, BundleSummary } from "@/lib/types";

export type NewBundleInput = { title: string };

export async function createBundle(
  dataDir: string,
  input: NewBundleInput
): Promise<Bundle> {
  const existing = await listBundles(dataDir);
  const slug = uniqueSlug(toSlug(input.title), existing.map((b) => b.slug));

  const now = new Date().toISOString();
  const bundle: Bundle = {
    slug,
    title: input.title,
    authorPenName: "",
    description: "",
    language: "en",
    createdAt: now,
    updatedAt: now,
    stories: [],
  };

  await mkdir(bundleDir(dataDir, slug), { recursive: true });
  await writeFile(bundleFile(dataDir, slug), JSON.stringify(bundle, null, 2), "utf-8");
  await mkdir(bundleExportsDir(dataDir, slug), { recursive: true });

  return bundle;
}

export async function listBundles(dataDir: string): Promise<BundleSummary[]> {
  let entries: string[];
  try {
    entries = await readdir(bundlesDir(dataDir));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const summaries: BundleSummary[] = [];
  for (const entry of entries) {
    try {
      const raw = await readFile(bundleFile(dataDir, entry), "utf-8");
      const b = JSON.parse(raw) as Bundle;
      summaries.push({
        slug: b.slug,
        title: b.title,
        storyCount: b.stories.length,
        updatedAt: b.updatedAt,
      });
    } catch {
      // skip malformed or non-bundle entries
    }
  }

  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getBundle(dataDir: string, slug: string): Promise<Bundle | null> {
  try {
    const raw = await readFile(bundleFile(dataDir, slug), "utf-8");
    return JSON.parse(raw) as Bundle;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function updateBundle(
  dataDir: string,
  slug: string,
  patch: Partial<Bundle>
): Promise<Bundle> {
  const existing = await getBundle(dataDir, slug);
  if (!existing) throw new Error(`Bundle not found: ${slug}`);

  const updated: Bundle = {
    ...existing,
    ...patch,
    // Immutable
    slug: existing.slug,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };

  await writeFile(bundleFile(dataDir, slug), JSON.stringify(updated, null, 2), "utf-8");
  return updated;
}

export async function deleteBundle(dataDir: string, slug: string): Promise<void> {
  await rm(bundleDir(dataDir, slug), { recursive: true, force: true });
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/lib/storage/bundles.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add lib/storage/bundles.ts tests/lib/storage/bundles.test.ts
git commit -m "feat(storage): add bundle storage helpers"
```

### Task 1.4: Chunk close-out — full quality gates

- [ ] **Step 1: Run the full quality gates**

Run from repo root:
```bash
npm run lint && npm run typecheck && npx vitest run tests/lib/types.test.ts tests/lib/paths.test.ts tests/lib/storage/bundles.test.ts
```
Expected: all PASS.

- [ ] **Step 2: Verify no stray edits in the main checkout**

If working in a worktree, run from `/home/chase/projects/scriptr`:
```bash
git status
```
Expected: clean. If files appear, a subagent wrote to the wrong cwd — see AGENTS.md "Subagent cwd discipline".

---

## Chunk 2: Build pipeline (preview helpers + epub-bundle module)

**Goal of this chunk:** Produce EPUB bytes from a `Bundle + resolved stories` input. Reuses the same `epub-gen-memory` generator the single-story export uses, but with synthetic title-page entries between stories. After this chunk, `buildBundleEpubBytes` works end-to-end as a pure function — callable from tests, but not yet exposed via a route.

### Task 2.1: Add `renderStoryTitlePageHtml` and `stripPreviewWrapper` to `epub-preview.ts`

**Files:**
- Modify: `lib/publish/epub-preview.ts`
- Test: extend `tests/lib/publish-epub.test.ts`

The title page uses `<div class="story-title-page">` rather than `<section>` so the existing `SafeHtml` allowlist (which permits `div, h1, p, strong, em, span`) covers it without modification. Page-break behavior is driven by CSS, not by the tag.

- [ ] **Step 1: Write failing tests**

Append to `tests/lib/publish-epub.test.ts`:

```ts
import {
  renderStoryTitlePageHtml,
  stripPreviewWrapper,
  EPUB_STYLESHEET as STYLESHEET_AGAIN,
} from "@/lib/publish/epub-preview";

describe("renderStoryTitlePageHtml", () => {
  it("renders a centered title with no description block when description is undefined", () => {
    const html = renderStoryTitlePageHtml("My Story");
    expect(html).toContain('class="story-title-page"');
    expect(html).toContain("<h1>My Story</h1>");
    expect(html).not.toContain("<p>");
  });

  it("renders the description as a <p> when provided", () => {
    const html = renderStoryTitlePageHtml("My Story", "A blurb.");
    expect(html).toContain("<h1>My Story</h1>");
    expect(html).toContain("<p>A blurb.</p>");
  });

  it("treats empty-string and whitespace-only descriptions as absent", () => {
    expect(renderStoryTitlePageHtml("X", "")).not.toContain("<p>");
    expect(renderStoryTitlePageHtml("X", "   ")).not.toContain("<p>");
    expect(renderStoryTitlePageHtml("X", "\n\t ")).not.toContain("<p>");
  });

  it("escapes HTML entities in title and description", () => {
    const html = renderStoryTitlePageHtml(
      "<script>x</script>",
      "She & Him <fin>"
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("She &amp; Him &lt;fin&gt;");
  });

  it("uses a div tag (compatible with SafeHtml allowlist)", () => {
    const html = renderStoryTitlePageHtml("Title");
    expect(html.startsWith("<div")).toBe(true);
    expect(html.endsWith("</div>")).toBe(true);
  });
});

describe("stripPreviewWrapper", () => {
  it("removes the outer .epub-preview div", () => {
    const wrapped = '<div class="epub-preview"><h1>X</h1></div>';
    expect(stripPreviewWrapper(wrapped)).toBe("<h1>X</h1>");
  });

  it("returns the input unchanged when wrapper not present", () => {
    expect(stripPreviewWrapper("<p>nope</p>")).toBe("<p>nope</p>");
  });
});

describe("EPUB_STYLESHEET — story title page", () => {
  it("includes a .story-title-page rule with page-break-before", () => {
    expect(STYLESHEET_AGAIN).toMatch(/\.story-title-page/);
    expect(STYLESHEET_AGAIN).toMatch(/\.story-title-page[^}]*page-break-before/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/lib/publish-epub.test.ts`
Expected: FAIL — `renderStoryTitlePageHtml` and `stripPreviewWrapper` not exported; stylesheet rule missing.

- [ ] **Step 3: Implement helpers and extend stylesheet**

In `lib/publish/epub-preview.ts`:

(a) Add the new stylesheet rules to `EPUB_STYLESHEET`. Append before the closing backtick:

```ts
.story-title-page {
  page-break-before: always;
  text-align: center;
  padding: 2em 0;
}
.story-title-page h1 {
  font-size: 1.8em;
  font-weight: 600;
  margin: 0 0 1em;
}
.story-title-page p {
  text-indent: 0;
  text-align: center;
  font-style: italic;
  margin: 0 1em;
}
```

(b) Add the helpers below the existing `escapeHtml` function:

```ts
export function renderStoryTitlePageHtml(title: string, description?: string): string {
  const trimmed = description?.trim() ?? "";
  const descBlock = trimmed.length > 0 ? `<p>${escapeHtml(trimmed)}</p>` : "";
  return `<div class="story-title-page"><h1>${escapeHtml(title)}</h1>${descBlock}</div>`;
}

export function stripPreviewWrapper(html: string): string {
  return html
    .replace(/^<div class="epub-preview">/, "")
    .replace(/<\/div>$/, "");
}
```

Note: `escapeHtml` is currently a private (non-exported) helper in this file — keep it that way; the new helpers call it within the same module.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/lib/publish-epub.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/publish/epub-preview.ts tests/lib/publish-epub.test.ts
git commit -m "feat(epub): add story title-page renderer and shared wrapper-strip helper"
```

### Task 2.2: Replace inline `.replace()` strip in `epub.ts` with shared helper

**Files:**
- Modify: `lib/publish/epub.ts:61-67` (the inline `.replace` on `inner` inside `buildEpubBytes`)
- Test: existing `tests/lib/publish-epub.test.ts` covers `buildEpubBytes` already; add no new test, but the existing tests must continue to pass.

- [ ] **Step 1: Replace the inline strip**

In `lib/publish/epub.ts`, change the import (currently `import { renderChapterPreviewHtml, EPUB_STYLESHEET } from "@/lib/publish/epub-preview";`) to also import `stripPreviewWrapper`:

```ts
import {
  renderChapterPreviewHtml,
  EPUB_STYLESHEET,
  stripPreviewWrapper,
} from "@/lib/publish/epub-preview";
```

Then in the `content.map` block of `buildEpubBytes`, replace:

```ts
const inner = renderChapterPreviewHtml(chapter, { chapterNumber: idx + 1 });
const stripped = inner
  .replace(/^<div class="epub-preview">/, "")
  .replace(/<\/div>$/, "");
return {
  title: chapter.title || `Chapter ${idx + 1}`,
  content: stripped,
};
```

With:

```ts
return {
  title: chapter.title || `Chapter ${idx + 1}`,
  content: stripPreviewWrapper(
    renderChapterPreviewHtml(chapter, { chapterNumber: idx + 1 })
  ),
};
```

- [ ] **Step 2: Run all the existing single-story EPUB tests**

Run: `npx vitest run tests/lib/publish-epub.test.ts tests/lib/publish-epub-smoke.test.ts tests/lib/publish-epub-storage.test.ts`
Expected: all PASS — the byte-level output of the single-story builder is unchanged.

- [ ] **Step 3: Commit**

```bash
git add lib/publish/epub.ts
git commit -m "refactor(epub): use shared stripPreviewWrapper helper"
```

### Task 2.3: Extract author-note append + `externalizeDataPngImages` as exported helpers in `epub.ts`

**Files:**
- Modify: `lib/publish/epub.ts`
- Test: existing `tests/lib/publish-epub.test.ts` covers `buildEpubBytes` byte-level output already; the existing tests must continue to pass.

The bundle builder needs the same author-note append + QR post-processing logic the single-story builder has. Rather than duplicate it, extract it from `buildEpubBytes` into exported helpers that both builders call.

- [ ] **Step 1: Read the current `buildEpubBytes` implementation in `lib/publish/epub.ts`**

The relevant block is the `if (input.authorNote)` body inside the `try { … } finally { /* cleanup tempImagePaths */ }` (search for `buildAuthorNoteHtml`). It calls `buildAuthorNoteHtml`, then `externalizeDataPngImages`, then pushes a `{ title: "A note from the author", content }` entry onto the local `content` array, accumulating temp PNG paths into `tempImagePaths` for outer-scope cleanup.

- [ ] **Step 2: Export `externalizeDataPngImages` from `epub.ts`**

It is currently a module-private function. Change `function externalizeDataPngImages(...)` to `export function externalizeDataPngImages(...)`. No callers outside the module currently — the export is for the bundle builder's `finally` cleanup.

- [ ] **Step 3: Add an exported `appendAuthorNoteContent` helper**

Below the existing `externalizeDataPngImages` definition, add:

```ts
import type { ResolvedAuthorNote } from "@/lib/publish/author-note";

/**
 * Append the author-note entry to a content array. Used by both the
 * single-story builder and the bundle builder. Pushes any temp PNG file
 * paths onto `tempImagePaths` so the caller's `finally` block can clean
 * them up regardless of whether the generator throws.
 */
export async function appendAuthorNoteContent(
  content: Array<{ title: string; content: string }>,
  authorNote: ResolvedAuthorNote,
  tempImagePaths: string[],
): Promise<void> {
  const noteHtml = await buildAuthorNoteHtml(authorNote);
  const { html: rewritten, tempPaths } = await externalizeDataPngImages(noteHtml);
  tempImagePaths.push(...tempPaths);
  content.push({
    title: "A note from the author",
    content: rewritten,
  });
}
```

(`ResolvedAuthorNote` is already imported from `@/lib/publish/author-note` at the top of the file — verify and reuse the existing import; do not add a duplicate.)

- [ ] **Step 4: Replace the inline block in `buildEpubBytes` with the helper call**

Inside the `try { … }` block of `buildEpubBytes`, replace:

```ts
if (input.authorNote) {
  const noteHtml = await buildAuthorNoteHtml(input.authorNote);
  const { html: rewritten, tempPaths } = await externalizeDataPngImages(noteHtml);
  tempImagePaths.push(...tempPaths);
  content.push({
    title: "A note from the author",
    content: rewritten,
  });
}
```

With:

```ts
if (input.authorNote) {
  await appendAuthorNoteContent(content, input.authorNote, tempImagePaths);
}
```

- [ ] **Step 5: Run all the existing single-story EPUB tests + author-note tests**

Run: `npx vitest run tests/lib/publish-epub.test.ts tests/lib/publish-epub-smoke.test.ts tests/lib/publish-epub-storage.test.ts tests/lib/publish-author-note.test.ts`
Expected: all PASS — byte-level single-story output unchanged. The refactor is purely structural.

- [ ] **Step 6: Run typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/publish/epub.ts
git commit -m "refactor(epub): extract appendAuthorNoteContent + export externalizeDataPngImages"
```

### Task 2.4: Add `resolveBundleAuthorNote` helper in `lib/publish/author-note.ts`

**Files:**
- Modify: `lib/publish/author-note.ts`
- Test: extend `tests/lib/publish-author-note.test.ts` (existing)

Bundles don't have a `Story.authorNote` override field, so `resolveAuthorNote(story, profile)` doesn't fit. Add a sibling that takes only the profile.

- [ ] **Step 1: Write failing tests**

Append to `tests/lib/publish-author-note.test.ts`:

```ts
import { resolveBundleAuthorNote } from "@/lib/publish/author-note";
import type { PenNameProfile } from "@/lib/config";

describe("resolveBundleAuthorNote", () => {
  it("returns null for missing profile", () => {
    expect(resolveBundleAuthorNote(undefined)).toBeNull();
  });

  it("returns null for profile with no usable content", () => {
    const profile: PenNameProfile = {
      defaultMessageHtml: "",
      email: "",
      mailingListUrl: "",
    };
    expect(resolveBundleAuthorNote(profile)).toBeNull();
  });

  it("returns null when message and email and mailing list URL are all whitespace", () => {
    const profile: PenNameProfile = {
      defaultMessageHtml: "   ",
      email: "  ",
      mailingListUrl: "\t",
    };
    expect(resolveBundleAuthorNote(profile)).toBeNull();
  });

  it("returns ResolvedAuthorNote when profile has a defaultMessageHtml", () => {
    const profile: PenNameProfile = {
      defaultMessageHtml: "<p>Thanks for reading.</p>",
    };
    const note = resolveBundleAuthorNote(profile);
    expect(note).not.toBeNull();
    expect(note!.messageHtml).toBe("<p>Thanks for reading.</p>");
    expect(note!.email).toBeUndefined();
    expect(note!.mailingListUrl).toBeUndefined();
  });

  it("returns ResolvedAuthorNote when profile has only an email", () => {
    const profile: PenNameProfile = {
      email: "author@example.com",
    };
    const note = resolveBundleAuthorNote(profile);
    expect(note).not.toBeNull();
    expect(note!.email).toBe("author@example.com");
  });

  it("returns ResolvedAuthorNote when profile has only a mailingListUrl", () => {
    const profile: PenNameProfile = {
      mailingListUrl: "https://example.com/subscribe",
    };
    const note = resolveBundleAuthorNote(profile);
    expect(note).not.toBeNull();
    expect(note!.mailingListUrl).toBe("https://example.com/subscribe");
  });

  it("includes all fields when all are present", () => {
    const profile: PenNameProfile = {
      defaultMessageHtml: "<p>Hi.</p>",
      email: "a@b.com",
      mailingListUrl: "https://x.io",
    };
    const note = resolveBundleAuthorNote(profile);
    expect(note).toEqual({
      messageHtml: "<p>Hi.</p>",
      email: "a@b.com",
      mailingListUrl: "https://x.io",
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/lib/publish-author-note.test.ts`
Expected: FAIL — `resolveBundleAuthorNote` not exported.

- [ ] **Step 3: Implement the helper**

Add to `lib/publish/author-note.ts`, below the existing `resolveAuthorNote`:

```ts
export function resolveBundleAuthorNote(
  profile: PenNameProfile | undefined,
): ResolvedAuthorNote | null {
  if (!profile) return null;
  const messageHtml =
    typeof profile.defaultMessageHtml === "string"
      ? profile.defaultMessageHtml.trim()
      : "";
  const email = typeof profile.email === "string" ? profile.email : undefined;
  const mailingListUrl =
    typeof profile.mailingListUrl === "string"
      ? profile.mailingListUrl
      : undefined;
  if (messageHtml.length === 0 && !email?.trim() && !mailingListUrl?.trim()) {
    return null;
  }
  return {
    messageHtml,
    email,
    mailingListUrl,
  };
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/lib/publish-author-note.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/publish/author-note.ts tests/lib/publish-author-note.test.ts
git commit -m "feat(author-note): add resolveBundleAuthorNote profile-only resolver"
```

### Task 2.5: Implement `lib/publish/epub-bundle.ts`

**Files:**
- Create: `lib/publish/epub-bundle.ts`
- Test: `tests/lib/publish-epub-bundle.test.ts` (new)

The builder is pure: takes a `Bundle`, a `Map<storySlug, { story, chapters }>` of resolved refs, an optional cover path, and an optional `ResolvedAuthorNote`. Returns EPUB bytes. The author note (if present) is appended as a final content entry **after all stories' chapters** — exactly one author note per bundle, not per story.

- [ ] **Step 1: Write failing tests**

Create `tests/lib/publish-epub-bundle.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildBundleEpubBytes } from "@/lib/publish/epub-bundle";
import { readOpfVersion } from "./helpers/epub-inspect";
import JSZip from "jszip";
import type { Bundle, Story, Chapter } from "@/lib/types";

function story(slug: string, title: string, description = ""): Story {
  return {
    slug,
    title,
    authorPenName: "Pen",
    description,
    copyrightYear: 2026,
    language: "en",
    bisacCategory: "FIC027000",
    keywords: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    chapterOrder: [],
  };
}

function chapter(id: string, title: string, body = "Some content."): Chapter {
  return {
    id,
    title,
    summary: "",
    beats: [],
    prompt: "",
    recap: "",
    sections: [{ id: `${id}-s1`, content: body }],
    wordCount: 2,
  };
}

function bundle(refs: Bundle["stories"]): Bundle {
  return {
    slug: "omnibus",
    title: "Omnibus",
    authorPenName: "Pen",
    description: "Three short stories.",
    language: "en",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    stories: refs,
  };
}

async function countChapters(bytes: Uint8Array): Promise<number> {
  const zip = await JSZip.loadAsync(bytes);
  return Object.keys(zip.files).filter((n) => /^OEBPS\/.*\.xhtml$/i.test(n)).length;
}

async function readAllText(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const xhtmlNames = Object.keys(zip.files).filter((n) =>
    /^OEBPS\/.*\.xhtml$/i.test(n)
  );
  const parts: string[] = [];
  for (const name of xhtmlNames) {
    parts.push(await zip.file(name)!.async("string"));
  }
  return parts.join("\n");
}

describe("buildBundleEpubBytes", () => {
  it("builds a valid EPUB (zip-magic prefix, OPF version 3 by default)", async () => {
    const stories = new Map([
      ["story-a", { story: story("story-a", "Story A"), chapters: [chapter("c1", "Ch 1")] }],
    ]);
    const bytes = await buildBundleEpubBytes({
      bundle: bundle([{ storySlug: "story-a" }]),
      stories,
    });
    expect(bytes.byteLength).toBeGreaterThan(500);
    const b = Buffer.from(bytes);
    expect(b[0]).toBe(0x50);
    expect(b[1]).toBe(0x4b);
    expect(await readOpfVersion(bytes)).toBe("3.0");
  });

  it("supports version 2", async () => {
    const stories = new Map([
      ["story-a", { story: story("story-a", "Story A"), chapters: [chapter("c1", "Ch 1")] }],
    ]);
    const bytes = await buildBundleEpubBytes({
      bundle: bundle([{ storySlug: "story-a" }]),
      stories,
      version: 2,
    });
    expect(await readOpfVersion(bytes)).toBe("2.0");
  });

  it("emits N title pages + Σ chapters total xhtml entries (plus library boilerplate)", async () => {
    const stories = new Map([
      [
        "story-a",
        {
          story: story("story-a", "Story A"),
          chapters: [chapter("a1", "A1"), chapter("a2", "A2")],
        },
      ],
      ["story-b", { story: story("story-b", "Story B"), chapters: [chapter("b1", "B1")] }],
    ]);
    const bytes = await buildBundleEpubBytes({
      bundle: bundle([{ storySlug: "story-a" }, { storySlug: "story-b" }]),
      stories,
    });
    // 2 title pages + 3 chapters = 5 content xhtml files. epub-gen-memory may add
    // additional structural files (cover, toc) — assert >= 5.
    expect(await countChapters(bytes)).toBeGreaterThanOrEqual(5);
  });

  it("uses titleOverride and descriptionOverride on the title page", async () => {
    const stories = new Map([
      ["story-a", { story: story("story-a", "Original Title", "Original blurb"), chapters: [chapter("c1", "X")] }],
    ]);
    const bytes = await buildBundleEpubBytes({
      bundle: bundle([
        {
          storySlug: "story-a",
          titleOverride: "Bundle Title",
          descriptionOverride: "Bundle blurb.",
        },
      ]),
      stories,
    });
    const text = await readAllText(bytes);
    expect(text).toContain("Bundle Title");
    expect(text).toContain("Bundle blurb.");
    expect(text).not.toContain("Original Title");
    expect(text).not.toContain("Original blurb");
  });

  it("falls back to source story title/description when overrides are absent", async () => {
    const stories = new Map([
      ["story-a", { story: story("story-a", "Source Title", "Source blurb."), chapters: [chapter("c1", "X")] }],
    ]);
    const bytes = await buildBundleEpubBytes({
      bundle: bundle([{ storySlug: "story-a" }]),
      stories,
    });
    const text = await readAllText(bytes);
    expect(text).toContain("Source Title");
    expect(text).toContain("Source blurb.");
  });

  it("omits the description block when source has empty description and no override", async () => {
    const stories = new Map([
      ["story-a", { story: story("story-a", "Naked Title", ""), chapters: [chapter("c1", "X")] }],
    ]);
    const bytes = await buildBundleEpubBytes({
      bundle: bundle([{ storySlug: "story-a" }]),
      stories,
    });
    const text = await readAllText(bytes);
    expect(text).toContain("Naked Title");
    // The .story-title-page block must not contain a stray empty <p>.
    const titlePageMatch = text.match(
      /<div[^>]*class="story-title-page"[^>]*>([\s\S]*?)<\/div>/
    );
    expect(titlePageMatch).not.toBeNull();
    expect(titlePageMatch![1]).not.toMatch(/<p>\s*<\/p>/);
  });

  it("missing-ref refs are silently dropped (caller is responsible for warning); build still succeeds", async () => {
    const stories = new Map([
      ["story-a", { story: story("story-a", "Real"), chapters: [chapter("c1", "x")] }],
    ]);
    const bytes = await buildBundleEpubBytes({
      bundle: bundle([
        { storySlug: "story-a" },
        { storySlug: "missing-story" },
      ]),
      stories,
    });
    expect(bytes.byteLength).toBeGreaterThan(500);
    const text = await readAllText(bytes);
    expect(text).toContain("Real");
    expect(text).not.toContain("missing-story");
  });

  it("handles missing coverPath without crashing", async () => {
    const stories = new Map([
      ["story-a", { story: story("story-a", "X"), chapters: [chapter("c1", "y")] }],
    ]);
    const bytes = await buildBundleEpubBytes({
      bundle: bundle([{ storySlug: "story-a" }]),
      stories,
      coverPath: undefined,
    });
    expect(bytes.byteLength).toBeGreaterThan(500);
  });

  it("appends a single author-note entry at the end when authorNote is provided", async () => {
    const stories = new Map([
      ["story-a", { story: story("story-a", "Story A"), chapters: [chapter("c1", "Ch 1")] }],
      ["story-b", { story: story("story-b", "Story B"), chapters: [chapter("c2", "Ch 2")] }],
    ]);
    const bytes = await buildBundleEpubBytes({
      bundle: bundle([{ storySlug: "story-a" }, { storySlug: "story-b" }]),
      stories,
      authorNote: {
        messageHtml: "<p>Thanks for reading this collection.</p>",
        email: "author@example.com",
      },
    });
    const text = await readAllText(bytes);
    // Author note title and content are present
    expect(text).toContain("A note from the author");
    expect(text).toContain("Thanks for reading this collection.");
    // …and only ONE author-note section, not one per story
    const matches = text.match(/A note from the author/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("omits the author-note entry when authorNote is undefined", async () => {
    const stories = new Map([
      ["story-a", { story: story("story-a", "Story A"), chapters: [chapter("c1", "Ch 1")] }],
    ]);
    const bytes = await buildBundleEpubBytes({
      bundle: bundle([{ storySlug: "story-a" }]),
      stories,
    });
    const text = await readAllText(bytes);
    expect(text).not.toContain("A note from the author");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/lib/publish-epub-bundle.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the builder**

Create `lib/publish/epub-bundle.ts`:

```ts
import { pathToFileURL } from "node:url";
import { rm } from "node:fs/promises";
import {
  renderChapterPreviewHtml,
  renderStoryTitlePageHtml,
  stripPreviewWrapper,
  EPUB_STYLESHEET,
} from "@/lib/publish/epub-preview";
import { appendAuthorNoteContent } from "@/lib/publish/epub";
import type { ResolvedAuthorNote } from "@/lib/publish/author-note";
import type { Bundle, Chapter, Story } from "@/lib/types";
import type { EpubVersion } from "@/lib/storage/paths";

export type ResolvedStory = { story: Story; chapters: Chapter[] };

export type BundleEpubInput = {
  bundle: Bundle;
  stories: Map<string, ResolvedStory>;
  coverPath?: string;
  version?: EpubVersion;
  authorNote?: ResolvedAuthorNote;
};

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
  content: Array<{ title: string; content: string }>,
  version?: 2 | 3,
  verbose?: boolean,
) => Promise<Buffer>;

function getGenerator(): EpubGenFn {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("epub-gen-memory") as { default?: EpubGenFn } & EpubGenFn;
  return (mod.default ?? mod) as EpubGenFn;
}

export async function buildBundleEpubBytes(input: BundleEpubInput): Promise<Uint8Array> {
  const { bundle, stories, coverPath, version = 3, authorNote } = input;

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

  // Track temp PNG files written for the QR data-URL workaround so we can
  // clean them up regardless of whether the generator throws (mirrors the
  // pattern in `buildEpubBytes`).
  const tempImagePaths: string[] = [];

  try {
    if (authorNote) {
      await appendAuthorNoteContent(content, authorNote, tempImagePaths);
    }

    const generator = getGenerator();
    const buffer = await generator(
      {
        title: bundle.title,
        author: bundle.authorPenName,
        description: bundle.description,
        lang: bundle.language || "en",
        // file:// URL avoids the 0-byte-cover gotcha in epub-gen-memory.
        cover: coverPath ? pathToFileURL(coverPath).href : undefined,
        ignoreFailedDownloads: true,
        css: EPUB_STYLESHEET,
      },
      content,
      version,
    );

    return new Uint8Array(buffer);
  } finally {
    // Best-effort cleanup of QR temp PNGs.
    for (const path of tempImagePaths) {
      await rm(path, { force: true }).catch(() => {});
    }
  }
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/lib/publish-epub-bundle.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/publish/epub-bundle.ts tests/lib/publish-epub-bundle.test.ts
git commit -m "feat(epub): add bundle builder"
```

### Task 2.6: Chunk close-out

- [ ] **Step 1: Run quality gates**

Run: `npm run lint && npm run typecheck && npx vitest run tests/lib/publish-epub.test.ts tests/lib/publish-epub-bundle.test.ts tests/lib/publish-epub-smoke.test.ts tests/lib/publish-epub-storage.test.ts tests/lib/publish-author-note.test.ts`
Expected: all PASS.

- [ ] **Step 2: Spot-check main-checkout cleanliness** (worktree mode only)

If using a worktree: `git status` in `/home/chase/projects/scriptr` should be clean.

---

## Chunk 3: API routes + privacy egress test

**Goal of this chunk:** Expose every storage/build operation through HTTP. After this chunk, every UI flow can be implemented purely against `fetch('/api/bundles/...')`. Privacy egress test extended to assert no fetches occur for any new route.

### Task 3.1: `GET/POST /api/bundles`

**Files:**
- Create: `app/api/bundles/route.ts`
- Test: `tests/api/bundles.test.ts` (new)

- [ ] **Step 1: Write failing tests**

Create `tests/api/bundles.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";

describe("/api/bundles", () => {
  const originalEnv = process.env;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scriptr-api-bundles-"));
    process.env = { ...originalEnv, SCRIPTR_DATA_DIR: tmpDir };
    delete process.env.XAI_API_KEY;
  });
  afterEach(async () => {
    process.env = originalEnv;
    await rm(tmpDir, { recursive: true, force: true });
  });

  function makeReq(url: string, init?: RequestInit): NextRequest {
    return new Request(url, init) as unknown as NextRequest;
  }

  it("GET returns empty array on fresh install", async () => {
    const { GET } = await import("@/app/api/bundles/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toEqual([]);
  });

  it("POST creates bundle, returns 201 with summary fields", async () => {
    const { POST } = await import("@/app/api/bundles/route");
    const req = makeReq("http://localhost/api/bundles", {
      method: "POST",
      body: JSON.stringify({ title: "Big Box Set" }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.slug).toBe("big-box-set");
    expect(body.data.title).toBe("Big Box Set");
    expect(body.data.stories).toEqual([]);
  });

  it("POST without title returns 400", async () => {
    const { POST } = await import("@/app/api/bundles/route");
    const res = await POST(
      makeReq("http://localhost/api/bundles", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
      })
    );
    expect(res.status).toBe(400);
  });

  it("POST then GET returns the new bundle", async () => {
    const { POST, GET } = await import("@/app/api/bundles/route");
    await POST(
      makeReq("http://localhost/api/bundles", {
        method: "POST",
        body: JSON.stringify({ title: "Alpha" }),
        headers: { "content-type": "application/json" },
      })
    );
    const res = await GET();
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].title).toBe("Alpha");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/api/bundles.test.ts`
Expected: FAIL — route module missing.

- [ ] **Step 3: Implement the route**

Create `app/api/bundles/route.ts`:

```ts
import type { NextRequest } from "next/server";
import { ok, fail, readJson } from "@/lib/api";
import { createBundle, listBundles } from "@/lib/storage/bundles";
import { effectiveDataDir } from "@/lib/config";

export async function GET() {
  return ok(await listBundles(effectiveDataDir()));
}

export async function POST(req: NextRequest) {
  const body = await readJson<{ title?: unknown }>(req);
  if (typeof body.title !== "string" || body.title.trim() === "") {
    return fail("title required");
  }
  const bundle = await createBundle(effectiveDataDir(), { title: body.title.trim() });
  return ok(bundle, { status: 201 });
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/api/bundles.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/bundles/route.ts tests/api/bundles.test.ts
git commit -m "feat(api): add GET/POST /api/bundles"
```

### Task 3.2: `GET/PATCH/DELETE /api/bundles/[slug]`

**Files:**
- Create: `app/api/bundles/[slug]/route.ts`
- Test: extend `tests/api/bundles.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/api/bundles.test.ts`:

```ts
import { createBundle } from "@/lib/storage/bundles";

describe("/api/bundles/[slug]", () => {
  // re-uses the outer beforeEach/afterEach via module-level closure (vitest hoists describe)

  function makeReq(url: string, init?: RequestInit): NextRequest {
    return new Request(url, init) as unknown as NextRequest;
  }

  it("GET returns bundle for existing slug", async () => {
    const created = await createBundle(process.env.SCRIPTR_DATA_DIR!, { title: "Findable" });
    const { GET } = await import("@/app/api/bundles/[slug]/route");
    const req = makeReq(`http://localhost/api/bundles/${created.slug}`);
    const ctx = { params: Promise.resolve({ slug: created.slug }) };
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.slug).toBe(created.slug);
  });

  it("GET returns 404 for missing slug", async () => {
    const { GET } = await import("@/app/api/bundles/[slug]/route");
    const req = makeReq("http://localhost/api/bundles/nope");
    const ctx = { params: Promise.resolve({ slug: "nope" }) };
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
  });

  it("PATCH updates allowed fields", async () => {
    const created = await createBundle(process.env.SCRIPTR_DATA_DIR!, { title: "Pat" });
    const { PATCH } = await import("@/app/api/bundles/[slug]/route");
    const req = makeReq(`http://localhost/api/bundles/${created.slug}`, {
      method: "PATCH",
      body: JSON.stringify({
        title: "Renamed",
        authorPenName: "Pen",
        description: "Blurb",
        language: "en",
        stories: [{ storySlug: "story-a", titleOverride: "Book One" }],
      }),
      headers: { "content-type": "application/json" },
    });
    const ctx = { params: Promise.resolve({ slug: created.slug }) };
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.title).toBe("Renamed");
    expect(body.data.authorPenName).toBe("Pen");
    expect(body.data.stories[0].titleOverride).toBe("Book One");
  });

  it("PATCH ignores unknown fields", async () => {
    const created = await createBundle(process.env.SCRIPTR_DATA_DIR!, { title: "Filter" });
    const { PATCH } = await import("@/app/api/bundles/[slug]/route");
    const req = makeReq(`http://localhost/api/bundles/${created.slug}`, {
      method: "PATCH",
      body: JSON.stringify({ slug: "hack", createdAt: "1999", junk: "ignored" }),
      headers: { "content-type": "application/json" },
    });
    const ctx = { params: Promise.resolve({ slug: created.slug }) };
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.slug).toBe(created.slug);
    expect(body.data.createdAt).toBe(created.createdAt);
  });

  it("PATCH on missing slug returns 404", async () => {
    const { PATCH } = await import("@/app/api/bundles/[slug]/route");
    const req = makeReq("http://localhost/api/bundles/nope", {
      method: "PATCH",
      body: JSON.stringify({ title: "x" }),
      headers: { "content-type": "application/json" },
    });
    const ctx = { params: Promise.resolve({ slug: "nope" }) };
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(404);
  });

  it("DELETE removes the bundle", async () => {
    const created = await createBundle(process.env.SCRIPTR_DATA_DIR!, { title: "Doomed" });
    const { DELETE } = await import("@/app/api/bundles/[slug]/route");
    const req = makeReq(`http://localhost/api/bundles/${created.slug}`);
    const ctx = { params: Promise.resolve({ slug: created.slug }) };
    const res = await DELETE(req, ctx);
    expect(res.status).toBe(200);

    const { GET } = await import("@/app/api/bundles/[slug]/route");
    const after = await GET(
      makeReq(`http://localhost/api/bundles/${created.slug}`),
      ctx
    );
    expect(after.status).toBe(404);
  });

  it("DELETE on missing slug returns 404", async () => {
    const { DELETE } = await import("@/app/api/bundles/[slug]/route");
    const req = makeReq("http://localhost/api/bundles/nope");
    const ctx = { params: Promise.resolve({ slug: "nope" }) };
    const res = await DELETE(req, ctx);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/api/bundles.test.ts`
Expected: new cases FAIL — module missing.

- [ ] **Step 3: Implement**

Create `app/api/bundles/[slug]/route.ts`:

```ts
import type { NextRequest } from "next/server";
import { ok, fail, readJson } from "@/lib/api";
import { getBundle, updateBundle, deleteBundle } from "@/lib/storage/bundles";
import { effectiveDataDir } from "@/lib/config";
import type { Bundle } from "@/lib/types";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  const bundle = await getBundle(effectiveDataDir(), slug);
  if (!bundle) return fail("bundle not found", 404);
  return ok(bundle);
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  const body = await readJson<Partial<Bundle>>(req);
  const allowed: (keyof Bundle)[] = [
    "title",
    "authorPenName",
    "description",
    "language",
    "stories",
  ];
  const patch: Partial<Bundle> = {};
  for (const k of allowed) {
    if (k in body) (patch as Record<string, unknown>)[k] = body[k];
  }
  try {
    const updated = await updateBundle(effectiveDataDir(), slug, patch);
    return ok(updated);
  } catch {
    return fail("bundle not found", 404);
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  const existing = await getBundle(effectiveDataDir(), slug);
  if (!existing) return fail("bundle not found", 404);
  await deleteBundle(effectiveDataDir(), slug);
  return ok({ deleted: true });
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/api/bundles.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/bundles/\[slug\]/route.ts tests/api/bundles.test.ts
git commit -m "feat(api): add /api/bundles/[slug] CRUD"
```

### Task 3.3: `PUT/DELETE /api/bundles/[slug]/cover`

**Files:**
- Create: `app/api/bundles/[slug]/cover/route.ts`
- Test: `tests/api/bundles.cover.test.ts` (new)

The route mirrors `app/api/stories/[slug]/cover/route.ts`. Uses `sharp` to convert PNG → JPEG and validate dimensions; writes via inline `mkdir + writeFile` against `bundleCoverPath`.

- [ ] **Step 1: Write failing tests**

Create `tests/api/bundles.cover.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import sharp from "sharp";
import { createBundle } from "@/lib/storage/bundles";
import { bundleCoverPath } from "@/lib/storage/paths";

async function makeJpeg(w: number, h: number): Promise<Buffer> {
  return sharp({
    create: { width: w, height: h, channels: 3, background: { r: 80, g: 80, b: 80 } },
  })
    .jpeg({ quality: 85 })
    .toBuffer();
}

describe("/api/bundles/[slug]/cover", () => {
  const originalEnv = process.env;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scriptr-bundle-cover-"));
    process.env = { ...originalEnv, SCRIPTR_DATA_DIR: tmpDir };
  });
  afterEach(async () => {
    process.env = originalEnv;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("PUT 404s for missing bundle", async () => {
    const { PUT } = await import("@/app/api/bundles/[slug]/cover/route");
    const fd = new FormData();
    fd.append("cover", new Blob([await makeJpeg(1600, 2560)], { type: "image/jpeg" }), "c.jpg");
    const req = new Request("http://localhost/api/bundles/nope/cover", {
      method: "PUT",
      body: fd,
    }) as unknown as NextRequest;
    const ctx = { params: Promise.resolve({ slug: "nope" }) };
    const res = await PUT(req, ctx);
    expect(res.status).toBe(404);
  });

  it("PUT writes cover.jpg and warns on small dimensions", async () => {
    const b = await createBundle(tmpDir, { title: "Cov" });
    const { PUT } = await import("@/app/api/bundles/[slug]/cover/route");
    const fd = new FormData();
    fd.append("cover", new Blob([await makeJpeg(800, 1280)], { type: "image/jpeg" }), "c.jpg");
    const req = new Request(`http://localhost/api/bundles/${b.slug}/cover`, {
      method: "PUT",
      body: fd,
    }) as unknown as NextRequest;
    const ctx = { params: Promise.resolve({ slug: b.slug }) };
    const res = await PUT(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.warnings.length).toBeGreaterThan(0);

    await expect(access(bundleCoverPath(tmpDir, b.slug))).resolves.toBeUndefined();
  });

  it("PUT rejects unsupported types", async () => {
    const b = await createBundle(tmpDir, { title: "Bad" });
    const { PUT } = await import("@/app/api/bundles/[slug]/cover/route");
    const fd = new FormData();
    fd.append("cover", new Blob([new Uint8Array([0x47, 0x49, 0x46])], { type: "image/gif" }), "c.gif");
    const req = new Request(`http://localhost/api/bundles/${b.slug}/cover`, {
      method: "PUT",
      body: fd,
    }) as unknown as NextRequest;
    const ctx = { params: Promise.resolve({ slug: b.slug }) };
    const res = await PUT(req, ctx);
    expect(res.status).toBe(415);
  });

  it("DELETE removes cover.jpg if present, succeeds idempotently if absent", async () => {
    const b = await createBundle(tmpDir, { title: "Cov2" });
    const { PUT, DELETE } = await import("@/app/api/bundles/[slug]/cover/route");

    const fd = new FormData();
    fd.append("cover", new Blob([await makeJpeg(1600, 2560)], { type: "image/jpeg" }), "c.jpg");
    const putReq = new Request(`http://localhost/api/bundles/${b.slug}/cover`, {
      method: "PUT",
      body: fd,
    }) as unknown as NextRequest;
    const ctx = { params: Promise.resolve({ slug: b.slug }) };
    await PUT(putReq, ctx);

    const delReq = new Request(`http://localhost/api/bundles/${b.slug}/cover`, {
      method: "DELETE",
    }) as unknown as NextRequest;
    const res1 = await DELETE(delReq, ctx);
    expect(res1.status).toBe(200);

    const res2 = await DELETE(delReq, ctx);
    expect(res2.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/api/bundles.cover.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `app/api/bundles/[slug]/cover/route.ts`:

```ts
import type { NextRequest } from "next/server";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import sharp from "sharp";
import { ok, fail } from "@/lib/api";
import { getBundle } from "@/lib/storage/bundles";
import { bundleCoverPath } from "@/lib/storage/paths";
import { effectiveDataDir } from "@/lib/config";

type Ctx = { params: Promise<{ slug: string }> };

const MAX_BYTES = 20 * 1024 * 1024;
const ACCEPTED = new Set(["image/jpeg", "image/png"]);

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  const dataDir = effectiveDataDir();

  const bundle = await getBundle(dataDir, slug);
  if (!bundle) return fail("bundle not found", 404);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("expected multipart/form-data body");
  }

  const entry = form.get("cover");
  if (!(entry instanceof File)) return fail("missing 'cover' field");
  if (!ACCEPTED.has(entry.type)) return fail(`unsupported image type: ${entry.type}`, 415);
  if (entry.size > MAX_BYTES) return fail("cover exceeds 20 MB limit", 413);

  const inputBytes = Buffer.from(await entry.arrayBuffer());
  const jpegBytes =
    entry.type === "image/jpeg"
      ? inputBytes
      : await sharp(inputBytes).jpeg({ quality: 92 }).toBuffer();

  const path = bundleCoverPath(dataDir, slug);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, jpegBytes);

  const warnings: string[] = [];
  try {
    const meta = await sharp(jpegBytes).metadata();
    if ((meta.width ?? 0) < 1600 || (meta.height ?? 0) < 2560) {
      warnings.push(
        `Cover is ${meta.width}x${meta.height}; KDP recommends at least 1600x2560.`,
      );
    }
  } catch {
    /* ignore metadata failures */
  }

  return ok({ path, warnings });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  const dataDir = effectiveDataDir();

  const bundle = await getBundle(dataDir, slug);
  if (!bundle) return fail("bundle not found", 404);

  await rm(bundleCoverPath(dataDir, slug), { force: true });
  return ok({ deleted: true });
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/api/bundles.cover.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/bundles/\[slug\]/cover/route.ts tests/api/bundles.cover.test.ts
git commit -m "feat(api): add /api/bundles/[slug]/cover (PUT/DELETE)"
```

### Task 3.4: `GET /api/bundles/[slug]/preview`

**Files:**
- Create: `app/api/bundles/[slug]/preview/route.ts`
- Test: `tests/api/bundles.preview.test.ts` (new)

The preview endpoint resolves story refs (loads `Story` and `Chapter[]` for each) and returns the structure the UI tree consumes. For each ref, returns `{ storySlug, displayTitle, titlePageHtml, chapters: [{ id, title, html }] }`. Missing refs yield `{ storySlug, missing: true }`.

- [ ] **Step 1: Write failing tests**

Create `tests/api/bundles.preview.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { createStory } from "@/lib/storage/stories";
import { createImportedChapter } from "@/lib/storage/chapters";
import { createBundle, updateBundle } from "@/lib/storage/bundles";

describe("GET /api/bundles/[slug]/preview", () => {
  const originalEnv = process.env;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scriptr-bundle-preview-"));
    process.env = { ...originalEnv, SCRIPTR_DATA_DIR: tmpDir };
  });
  afterEach(async () => {
    process.env = originalEnv;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("404s for missing bundle", async () => {
    const { GET } = await import("@/app/api/bundles/[slug]/preview/route");
    const req = new Request("http://localhost/api/bundles/nope/preview") as unknown as NextRequest;
    const ctx = { params: Promise.resolve({ slug: "nope" }) };
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
  });

  it("returns bundle metadata + per-story title page + chapters", async () => {
    const story = await createStory(tmpDir, { title: "Story A", authorPenName: "Pen" });
    await createImportedChapter(tmpDir, story.slug, { title: "Ch 1", sectionContents: ["Body."] });

    const b = await createBundle(tmpDir, { title: "Set" });
    await updateBundle(tmpDir, b.slug, {
      stories: [{ storySlug: story.slug }],
    });

    const { GET } = await import("@/app/api/bundles/[slug]/preview/route");
    const req = new Request(`http://localhost/api/bundles/${b.slug}/preview`) as unknown as NextRequest;
    const ctx = { params: Promise.resolve({ slug: b.slug }) };
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.bundle.title).toBe("Set");
    expect(body.data.stories).toHaveLength(1);
    expect(body.data.stories[0].storySlug).toBe(story.slug);
    expect(body.data.stories[0].displayTitle).toBe("Story A");
    expect(body.data.stories[0].titlePageHtml).toContain("story-title-page");
    expect(body.data.stories[0].titlePageHtml).toContain("Story A");
    expect(body.data.stories[0].chapters).toHaveLength(1);
    expect(body.data.stories[0].chapters[0].title).toBe("Ch 1");
    expect(body.data.stories[0].chapters[0].html).toContain("Body.");
  });

  it("uses titleOverride and descriptionOverride", async () => {
    const story = await createStory(tmpDir, { title: "Original" });
    await createImportedChapter(tmpDir, story.slug, { title: "Ch", sectionContents: ["X"] });

    const b = await createBundle(tmpDir, { title: "B" });
    await updateBundle(tmpDir, b.slug, {
      stories: [
        {
          storySlug: story.slug,
          titleOverride: "Bundle Display",
          descriptionOverride: "Bundle blurb.",
        },
      ],
    });

    const { GET } = await import("@/app/api/bundles/[slug]/preview/route");
    const req = new Request(`http://localhost/api/bundles/${b.slug}/preview`) as unknown as NextRequest;
    const ctx = { params: Promise.resolve({ slug: b.slug }) };
    const res = await GET(req, ctx);
    const body = await res.json();
    expect(body.data.stories[0].displayTitle).toBe("Bundle Display");
    expect(body.data.stories[0].titlePageHtml).toContain("Bundle Display");
    expect(body.data.stories[0].titlePageHtml).toContain("Bundle blurb.");
  });

  it("marks missing story refs", async () => {
    const b = await createBundle(tmpDir, { title: "B" });
    await updateBundle(tmpDir, b.slug, {
      stories: [{ storySlug: "ghost-story" }],
    });

    const { GET } = await import("@/app/api/bundles/[slug]/preview/route");
    const req = new Request(`http://localhost/api/bundles/${b.slug}/preview`) as unknown as NextRequest;
    const ctx = { params: Promise.resolve({ slug: b.slug }) };
    const res = await GET(req, ctx);
    const body = await res.json();
    expect(body.data.stories[0]).toEqual({ storySlug: "ghost-story", missing: true });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/api/bundles.preview.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `app/api/bundles/[slug]/preview/route.ts`:

```ts
import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api";
import { getBundle } from "@/lib/storage/bundles";
import { getStory } from "@/lib/storage/stories";
import { listChapters } from "@/lib/storage/chapters";
import {
  renderStoryTitlePageHtml,
  renderChapterPreviewHtml,
  stripPreviewWrapper,
} from "@/lib/publish/epub-preview";
import { effectiveDataDir } from "@/lib/config";

type Ctx = { params: Promise<{ slug: string }> };

type PreviewStory =
  | { storySlug: string; missing: true }
  | {
      storySlug: string;
      displayTitle: string;
      titlePageHtml: string;
      chapters: Array<{ id: string; title: string; html: string }>;
    };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  const dataDir = effectiveDataDir();
  const bundle = await getBundle(dataDir, slug);
  if (!bundle) return fail("bundle not found", 404);

  const stories: PreviewStory[] = [];
  for (const ref of bundle.stories) {
    const story = await getStory(dataDir, ref.storySlug);
    if (!story) {
      stories.push({ storySlug: ref.storySlug, missing: true });
      continue;
    }
    const chapters = await listChapters(dataDir, ref.storySlug);
    const displayTitle = ref.titleOverride ?? story.title;
    const displayDescription = ref.descriptionOverride ?? story.description;
    stories.push({
      storySlug: ref.storySlug,
      displayTitle,
      titlePageHtml: renderStoryTitlePageHtml(displayTitle, displayDescription),
      chapters: chapters.map((chapter, idx) => ({
        id: chapter.id,
        title: chapter.title || `Chapter ${idx + 1}`,
        html: stripPreviewWrapper(
          renderChapterPreviewHtml(chapter, { chapterNumber: idx + 1 }),
        ),
      })),
    });
  }

  return ok({
    bundle: {
      title: bundle.title,
      authorPenName: bundle.authorPenName,
      description: bundle.description,
    },
    stories,
  });
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/api/bundles.preview.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/bundles/\[slug\]/preview/route.ts tests/api/bundles.preview.test.ts
git commit -m "feat(api): add /api/bundles/[slug]/preview"
```

### Task 3.5: `POST /api/bundles/[slug]/export/epub`

**Files:**
- Create: `app/api/bundles/[slug]/export/epub/route.ts`
- Test: `tests/api/bundles.export.test.ts` (new)

The export route resolves refs, calls `buildBundleEpubBytes`, writes to `data/bundles/<slug>/exports/<slug>-epub<2|3>.epub`, runs `validateEpub`, returns `{ path, bytes, version, warnings }`. Reuses the existing `validateEpub` from `lib/publish/epub.ts`. Inlines the `mkdir + writeFile + rename` write because the existing `writeEpub` helper is hard-coded to story slug paths.

- [ ] **Step 1: Write failing tests**

Create `tests/api/bundles.export.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { createStory } from "@/lib/storage/stories";
import { createImportedChapter } from "@/lib/storage/chapters";
import { createBundle, updateBundle } from "@/lib/storage/bundles";
import { bundleEpubPath } from "@/lib/storage/paths";

describe("POST /api/bundles/[slug]/export/epub", () => {
  const originalEnv = process.env;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scriptr-bundle-export-"));
    process.env = { ...originalEnv, SCRIPTR_DATA_DIR: tmpDir };
  });
  afterEach(async () => {
    process.env = originalEnv;
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function callPost(slug: string, body?: unknown) {
    const { POST } = await import("@/app/api/bundles/[slug]/export/epub/route");
    const req = new Request(`http://localhost/api/bundles/${slug}/export/epub`, {
      method: "POST",
      ...(body !== undefined
        ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
        : {}),
    }) as unknown as NextRequest;
    const ctx = { params: Promise.resolve({ slug }) };
    return POST(req, ctx);
  }

  it("404s for unknown bundle", async () => {
    const res = await callPost("nope");
    expect(res.status).toBe(404);
  });

  it("400s when bundle has no stories", async () => {
    const b = await createBundle(tmpDir, { title: "Empty" });
    const res = await callPost(b.slug);
    expect(res.status).toBe(400);
  });

  it("400s when all refs are missing on disk", async () => {
    const b = await createBundle(tmpDir, { title: "Ghost" });
    await updateBundle(tmpDir, b.slug, {
      stories: [{ storySlug: "ghost" }],
    });
    const res = await callPost(b.slug);
    expect(res.status).toBe(400);
  });

  it("default body returns version 3 and correct path", async () => {
    const story = await createStory(tmpDir, { title: "Story A", authorPenName: "Pen" });
    await createImportedChapter(tmpDir, story.slug, { title: "C1", sectionContents: ["x."] });

    const b = await createBundle(tmpDir, { title: "Set" });
    await updateBundle(tmpDir, b.slug, {
      authorPenName: "Pen",
      description: "blurb",
      stories: [{ storySlug: story.slug }],
    });

    const res = await callPost(b.slug);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.version).toBe(3);
    expect(body.data.path).toBe(bundleEpubPath(tmpDir, b.slug, 3));
    expect(body.data.path.endsWith("-epub3.epub")).toBe(true);
    expect(body.data.bytes).toBeGreaterThan(500);
    expect(Array.isArray(body.data.warnings)).toBe(true);

    const s = await stat(body.data.path);
    expect(s.size).toBe(body.data.bytes);
  });

  it("version=2 returns -epub2.epub path", async () => {
    const story = await createStory(tmpDir, { title: "Story B" });
    await createImportedChapter(tmpDir, story.slug, { title: "C1", sectionContents: ["x."] });

    const b = await createBundle(tmpDir, { title: "Set2" });
    await updateBundle(tmpDir, b.slug, { stories: [{ storySlug: story.slug }] });

    const res = await callPost(b.slug, { version: 2 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.version).toBe(2);
    expect(body.data.path.endsWith("-epub2.epub")).toBe(true);
  });

  it("emits a warning for each missing-story ref but still builds", async () => {
    const story = await createStory(tmpDir, { title: "Real" });
    await createImportedChapter(tmpDir, story.slug, { title: "C", sectionContents: ["y."] });

    const b = await createBundle(tmpDir, { title: "Mixed" });
    await updateBundle(tmpDir, b.slug, {
      stories: [{ storySlug: story.slug }, { storySlug: "ghost-1" }, { storySlug: "ghost-2" }],
    });

    const res = await callPost(b.slug);
    expect(res.status).toBe(200);
    const body = await res.json();
    const warnings = body.data.warnings as string[];
    expect(warnings.some((w) => w.includes("ghost-1"))).toBe(true);
    expect(warnings.some((w) => w.includes("ghost-2"))).toBe(true);
  });

  it("400 on invalid version value", async () => {
    const b = await createBundle(tmpDir, { title: "X" });
    const res = await callPost(b.slug, { version: 5 });
    expect(res.status).toBe(400);
  });

  it("appends author note from pen-name profile when configured", async () => {
    const { saveConfig } = await import("@/lib/config");
    await saveConfig(tmpDir, {
      penNameProfiles: {
        Pen: {
          defaultMessageHtml: "<p>Thanks for reading.</p>",
        },
      },
    });

    const story = await createStory(tmpDir, { title: "S", authorPenName: "Pen" });
    await createImportedChapter(tmpDir, story.slug, { title: "C", sectionContents: ["x."] });

    const b = await createBundle(tmpDir, { title: "B" });
    await updateBundle(tmpDir, b.slug, {
      authorPenName: "Pen",
      stories: [{ storySlug: story.slug }],
    });

    const res = await callPost(b.slug);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // The EPUB should contain the author note. Inspect via JSZip.
    const JSZip = (await import("jszip")).default;
    const fs = await import("node:fs/promises");
    const epubBytes = await fs.readFile(body.data.path);
    const zip = await JSZip.loadAsync(epubBytes);
    const names = Object.keys(zip.files).filter((n) => /^OEBPS\/.*\.xhtml$/i.test(n));
    let combined = "";
    for (const name of names) combined += await zip.file(name)!.async("string");
    expect(combined).toContain("Thanks for reading.");
  });

  it("omits author note when no profile exists for bundle.authorPenName", async () => {
    const story = await createStory(tmpDir, { title: "S2", authorPenName: "NoProfile" });
    await createImportedChapter(tmpDir, story.slug, { title: "C", sectionContents: ["y."] });

    const b = await createBundle(tmpDir, { title: "B2" });
    await updateBundle(tmpDir, b.slug, {
      authorPenName: "NoProfile",
      stories: [{ storySlug: story.slug }],
    });

    const res = await callPost(b.slug);
    expect(res.status).toBe(200);
    const body = await res.json();

    const JSZip = (await import("jszip")).default;
    const fs = await import("node:fs/promises");
    const epubBytes = await fs.readFile(body.data.path);
    const zip = await JSZip.loadAsync(epubBytes);
    const names = Object.keys(zip.files).filter((n) => /^OEBPS\/.*\.xhtml$/i.test(n));
    let combined = "";
    for (const name of names) combined += await zip.file(name)!.async("string");
    expect(combined).not.toContain("A note from the author");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/api/bundles.export.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `app/api/bundles/[slug]/export/epub/route.ts`:

```ts
import type { NextRequest } from "next/server";
import { mkdir, writeFile, rename, stat } from "node:fs/promises";
import { ok, fail, readJson } from "@/lib/api";
import { getBundle } from "@/lib/storage/bundles";
import { getStory } from "@/lib/storage/stories";
import { listChapters } from "@/lib/storage/chapters";
import { effectiveDataDir, loadConfig } from "@/lib/config";
import { buildBundleEpubBytes, type ResolvedStory } from "@/lib/publish/epub-bundle";
import { validateEpub } from "@/lib/publish/epub";
import { resolveBundleAuthorNote } from "@/lib/publish/author-note";
import {
  bundleCoverPath,
  bundleEpubPath,
  bundleExportsDir,
  type EpubVersion,
} from "@/lib/storage/paths";

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  const dataDir = effectiveDataDir();

  // Optional version body. Empty body is OK.
  let version: EpubVersion = 3;
  try {
    const body = await readJson<{ version?: unknown }>(req);
    if (body.version !== undefined) {
      if (body.version !== 2 && body.version !== 3) {
        return fail("version must be 2 or 3", 400);
      }
      version = body.version as EpubVersion;
    }
  } catch (err) {
    if (!(err instanceof SyntaxError) && !(err instanceof TypeError)) throw err;
  }

  const bundle = await getBundle(dataDir, slug);
  if (!bundle) return fail("bundle not found", 404);
  if (bundle.stories.length === 0) {
    return fail("bundle has no stories", 400);
  }

  const resolved = new Map<string, ResolvedStory>();
  const warnings: string[] = [];
  for (const ref of bundle.stories) {
    const story = await getStory(dataDir, ref.storySlug);
    if (!story) {
      warnings.push(`Missing story: ${ref.storySlug} (omitted from build)`);
      continue;
    }
    const chapters = await listChapters(dataDir, ref.storySlug);
    resolved.set(ref.storySlug, { story, chapters });
  }

  if (resolved.size === 0) {
    return fail("bundle has no resolvable stories", 400);
  }

  // Cover (optional). No fallback to a member story's cover by design.
  let coverPath: string | undefined;
  try {
    const cp = bundleCoverPath(dataDir, slug);
    await stat(cp);
    coverPath = cp;
  } catch {
    coverPath = undefined;
  }

  // Author note (optional). Resolved from the pen-name profile keyed off
  // bundle.authorPenName — bundles do not have a per-bundle override field,
  // so this uses the profile's defaultMessageHtml directly.
  const cfg = await loadConfig(dataDir);
  const profile = cfg.penNameProfiles?.[bundle.authorPenName];
  const authorNote = resolveBundleAuthorNote(profile) ?? undefined;

  // Same QR-overflow guard the single-story export route uses: the qrcode
  // library throws "The amount of data is too big to be stored in a QR Code"
  // when a mailing-list URL exceeds capacity. Surface that as a 400 instead
  // of letting it 500. Other errors propagate.
  let bytes: Uint8Array;
  try {
    bytes = await buildBundleEpubBytes({
      bundle,
      stories: resolved,
      coverPath,
      version,
      authorNote,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/too big to be stored in a QR/i.test(msg)) {
      return fail("mailing list URL is too long to encode as a QR code", 400);
    }
    throw err;
  }

  const { warnings: validationWarnings } = await validateEpub(bytes);

  // Write to <bundle>/exports/<slug>-epub<v>.epub atomically.
  const finalPath = bundleEpubPath(dataDir, slug, version);
  const tempPath = `${finalPath}.tmp`;
  await mkdir(bundleExportsDir(dataDir, slug), { recursive: true });
  await writeFile(tempPath, bytes);
  await rename(tempPath, finalPath);

  return ok({
    path: finalPath,
    bytes: bytes.byteLength,
    version,
    warnings: [...warnings, ...validationWarnings],
  });
}
```

- [ ] **Step 4: Run tests + typecheck + lint**

Run: `npx vitest run tests/api/bundles.export.test.ts && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/bundles/\[slug\]/export/epub/route.ts tests/api/bundles.export.test.ts
git commit -m "feat(api): add /api/bundles/[slug]/export/epub"
```

### Task 3.6: Extend privacy egress test

**Files:**
- Modify: `tests/privacy/no-external-egress.test.ts`

This is the load-bearing test. Every new bundle route must be exercised here, with `recorded === []` asserted at the end.

- [ ] **Step 1: Update the documentation comment**

In `tests/privacy/no-external-egress.test.ts`, in the `─── ROUTES EXERCISED ───` block at the top of the file, append the bundle routes:

```
 *   GET  /api/bundles
 *   POST /api/bundles
 *   GET  /api/bundles/[slug]
 *   PATCH /api/bundles/[slug]
 *   DELETE /api/bundles/[slug]
 *   PUT  /api/bundles/[slug]/cover
 *   DELETE /api/bundles/[slug]/cover
 *   GET  /api/bundles/[slug]/preview
 *   POST /api/bundles/[slug]/export/epub  (×2: version=3 and version=2)
```

- [ ] **Step 2: Add the route exercises before the load-bearing assertion**

Inside the existing `it("exercising every non-generate route records zero fetches", ...)`, **before** the `expect(recorded).toEqual([])` line, add:

```ts
// ── /api/bundles GET + POST ────────────────────────────────────────────
let bundleSlug: string;
{
  const { POST } = await import("@/app/api/bundles/route");
  const req = makeReq("http://localhost/api/bundles", {
    method: "POST",
    body: JSON.stringify({ title: "Privacy Bundle" }),
    headers: { "content-type": "application/json" },
  });
  const res = await POST(req);
  expect(res.status).toBe(201);
  const body = await res.json();
  bundleSlug = body.data.slug as string;
}
{
  const { GET } = await import("@/app/api/bundles/route");
  const res = await GET();
  expect(res.status).toBe(200);
}

// ── /api/bundles/[slug] GET + PATCH ────────────────────────────────────
{
  const { GET } = await import("@/app/api/bundles/[slug]/route");
  const ctx = { params: Promise.resolve({ slug: bundleSlug }) };
  const req = makeReq(`http://localhost/api/bundles/${bundleSlug}`);
  const res = await GET(req, ctx);
  expect(res.status).toBe(200);
}

// Seed a story+chapter so the export has content.
const bStory = await createStory(tmpDir, {
  title: "Privacy Bundle Story",
  authorPenName: "Pen",
});
const bCh = await createChapter(tmpDir, bStory.slug, { title: "B1" });
{
  const { PATCH } = await import(
    "@/app/api/stories/[slug]/chapters/[id]/route"
  );
  const req = makeReq(
    `http://localhost/api/stories/${bStory.slug}/chapters/${bCh.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        sections: [{ id: "s1", content: "Some content for privacy." }],
      }),
      headers: { "content-type": "application/json" },
    }
  );
  const ctx = { params: Promise.resolve({ slug: bStory.slug, id: bCh.id }) };
  const res = await PATCH(req, ctx);
  expect(res.status).toBe(200);
}

{
  const { PATCH } = await import("@/app/api/bundles/[slug]/route");
  const ctx = { params: Promise.resolve({ slug: bundleSlug }) };
  const req = makeReq(`http://localhost/api/bundles/${bundleSlug}`, {
    method: "PATCH",
    body: JSON.stringify({
      authorPenName: "Pen",
      description: "Bundle blurb.",
      stories: [{ storySlug: bStory.slug }],
    }),
    headers: { "content-type": "application/json" },
  });
  const res = await PATCH(req, ctx);
  expect(res.status).toBe(200);
}

// ── /api/bundles/[slug]/cover PUT + DELETE ─────────────────────────────
{
  const { PUT, DELETE } = await import(
    "@/app/api/bundles/[slug]/cover/route"
  );
  const ctx = { params: Promise.resolve({ slug: bundleSlug }) };
  const sharp = (await import("sharp")).default;
  const jpegBytes = await sharp({
    create: { width: 1600, height: 2560, channels: 3, background: { r: 80, g: 80, b: 80 } },
  })
    .jpeg({ quality: 85 })
    .toBuffer();
  const fd = new FormData();
  fd.append(
    "cover",
    new Blob([new Uint8Array(jpegBytes)], { type: "image/jpeg" }),
    "cover.jpg",
  );
  const putReq = new Request(
    `http://localhost/api/bundles/${bundleSlug}/cover`,
    { method: "PUT", body: fd },
  ) as unknown as NextRequest;
  const putRes = await PUT(putReq, ctx);
  expect(putRes.status).toBe(200);

  const delReq = new Request(
    `http://localhost/api/bundles/${bundleSlug}/cover`,
    { method: "DELETE" },
  ) as unknown as NextRequest;
  const delRes = await DELETE(delReq, ctx);
  expect(delRes.status).toBe(200);
}

// ── /api/bundles/[slug]/preview ────────────────────────────────────────
{
  const { GET } = await import("@/app/api/bundles/[slug]/preview/route");
  const ctx = { params: Promise.resolve({ slug: bundleSlug }) };
  const req = makeReq(`http://localhost/api/bundles/${bundleSlug}/preview`);
  const res = await GET(req, ctx);
  expect(res.status).toBe(200);
}

// ── /api/bundles/[slug]/export/epub  (×2: version=3 and version=2) ─────
// Seed a pen-name profile keyed off the bundle's authorPenName so the
// export route exercises the resolveBundleAuthorNote → buildAuthorNoteHtml →
// QR-encode → externalizeDataPngImages path. qrcode is a pure-JS encoder;
// this confirms it does not phone home.
{
  const { saveConfig } = await import("@/lib/config");
  await saveConfig(tmpDir, {
    penNameProfiles: {
      Pen: {
        defaultMessageHtml: "<p>Thanks for reading.</p>",
        mailingListUrl: "https://example.com/list",
      },
    },
  });
}

for (const version of [3, 2] as const) {
  const { POST } = await import("@/app/api/bundles/[slug]/export/epub/route");
  const ctx = { params: Promise.resolve({ slug: bundleSlug }) };
  const req = makeReq(
    `http://localhost/api/bundles/${bundleSlug}/export/epub`,
    {
      method: "POST",
      body: JSON.stringify({ version }),
      headers: { "content-type": "application/json" },
    },
  );
  const res = await POST(req, ctx);
  expect(res.status).toBe(200);
}

// ── DELETE /api/bundles/[slug] ─────────────────────────────────────────
{
  const { DELETE } = await import("@/app/api/bundles/[slug]/route");
  const ctx = { params: Promise.resolve({ slug: bundleSlug }) };
  const req = makeReq(`http://localhost/api/bundles/${bundleSlug}`);
  const res = await DELETE(req, ctx);
  expect(res.status).toBe(200);
}
```

- [ ] **Step 3: Run the privacy test**

Run: `npx vitest run tests/privacy/no-external-egress.test.ts`
Expected: PASS — `recorded === []` after exercising every bundle route.

- [ ] **Step 4: Commit**

```bash
git add tests/privacy/no-external-egress.test.ts
git commit -m "test(privacy): exercise bundle routes for zero-egress assertion"
```

### Task 3.7: Chunk close-out

- [ ] **Step 1: Run quality gates + privacy + all bundle API tests**

```bash
npm run lint && npm run typecheck && npx vitest run tests/api/bundles.test.ts tests/api/bundles.cover.test.ts tests/api/bundles.preview.test.ts tests/api/bundles.export.test.ts tests/privacy/no-external-egress.test.ts
```
Expected: all PASS.

---

## Chunk 4: UI (nav + list page + editor)

**Goal of this chunk:** Bundles are visible and editable in the app. After this chunk, a user can create a bundle, add stories, drag to reorder, override titles, upload a cover, preview the structure, and build an EPUB — entirely through the browser.

### Task 4.1: Add "Bundles" nav link

**Files:**
- Modify: `components/layout/TopBar.tsx`

- [ ] **Step 1: Add the link**

In `components/layout/TopBar.tsx`, modify the `NAV_LINKS` constant:

```ts
const NAV_LINKS = [
  { label: "Library", href: "/" },
  { label: "Bundles", href: "/bundles" },
  { label: "Settings", href: "/settings" },
] as const;
```

(The `isActive` calculation already handles `pathname.startsWith(href)` for non-root hrefs, so `/bundles` and `/bundles/[slug]` both highlight the new link.)

- [ ] **Step 2: Smoke-test typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/layout/TopBar.tsx
git commit -m "feat(nav): add Bundles link to top bar"
```

### Task 4.2: Bundle list page

**Files:**
- Create: `app/bundles/page.tsx`
- Create: `components/bundles/BundleList.tsx`
- Create: `components/bundles/NewBundleDialog.tsx`

Follow the pattern of `app/page.tsx` / `components/library/LibraryList.tsx`. The page is a thin server component shell; the list is a `"use client"` SWR component.

- [ ] **Step 1: Create the server-component shell**

Create `app/bundles/page.tsx`:

```tsx
import { BundleList } from "@/components/bundles/BundleList";

export default function BundlesPage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <BundleList />
    </main>
  );
}
```

- [ ] **Step 2: Create the new-bundle dialog**

Create `components/bundles/NewBundleDialog.tsx`:

```tsx
"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
};

export function NewBundleDialog({ open, onOpenChange, onCreated }: Props) {
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  async function submit() {
    const t = title.trim();
    if (!t) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/bundles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: t }),
      });
      const body = await res.json();
      if (!body.ok) {
        toast.error(body.error ?? "Create failed");
        return;
      }
      onCreated();
      onOpenChange(false);
      setTitle("");
      router.push(`/bundles/${body.data.slug}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New bundle</DialogTitle>
          <DialogDescription>
            A bundle combines multiple stories into a single EPUB.
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          placeholder="Bundle title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          data-testid="new-bundle-title"
        />
        <DialogFooter>
          <Button
            onClick={() => void submit()}
            disabled={submitting || title.trim() === ""}
            data-testid="new-bundle-create"
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Create the list component**

Create `components/bundles/BundleList.tsx`:

```tsx
"use client";

import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { toast } from "sonner";
import { MoreHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { NewBundleDialog } from "@/components/bundles/NewBundleDialog";
import type { BundleSummary } from "@/lib/types";

const fetcher = async (url: string): Promise<BundleSummary[]> => {
  const res = await fetch(url);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "request failed");
  return json.data as BundleSummary[];
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function BundleList() {
  const { data, mutate } = useSWR<BundleSummary[]>("/api/bundles", fetcher);
  const [newOpen, setNewOpen] = useState(false);

  async function handleDelete(slug: string) {
    const res = await fetch(`/api/bundles/${slug}`, { method: "DELETE" });
    const body = await res.json();
    if (!body.ok) {
      toast.error(body.error ?? "Delete failed");
      return;
    }
    void mutate();
  }

  if (!data) {
    return <div className="text-sm text-muted-foreground">Loading bundles…</div>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Bundles</h1>
        <Button onClick={() => setNewOpen(true)} data-testid="bundle-new">
          New bundle
        </Button>
      </div>

      {data.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          No bundles yet. Create one to combine stories into a single EPUB.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {data.map((b) => (
            <Card key={b.slug} className="hover:bg-muted/40 transition-colors">
              <CardHeader>
                <CardTitle>
                  <Link
                    href={`/bundles/${b.slug}`}
                    className="hover:underline"
                    data-testid={`bundle-card-${b.slug}`}
                  >
                    {b.title}
                  </Link>
                </CardTitle>
                <CardDescription>
                  {b.storyCount} {b.storyCount === 1 ? "story" : "stories"} ·
                  {" "}
                  {relativeTime(b.updatedAt)}
                </CardDescription>
                <CardAction>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label="bundle actions">
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => void handleDelete(b.slug)}
                        data-testid={`bundle-delete-${b.slug}`}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardAction>
              </CardHeader>
              <CardContent />
            </Card>
          ))}
        </div>
      )}

      <NewBundleDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreated={() => void mutate()}
      />
    </div>
  );
}
```

- [ ] **Step 4: Smoke check**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: all PASS. Build verifies the new page compiles in production mode.

- [ ] **Step 5: Manual smoke (only if running outside automation)**

Run: `npm run dev` and visit `http://127.0.0.1:3000/bundles`. Expect: empty state, "New bundle" button. Create a bundle via the dialog → redirected to `/bundles/<slug>` (which 404s until Task 4.3, fine). The list at `/bundles` now shows the bundle.

- [ ] **Step 6: Commit**

```bash
git add app/bundles/page.tsx components/bundles/BundleList.tsx components/bundles/NewBundleDialog.tsx
git commit -m "feat(ui): bundles list page + new-bundle dialog"
```

### Task 4.3: Bundle editor — page + root component shell

**Files:**
- Create: `app/bundles/[slug]/page.tsx`
- Create: `components/bundles/BundleEditor.tsx`
- Create: stub `BundleMetadataPane.tsx`, `BundleStoryList.tsx`, `BundlePreviewPane.tsx`

The `[slug]/page.tsx` is a server component that loads the bundle and (404s if not found) renders the client editor. The editor sets up SWR and renders the two columns.

- [ ] **Step 1: Create the server shell**

Create `app/bundles/[slug]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getBundle } from "@/lib/storage/bundles";
import { effectiveDataDir } from "@/lib/config";
import { BundleEditor } from "@/components/bundles/BundleEditor";

type Props = { params: Promise<{ slug: string }> };

export default async function BundleEditorPage({ params }: Props) {
  const { slug } = await params;
  const bundle = await getBundle(effectiveDataDir(), slug);
  if (!bundle) notFound();
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-8">
      <BundleEditor initialBundle={bundle} />
    </main>
  );
}
```

- [ ] **Step 2: Create the editor root**

Create `components/bundles/BundleEditor.tsx`:

```tsx
"use client";

import useSWR from "swr";
import type { Bundle } from "@/lib/types";
import { BundleMetadataPane } from "@/components/bundles/BundleMetadataPane";
import { BundleStoryList } from "@/components/bundles/BundleStoryList";
import { BundlePreviewPane } from "@/components/bundles/BundlePreviewPane";

const fetcher = async (url: string): Promise<Bundle> => {
  const res = await fetch(url);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "request failed");
  return json.data as Bundle;
};

type Props = { initialBundle: Bundle };

export function BundleEditor({ initialBundle }: Props) {
  const { data, mutate } = useSWR<Bundle>(
    `/api/bundles/${initialBundle.slug}`,
    fetcher,
    { fallbackData: initialBundle, revalidateOnFocus: false },
  );
  const bundle = data ?? initialBundle;

  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_360px] gap-8">
      <div className="flex flex-col gap-6">
        <BundleMetadataPane bundle={bundle} onUpdate={() => void mutate()} />
        <BundleStoryList bundle={bundle} onUpdate={() => void mutate()} />
      </div>
      <div className="md:sticky md:top-16 md:self-start">
        <BundlePreviewPane slug={bundle.slug} bundle={bundle} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Stub the three child components so the file compiles**

Create three placeholder files. Each gets fleshed out in 4.4–4.6.

`components/bundles/BundleMetadataPane.tsx`:
```tsx
"use client";
import type { Bundle } from "@/lib/types";
type Props = { bundle: Bundle; onUpdate: () => void };
export function BundleMetadataPane(_props: Props) {
  return <div data-testid="bundle-metadata-pane">metadata pane (stub)</div>;
}
```

`components/bundles/BundleStoryList.tsx`:
```tsx
"use client";
import type { Bundle } from "@/lib/types";
type Props = { bundle: Bundle; onUpdate: () => void };
export function BundleStoryList(_props: Props) {
  return <div data-testid="bundle-story-list">story list (stub)</div>;
}
```

`components/bundles/BundlePreviewPane.tsx`:
```tsx
"use client";
import type { Bundle } from "@/lib/types";
type Props = { slug: string; bundle: Bundle };
export function BundlePreviewPane(_props: Props) {
  return <div data-testid="bundle-preview-pane">preview pane (stub)</div>;
}
```

- [ ] **Step 4: Smoke check**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add app/bundles/\[slug\]/page.tsx components/bundles/BundleEditor.tsx components/bundles/BundleMetadataPane.tsx components/bundles/BundleStoryList.tsx components/bundles/BundlePreviewPane.tsx
git commit -m "feat(ui): bundle editor shell with stub panes"
```

### Task 4.4: BundleMetadataPane (left column top — metadata + cover + build)

**Files:**
- Modify: `components/bundles/BundleMetadataPane.tsx`

The pane has: title/author/description/language inputs (blur-to-save via PATCH), cover upload card (file input + click target, mirrors `ExportPage`), version toggle (radio group with `onToggleKeyDown`), Build button.

- [ ] **Step 1: Replace the stub with the full component**

Overwrite `components/bundles/BundleMetadataPane.tsx`:

```tsx
"use client";

import { useState, useRef, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { Bundle } from "@/lib/types";

type Props = { bundle: Bundle; onUpdate: () => void };

type LastBuild = { path: string; bytes: number; warnings: string[]; version: 2 | 3 };

export function BundleMetadataPane({ bundle, onUpdate }: Props) {
  const [draft, setDraft] = useState<Bundle>(bundle);
  const [saving, setSaving] = useState(false);
  const [building, setBuilding] = useState(false);
  const [lastBuildByVersion, setLastBuildByVersion] = useState<Partial<Record<2 | 3, LastBuild>>>({});
  const [selectedVersion, setSelectedVersion] = useState<2 | 3>(3);
  const fileRef = useRef<HTMLInputElement>(null);
  const v3Ref = useRef<HTMLButtonElement>(null);
  const v2Ref = useRef<HTMLButtonElement>(null);

  const onToggleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = e.key;
    if (
      k === "ArrowLeft" ||
      k === "ArrowRight" ||
      k === "ArrowUp" ||
      k === "ArrowDown" ||
      k === "Home" ||
      k === "End"
    ) {
      e.preventDefault();
      const next: 2 | 3 = k === "Home" ? 3 : k === "End" ? 2 : selectedVersion === 3 ? 2 : 3;
      setSelectedVersion(next);
      (next === 3 ? v3Ref : v2Ref).current?.focus();
    }
  };

  async function patch(fields: Partial<Bundle>) {
    setSaving(true);
    try {
      const res = await fetch(`/api/bundles/${bundle.slug}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(fields),
      });
      const body = await res.json();
      if (!body.ok) {
        toast.error(body.error ?? "Save failed");
        return;
      }
      setDraft((d) => ({ ...d, ...fields }));
      onUpdate();
    } finally {
      setSaving(false);
    }
  }

  function handleBlur<K extends keyof Bundle>(key: K, value: Bundle[K]) {
    if (draft[key] === value) return;
    void patch({ [key]: value } as Partial<Bundle>);
  }

  async function handleCoverSelect() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append("cover", file);
    const res = await fetch(`/api/bundles/${bundle.slug}/cover`, {
      method: "PUT",
      body: form,
    });
    const body = await res.json();
    if (!body.ok) {
      toast.error(body.error ?? "Cover upload failed");
      return;
    }
    if (body.data.warnings?.length) toast.warning(body.data.warnings.join(" "));
    else toast.success("Cover uploaded.");
  }

  async function handleBuild() {
    setBuilding(true);
    try {
      const res = await fetch(`/api/bundles/${bundle.slug}/export/epub`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: selectedVersion }),
      });
      const body = await res.json();
      if (!body.ok) {
        toast.error(body.error ?? "Build failed");
        return;
      }
      const built: LastBuild = body.data;
      setLastBuildByVersion((prev) => ({ ...prev, [built.version]: built }));
      if (built.warnings.length > 0) {
        toast.warning(`Built with ${built.warnings.length} warning(s).`);
      } else {
        toast.success("EPUB built.");
      }
    } finally {
      setBuilding(false);
    }
  }

  const canBuild =
    draft.title.trim() !== "" &&
    draft.authorPenName.trim() !== "" &&
    draft.stories.length > 0 &&
    !building;

  return (
    <section className="flex flex-col gap-4 border border-border rounded p-5">
      <h1 className="text-lg font-semibold">{draft.title || "Untitled bundle"}</h1>

      <Field label="Title">
        <Input
          type="text"
          defaultValue={draft.title}
          onBlur={(e) => handleBlur("title", e.target.value)}
          data-testid="bundle-title"
        />
      </Field>
      <Field label="Author pen name">
        <Input
          type="text"
          defaultValue={draft.authorPenName}
          onBlur={(e) => handleBlur("authorPenName", e.target.value)}
          data-testid="bundle-author"
        />
      </Field>
      <Field label="Description / blurb">
        <Textarea
          defaultValue={draft.description}
          rows={3}
          onBlur={(e) => handleBlur("description", e.target.value)}
          data-testid="bundle-description"
        />
      </Field>
      <Field label="Language">
        <Input
          type="text"
          defaultValue={draft.language}
          onBlur={(e) => handleBlur("language", e.target.value || "en")}
          data-testid="bundle-language"
        />
      </Field>

      <div className="grid grid-cols-[180px_1fr] gap-5 items-start">
        <div>
          <h2 className="text-sm font-semibold mb-2">Cover</h2>
          <div
            className="border border-dashed border-border rounded aspect-[2/3] flex items-center justify-center bg-muted text-xs text-muted-foreground text-center p-3 cursor-pointer"
            onClick={() => fileRef.current?.click()}
            data-testid="bundle-cover-target"
          >
            JPEG/PNG · 1600×2560
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png"
            onChange={handleCoverSelect}
            className="hidden"
            data-testid="bundle-cover-input"
          />
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">Build</h2>
          <div className="text-xs text-muted-foreground">
            {draft.stories.length} {draft.stories.length === 1 ? "story" : "stories"}
          </div>
          <div
            role="radiogroup"
            aria-label="EPUB version"
            data-testid="bundle-version-toggle"
            className="flex rounded-md border border-border overflow-hidden text-xs"
            onKeyDown={onToggleKeyDown}
          >
            <button
              ref={v3Ref}
              role="radio"
              aria-checked={selectedVersion === 3}
              tabIndex={selectedVersion === 3 ? 0 : -1}
              data-testid="bundle-version-epub3"
              onClick={() => setSelectedVersion(3)}
              className={`flex-1 px-3 py-1.5 ${
                selectedVersion === 3
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "bg-background text-muted-foreground hover:bg-muted"
              }`}
            >
              EPUB 3
            </button>
            <button
              ref={v2Ref}
              role="radio"
              aria-checked={selectedVersion === 2}
              tabIndex={selectedVersion === 2 ? 0 : -1}
              data-testid="bundle-version-epub2"
              onClick={() => setSelectedVersion(2)}
              className={`flex-1 px-3 py-1.5 border-l border-border ${
                selectedVersion === 2
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "bg-background text-muted-foreground hover:bg-muted"
              }`}
            >
              EPUB 2
            </button>
          </div>
          <Button
            onClick={() => void handleBuild()}
            disabled={!canBuild}
            data-testid="bundle-build"
          >
            {building ? "Building…" : "Build EPUB"}
          </Button>
          {lastBuildByVersion[selectedVersion] && (
            <div className="text-xs text-muted-foreground" data-testid="bundle-last-build">
              Built ({(lastBuildByVersion[selectedVersion]!.bytes / 1024).toFixed(0)} KB)
            </div>
          )}
        </div>
      </div>

      {saving && <div className="text-xs text-muted-foreground">Saving…</div>}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Smoke check**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/bundles/BundleMetadataPane.tsx
git commit -m "feat(ui): bundle metadata pane (fields + cover + build)"
```

### Task 4.5: BundleStoryList (drag-reorder + overrides + add-story dialog)

**Files:**
- Modify: `components/bundles/BundleStoryList.tsx`
- Create: `components/bundles/AddStoryDialog.tsx`

Pattern: copy `components/editor/ChapterList.tsx`'s `@dnd-kit/core` + `@dnd-kit/sortable` + `arrayMove` setup, but the items are bundle story refs.

- [ ] **Step 1: Implement AddStoryDialog**

Create `components/bundles/AddStoryDialog.tsx`. The codebase does not currently ship a `Checkbox` shadcn component, so we use a native `<input type="checkbox">` with Tailwind styling — keeps the dependency list flat and avoids double-toggle bugs from wrapping a controlled checkbox in a row `onClick`.

```tsx
"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Story } from "@/lib/types";

const fetcher = async (url: string): Promise<Story[]> => {
  const res = await fetch(url);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "request failed");
  return json.data as Story[];
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  excludeSlugs: string[];
  onAdd: (slugs: string[]) => void | Promise<void>;
};

export function AddStoryDialog({ open, onOpenChange, excludeSlugs, onAdd }: Props) {
  const { data } = useSWR<Story[]>("/api/stories", fetcher);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const eligible = (data ?? []).filter((s) => !excludeSlugs.includes(s.slug));

  function toggle(slug: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  async function handleAdd() {
    await onAdd(Array.from(selected));
    setSelected(new Set());
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add stories</DialogTitle>
          <DialogDescription>
            Select stories to append to this bundle.
          </DialogDescription>
        </DialogHeader>
        {eligible.length === 0 ? (
          <div className="text-sm text-muted-foreground py-3">
            All stories are already in this bundle.
          </div>
        ) : (
          <ul className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto">
            {eligible.map((s) => (
              <li key={s.slug}>
                <label className="flex items-center gap-3 p-2 hover:bg-muted/40 rounded cursor-pointer">
                  <input
                    type="checkbox"
                    className="size-4 cursor-pointer"
                    checked={selected.has(s.slug)}
                    onChange={() => toggle(s.slug)}
                    data-testid={`add-story-check-${s.slug}`}
                  />
                  <div>
                    <div className="text-sm font-medium">{s.title}</div>
                    <div className="text-xs text-muted-foreground">{s.authorPenName || "—"}</div>
                  </div>
                </label>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button
            disabled={selected.size === 0}
            onClick={() => void handleAdd()}
            data-testid="add-story-confirm"
          >
            Add {selected.size > 0 ? `(${selected.size})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

The native `<input type="checkbox">` is wrapped in a `<label>` so clicking anywhere on the row toggles via the standard label-for-input behavior — single source of truth, no `e.stopPropagation` needed.

- [ ] **Step 2: Implement BundleStoryList**

Overwrite `components/bundles/BundleStoryList.tsx`:

```tsx
"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  arrayMove,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Trash2, Pencil, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AddStoryDialog } from "@/components/bundles/AddStoryDialog";
import type { Bundle, BundleStoryRef, Story } from "@/lib/types";

const fetcher = async (url: string): Promise<Story[]> => {
  const res = await fetch(url);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "request failed");
  return json.data as Story[];
};

type Props = { bundle: Bundle; onUpdate: () => void };

export function BundleStoryList({ bundle, onUpdate }: Props) {
  const { data: allStories } = useSWR<Story[]>("/api/stories", fetcher);
  const [addOpen, setAddOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function persistStories(stories: BundleStoryRef[]) {
    const res = await fetch(`/api/bundles/${bundle.slug}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stories }),
    });
    const body = await res.json();
    if (!body.ok) {
      toast.error(body.error ?? "Save failed");
      return false;
    }
    onUpdate();
    return true;
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = bundle.stories.findIndex((s) => s.storySlug === active.id);
    const newIndex = bundle.stories.findIndex((s) => s.storySlug === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(bundle.stories, oldIndex, newIndex);
    await persistStories(reordered);
  }

  async function handleRemove(slug: string) {
    const next = bundle.stories.filter((s) => s.storySlug !== slug);
    await persistStories(next);
  }

  async function handleEditOverride(slug: string, patch: Partial<BundleStoryRef>) {
    const next = bundle.stories.map((s) =>
      s.storySlug === slug ? { ...s, ...patch } : s,
    );
    await persistStories(next);
  }

  async function handleAdd(slugs: string[]) {
    const next: BundleStoryRef[] = [
      ...bundle.stories,
      ...slugs.map((s) => ({ storySlug: s })),
    ];
    await persistStories(next);
  }

  const storyBySlug = new Map((allStories ?? []).map((s) => [s.slug, s]));
  const excludeSlugs = bundle.stories.map((s) => s.storySlug);

  return (
    <section className="flex flex-col gap-3 border border-border rounded p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Stories</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAddOpen(true)}
          data-testid="bundle-add-story"
        >
          <Plus className="size-3 mr-1" /> Add story
        </Button>
      </div>

      {bundle.stories.length === 0 ? (
        <div className="text-sm text-muted-foreground">No stories yet.</div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={bundle.stories.map((s) => s.storySlug)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="flex flex-col gap-2">
              {bundle.stories.map((ref) => {
                const source = storyBySlug.get(ref.storySlug);
                return (
                  <SortableStoryRow
                    key={ref.storySlug}
                    ref_={ref}
                    sourceTitle={source?.title}
                    sourceDescription={source?.description}
                    missing={!source}
                    onRemove={() => void handleRemove(ref.storySlug)}
                    onEdit={(patch) => void handleEditOverride(ref.storySlug, patch)}
                  />
                );
              })}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <AddStoryDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        excludeSlugs={excludeSlugs}
        onAdd={handleAdd}
      />
    </section>
  );
}

function SortableStoryRow({
  ref_,
  sourceTitle,
  sourceDescription,
  missing,
  onRemove,
  onEdit,
}: {
  ref_: BundleStoryRef;
  sourceTitle?: string;
  sourceDescription?: string;
  missing: boolean;
  onRemove: () => void;
  onEdit: (patch: Partial<BundleStoryRef>) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: ref_.storySlug,
  });
  const [editing, setEditing] = useState(false);

  const display = ref_.titleOverride ?? sourceTitle ?? ref_.storySlug;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="flex flex-col gap-2 border border-border rounded p-2 bg-background"
      data-testid={`bundle-story-row-${ref_.storySlug}`}
    >
      <div className="flex items-center gap-2">
        <button
          {...attributes}
          {...listeners}
          className="text-muted-foreground hover:text-foreground"
          aria-label="drag handle"
          type="button"
        >
          <GripVertical className="size-4" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate flex items-center gap-2">
            {display}
            {missing && (
              <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400" data-testid="bundle-story-missing">
                <AlertTriangle className="size-3" /> missing
              </span>
            )}
          </div>
          {ref_.titleOverride && !missing && sourceTitle && (
            <div className="text-xs text-muted-foreground">source: {sourceTitle}</div>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={() => setEditing((e) => !e)} aria-label="edit overrides">
          <Pencil className="size-3" />
        </Button>
        <Button variant="ghost" size="icon" onClick={onRemove} aria-label="remove story" data-testid={`bundle-story-remove-${ref_.storySlug}`}>
          <Trash2 className="size-3" />
        </Button>
      </div>
      {editing && (
        <div className="flex flex-col gap-2 pl-6">
          <Input
            placeholder={`title (default: ${sourceTitle ?? "—"})`}
            defaultValue={ref_.titleOverride ?? ""}
            onBlur={(e) => {
              const v = e.target.value.trim();
              onEdit({ titleOverride: v === "" ? undefined : v });
            }}
            data-testid={`bundle-story-title-override-${ref_.storySlug}`}
          />
          <Textarea
            placeholder={`description (default: ${sourceDescription?.slice(0, 60) ?? "—"})`}
            rows={2}
            defaultValue={ref_.descriptionOverride ?? ""}
            onBlur={(e) => {
              const v = e.target.value.trim();
              onEdit({ descriptionOverride: v === "" ? undefined : v });
            }}
            data-testid={`bundle-story-desc-override-${ref_.storySlug}`}
          />
        </div>
      )}
    </li>
  );
}
```

- [ ] **Step 3: Smoke check**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/bundles/BundleStoryList.tsx components/bundles/AddStoryDialog.tsx
git commit -m "feat(ui): bundle story list with drag-reorder, overrides, and add dialog"
```

### Task 4.6: BundlePreviewPane (right column — TOC tree + render area)

**Files:**
- Modify: `components/bundles/BundlePreviewPane.tsx`

Renders the resolved structure from `/api/bundles/[slug]/preview` as a collapsible tree. Clicking a node renders that piece in-place using the existing `SafeHtml` sanitizer (so the existing `EPUB_STYLESHEET`-styled output is rendered safely; XSS is defended in depth).

- [ ] **Step 1: Implement**

Overwrite `components/bundles/BundlePreviewPane.tsx`:

```tsx
"use client";

import { useState } from "react";
import useSWR from "swr";
import { ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { EPUB_STYLESHEET } from "@/lib/publish/epub-preview";
import { SafeHtml } from "@/lib/publish/safe-html";
import type { Bundle } from "@/lib/types";

type PreviewStory =
  | { storySlug: string; missing: true }
  | {
      storySlug: string;
      displayTitle: string;
      titlePageHtml: string;
      chapters: Array<{ id: string; title: string; html: string }>;
    };

type PreviewPayload = {
  bundle: { title: string; authorPenName: string; description: string };
  stories: PreviewStory[];
};

const fetcher = async (url: string): Promise<PreviewPayload> => {
  const res = await fetch(url);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "request failed");
  return json.data as PreviewPayload;
};

type SelectedNode =
  | { kind: "title"; storySlug: string }
  | { kind: "chapter"; storySlug: string; chapterId: string }
  | null;

type Props = { slug: string; bundle: Bundle };

export function BundlePreviewPane({ slug, bundle }: Props) {
  // SWR key tied to bundle.updatedAt so PATCH success triggers re-fetch
  // without needing manual mutate calls from siblings.
  const { data } = useSWR<PreviewPayload>(
    `/api/bundles/${slug}/preview?u=${encodeURIComponent(bundle.updatedAt)}`,
    fetcher,
  );

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<SelectedNode>(null);

  function toggle(storySlug: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(storySlug)) next.delete(storySlug);
      else next.add(storySlug);
      return next;
    });
  }

  if (!data) {
    return <div className="text-sm text-muted-foreground">Loading preview…</div>;
  }

  const renderHtml = (() => {
    if (!selected) return "";
    const story = data.stories.find((s) => s.storySlug === selected.storySlug);
    if (!story || "missing" in story) return "";
    if (selected.kind === "title") return story.titlePageHtml;
    const ch = story.chapters.find((c) => c.id === selected.chapterId);
    return ch?.html ?? "";
  })();

  return (
    <section className="border border-border rounded p-4 flex flex-col gap-3" data-testid="bundle-preview-pane">
      <h2 className="text-sm font-semibold">Preview</h2>

      {data.stories.length === 0 ? (
        <div className="text-xs text-muted-foreground">Add a story to preview.</div>
      ) : (
        <ul className="text-sm" data-testid="bundle-preview-tree">
          {data.stories.map((story) => {
            if ("missing" in story) {
              return (
                <li key={story.storySlug} className="flex items-center gap-1 text-amber-600 dark:text-amber-400 py-1">
                  <AlertTriangle className="size-3" /> {story.storySlug} (missing)
                </li>
              );
            }
            const isOpen = expanded.has(story.storySlug);
            return (
              <li key={story.storySlug} className="py-0.5">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={isOpen ? "collapse" : "expand"}
                    aria-expanded={isOpen}
                    onClick={() => toggle(story.storySlug)}
                    className="hover:bg-muted/40 rounded p-0.5"
                  >
                    {isOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setSelected({ kind: "title", storySlug: story.storySlug })
                    }
                    className="font-medium hover:underline text-left"
                    data-testid={`preview-story-title-${story.storySlug}`}
                  >
                    {story.displayTitle}
                  </button>
                </div>
                {isOpen && (
                  <ul className="pl-5">
                    {story.chapters.map((ch) => (
                      <li key={ch.id}>
                        <button
                          type="button"
                          onClick={() =>
                            setSelected({
                              kind: "chapter",
                              storySlug: story.storySlug,
                              chapterId: ch.id,
                            })
                          }
                          className="hover:underline text-left text-xs py-0.5"
                          data-testid={`preview-chapter-${story.storySlug}-${ch.id}`}
                        >
                          {ch.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {renderHtml && (
        <div className="border-t border-border pt-3 mt-2">
          <style>{EPUB_STYLESHEET}</style>
          <SafeHtml
            html={renderHtml}
            className="text-sm max-h-[60vh] overflow-y-auto"
          />
        </div>
      )}
    </section>
  );
}
```

The `SafeHtml` allowlist is `div, h1, p, strong, em, span` with `class` — covers everything `renderStoryTitlePageHtml` and `renderChapterPreviewHtml` emit (after `stripPreviewWrapper`). The `<style>` tag is rendered as a sibling, not inside `SafeHtml`, so the stylesheet is not subject to the sanitizer.

Note on style scope: the inline `<style>{EPUB_STYLESHEET}</style>` injects rules into the document globally for the lifetime of the pane. The selectors are class-namespaced (`.epub-preview`, `.chapter-title`, `.scene-break`, `.story-title-page`) so they do not collide with the surrounding editor's Tailwind utility classes. The single `body { … }` rule at the top of `EPUB_STYLESHEET` is the only global rule — it sets a Georgia font-family on the whole document while the preview pane is open. If that ever causes visible flicker on the rest of the editor, wrap the `body { … }` rule with the `.epub-preview` namespace at that time. Not a concern for v1.

- [ ] **Step 2: Smoke check**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/bundles/BundlePreviewPane.tsx
git commit -m "feat(ui): bundle preview pane (TOC tree + render via SafeHtml)"
```

### Task 4.7: Chunk close-out

- [ ] **Step 1: Run quality gates + build**

```bash
npm run lint && npm run typecheck && npm run build
```
Expected: PASS — production build compiles all new pages/components.

- [ ] **Step 2: Run all the chunk-3 + chunk-4 tests once more**

```bash
npx vitest run tests/api/bundles.test.ts tests/api/bundles.cover.test.ts tests/api/bundles.preview.test.ts tests/api/bundles.export.test.ts tests/privacy/no-external-egress.test.ts
```
Expected: PASS.

---

## Chunk 5: E2E + final integration

**Goal of this chunk:** A Playwright e2e test that walks the happy path end to end: create stories → create bundle → add stories → reorder → set an override → build EPUB → verify file on disk. After this chunk, every layer has automated coverage and the feature is ready to ship.

### Task 5.1: E2E happy-path spec

**Files:**
- Create: `tests/e2e/bundles.spec.ts`

The spec follows the same shape as `tests/e2e/publishing-kit.spec.ts` (which uses `playwright.config.ts`'s on-the-fly dev server with `SCRIPTR_DATA_DIR=/tmp/scriptr-e2e`). Read that spec first if anything below feels off — copy its working selectors for the seed-story flow.

- [ ] **Step 1: Write the spec**

Stories and chapters are seeded via `page.request.post`/`page.request.patch` against the local API (matches the publishing-kit pattern). UI selectors only come into play for the bundle flow itself, where we know the testids from Chunk 4.

Create `tests/e2e/bundles.spec.ts`:

```ts
/**
 * Bundle E2E: seed two stories via API → create bundle → add stories →
 * reorder → set override → build EPUB → assert file on disk.
 *
 * Runs against the same isolated dev server as the other e2e specs
 * (port 3001, SCRIPTR_DATA_DIR=/tmp/scriptr-e2e). All seeding is
 * local — no real Grok / api.x.ai calls made.
 */
import { test, expect } from "@playwright/test";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { E2E_DATA_DIR } from "../../playwright.config";

const BASE = "http://127.0.0.1:3001";

test.beforeAll(async () => {
  // Wipe any leftover state so slugs are predictable.
  await rm(E2E_DATA_DIR, { recursive: true, force: true });
  await mkdir(E2E_DATA_DIR, { recursive: true });
});

test("bundle: seed → create → add → reorder → override → build EPUB", async ({ page }) => {
  // ── 1. Seed two stories + one chapter each via the API. ──────────────────
  async function seedStoryWithChapter(title: string, body: string) {
    const sRes = await page.request.post(`${BASE}/api/stories`, {
      data: { title, authorPenName: "Pen" },
    });
    expect(sRes.ok()).toBeTruthy();
    const story = (await sRes.json()).data as { slug: string };

    const cRes = await page.request.post(
      `${BASE}/api/stories/${story.slug}/chapters`,
      { data: { title: `${title} Ch1` } },
    );
    expect(cRes.ok()).toBeTruthy();
    const chapter = (await cRes.json()).data as { id: string };

    const pRes = await page.request.patch(
      `${BASE}/api/stories/${story.slug}/chapters/${chapter.id}`,
      { data: { sections: [{ id: "s1", content: body }] } },
    );
    expect(pRes.ok()).toBeTruthy();

    return story.slug;
  }

  const slugA = await seedStoryWithChapter("Story A", "Story A chapter one body.");
  const slugB = await seedStoryWithChapter("Story B", "Story B chapter one body.");
  expect(slugA).toBe("story-a");
  expect(slugB).toBe("story-b");

  // ── 2. Create the bundle via the UI. ─────────────────────────────────────
  await page.goto(`${BASE}/bundles`);
  await expect(page.getByTestId("bundle-new")).toBeVisible();
  await page.getByTestId("bundle-new").click();
  await page.getByTestId("new-bundle-title").fill("Two-Story Box Set");
  await page.getByTestId("new-bundle-create").click();
  await expect(page).toHaveURL(/\/bundles\/two-story-box-set/);

  // ── 3. Required bundle metadata (author + description). ─────────────────
  await page.getByTestId("bundle-author").fill("Pen Name");
  await page.getByTestId("bundle-author").blur();
  await page.getByTestId("bundle-description").fill("Two short stories.");
  await page.getByTestId("bundle-description").blur();

  // ── 4. Add both stories via the dialog. ─────────────────────────────────
  await page.getByTestId("bundle-add-story").click();
  await page.getByTestId("add-story-check-story-a").click();
  await page.getByTestId("add-story-check-story-b").click();
  await page.getByTestId("add-story-confirm").click();

  await expect(page.getByTestId("bundle-story-row-story-a")).toBeVisible();
  await expect(page.getByTestId("bundle-story-row-story-b")).toBeVisible();

  // ── 5. Reorder: drag story-b above story-a via the bundle PATCH API. ────
  // The drag-and-drop @dnd-kit interaction is brittle to test through the
  // browser layer; the spec's reorder requirement is satisfied just as well
  // by exercising the underlying API the drag handler calls. The unit tests
  // for BundleStoryList cover the UI wiring; this assertion confirms the
  // round-trip persists.
  const reorderRes = await page.request.patch(
    `${BASE}/api/bundles/two-story-box-set`,
    {
      data: {
        stories: [
          { storySlug: "story-b" },
          { storySlug: "story-a" },
        ],
      },
    },
  );
  expect(reorderRes.ok()).toBeTruthy();
  // SWR will revalidate; wait for the rendered order to flip.
  await expect(async () => {
    const rows = page.locator('[data-testid^="bundle-story-row-"]');
    const ids = await rows.evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-testid")),
    );
    expect(ids).toEqual([
      "bundle-story-row-story-b",
      "bundle-story-row-story-a",
    ]);
  }).toPass({ timeout: 5_000 });

  // ── 6. Set a title override on story-a. ─────────────────────────────────
  await page
    .getByTestId("bundle-story-row-story-a")
    .getByRole("button", { name: /edit overrides/i })
    .click();
  await page.getByTestId("bundle-story-title-override-story-a").fill("Book Two: Story A");
  await page.getByTestId("bundle-story-title-override-story-a").blur();

  // ── 7. Build EPUB (default version 3). ─────────────────────────────────
  await page.getByTestId("bundle-build").click();
  await expect(page.getByTestId("bundle-last-build")).toBeVisible({ timeout: 15_000 });

  // ── 8. The EPUB exists on disk at the expected path. ───────────────────
  const expectedPath = join(
    E2E_DATA_DIR,
    "bundles",
    "two-story-box-set",
    "exports",
    "two-story-box-set-epub3.epub",
  );
  const s = await stat(expectedPath);
  expect(s.size).toBeGreaterThan(500);
});
```

Why API-based seeding instead of UI seeding: the chapter-creation flow uses an inline `<input placeholder="Chapter title…">` that commits on Enter (no separate "Create" button), and the section content uses a custom `SectionCard` component that's not labeled `section-editor-textarea`. Driving these through the UI was the original reviewer-flagged failure mode — using the API matches `tests/e2e/publishing-kit.spec.ts`'s established pattern, removes selector drift, and keeps the spec focused on the bundle UI.

Why API-based reorder: testing `@dnd-kit` drag through Playwright's `dragAndDrop` is reliable in theory but flaky in practice (depends on hover events firing in the right order, sensor activation distance, etc.). The unit-style tests in Chunk 4 cover the wiring; this e2e step verifies the persisted order round-trips through SWR back to the rendered DOM, which is the property the user actually cares about.

- [ ] **Step 2: Run e2e**

Run: `npm run e2e -- tests/e2e/bundles.spec.ts`
Expected: PASS. The Playwright config spins up a fresh dev server on port 3001 with a clean `/tmp/scriptr-e2e` data dir.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/bundles.spec.ts
git commit -m "test(e2e): bundle happy-path (create, add, reorder, override, build)"
```

### Task 5.2: Final close-out

- [ ] **Step 1: Run the full quality gates one last time**

```bash
npm run lint && npm run typecheck && npm test && npm run e2e
```
Expected: all PASS. (`npm test` runs the full Vitest suite incl. the privacy egress test.)

- [ ] **Step 2: Spot-check `git status` in the main checkout** (worktree mode only)

If using a worktree:
```bash
git -C /home/chase/projects/scriptr status
```
Expected: clean.

- [ ] **Step 3: Verify the privacy egress test still passes**

```bash
npx vitest run tests/privacy/no-external-egress.test.ts
```
Expected: PASS — `recorded === []` after every bundle route is exercised.

- [ ] **Step 4: Done.**

The CLAUDE.md mentions `git tag -l` and the newest spec file as the source of truth for "what's active." If the user wants a release tag, they can cut one — that decision is theirs.

---

## Out-of-scope reminders

These were explicitly deferred in the spec — do **not** add them in this plan:
- Per-chapter inclusion/exclusion within a story
- Renaming a bundle's slug after creation
- Author-note end-page integration (defer to that feature's plan)
- Nested two-level TOC
- Bundles of bundles
- Cover inheritance from a member story

If a future task seems to want one of these, surface to the user — don't expand scope silently.
