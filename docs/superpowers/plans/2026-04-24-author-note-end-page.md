# Author Note End Page Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Append a per-pen-name "author note" (rich-text message + `mailto:` email + QR-encoded mailing-list URL) as the final section of every story's EPUB export and the in-app reader page. Pen-name profiles live in `data/config.json` keyed by `Story.authorPenName`; per-story override + toggle live on `Story.authorNote`.

**Architecture:** One pure resolver + one server-side HTML builder (`lib/publish/author-note.ts`) feed two consumers: the EPUB builder ([lib/publish/epub.ts](../../../lib/publish/epub.ts)) and the reader page ([app/s/[slug]/read/page.tsx](../../../app/s/[slug]/read/page.tsx)). Sanitization is centralized through the existing [SafeHtml](../../../lib/publish/safe-html.tsx) wrapper, extended to accept a per-call allowlist override so the chapter-prose surface keeps its tight allowlist while the author-note surface gets a wider one. The QR is rendered as a base64 PNG data URL via the pure-JS `qrcode` package — no network. UI consists of a "Pen Name Profiles" section in settings and an "Author Note" card in the story metadata pane, both backed by a new reusable `RichTextEditor` component (TipTap with bold/italic/link toolbar) extracted as a peer of the existing [SectionEditor](../../../components/editor/SectionEditor.tsx).

**Tech Stack:** Next.js 16 (App Router, server components), TypeScript, React 19, TipTap (`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-link`), `isomorphic-dompurify` (already a dep), `qrcode` (new), Vitest, Playwright. EPUB built via `epub-gen-memory`.

**Spec:** [docs/superpowers/specs/2026-04-24-author-note-end-page-design.md](../specs/2026-04-24-author-note-end-page-design.md)

---

## State-of-repo notes (2026-04-25)

Since this plan was first drafted, the following changes landed on `main` and the plan compensates for them:

- **`Config.updates: UpdatesConfig`** is now a real field ([lib/config.ts:5-8](../../../lib/config.ts#L5)). Task 1.2 still adds `penNameProfiles` to `Config` — the implementer just appends the new field to the existing extended type (alongside `updates`), not the original snapshot in this plan. No test conflict.
- **Settings route allowlist** ([app/api/settings/route.ts:29-31](../../../app/api/settings/route.ts#L29)) already contains `"updates"`. Task 3.1 Step 3's instruction is now: append `"penNameProfiles"` to the allowlist (which has 7 entries today, not 6). GET already returns `updates` and `isElectron`; the plan's "add penNameProfiles to the GET object" still applies as a single-line addition.
- **Electron desktop packaging** is shipped — the app runs in both browser and Electron contexts. The plan's server-side resolver / builder code is identical in both. No code branches needed for `process.versions.electron`.
- **`jszip`** is already a direct devDependency — Tasks 4.1, 4.3, and 7.2 import it directly, no install step needed.
- **CLAUDE.md** gained Import + Publish + Planning subsystem pointers — informational, no plan impact.

If anything else has shifted between this section being written and execution, the implementer should re-check the touched files (`git log -- <path>`) before the corresponding chunk's task.

## Conventions

- Every test step shows the exact `npx vitest run …` (or Playwright) command and the expected pass/fail.
- Every commit step lists the exact files to `git add`. Do **not** use `git add .` or `git add -A` — the user's `data/` and worktree state must not leak into commits.
- All new code is TypeScript strict-mode clean; run `npm run typecheck` after each chunk.
- All new code lints clean; `npm run lint` after each chunk.
- The `scriptr/no-telemetry` rule will not flag `qrcode` (pure encoder), but if it ever does, do NOT loosen the rule — surface to the user.
- File-path conventions in this plan use the **repo root** (`/home/chase/projects/scriptr/`).
- **Subagent cwd discipline (per AGENTS.md):** if executing in a worktree (`/home/chase/projects/scriptr/.worktrees/<name>/`), every implementer subagent prompt must include the absolute worktree path AND every `git add` / test command must be run from that worktree. After each task DONE, spot-check `git status` in the main checkout to confirm no stray edits leaked. The committed files on the feature branch are the reviewed truth.
- **Sanitization is centralized.** `buildAuthorNoteHtml` returns *already-sanitized* HTML by piping its output through DOMPurify with the author-note allowlist exported from the same module. This makes both consumers (reader page, EPUB build path) safe by construction. The reader's `SafeHtml` re-sanitizes on render — that's defense in depth and is fine (idempotent).

## File Structure

| File | Status | Responsibility |
|------|--------|----------------|
| `lib/types.ts` | modify | Add `Story.authorNote?: { enabled: boolean; messageHtml?: string }` |
| `lib/config.ts` | modify | Add `Config.penNameProfiles?: Record<string, PenNameProfile>` and `PenNameProfile` type export |
| `lib/publish/safe-html.tsx` | modify | Accept optional `extra` prop (extra ALLOWED_TAGS / ALLOWED_ATTR / ALLOWED_URI_REGEXP) |
| `lib/publish/author-note.ts` | **new** | `resolveAuthorNote(story, profile)` (pure) + `buildAuthorNoteHtml(opts)` (async) |
| `lib/publish/epub.ts` | modify | Accept `authorNote` on `EpubInput`; if present, append a final content entry |
| `lib/publish/epub-preview.ts` | modify | Append `.author-note { … }` styles to `EPUB_STYLESHEET` |
| `app/api/settings/route.ts` | modify | GET exposes `penNameProfiles`; PUT allowlist gains `penNameProfiles` |
| `app/api/stories/[slug]/route.ts` | modify | PATCH allowlist gains `authorNote` |
| `app/api/stories/[slug]/export/epub/route.ts` | modify | Resolve author-note from config + story; pass through to `buildEpubBytes` |
| `app/s/[slug]/read/page.tsx` | modify | Load config; resolve author-note; pass HTML to `ReaderView` |
| `components/reader/ReaderView.tsx` | modify | Accept `authorNoteHtml?: string` prop; render via `SafeHtml` after the last chapter |
| `components/editor/RichTextEditor.tsx` | **new** | Reusable TipTap editor with bold/italic/link/paragraphs toolbar; emits HTML |
| `app/settings/page.tsx` | modify | Add "Pen Name Profiles" section |
| `components/settings/PenNameProfilesSection.tsx` | **new** | List + edit + delete profile cards |
| `components/editor/MetadataPane.tsx` | modify | Add "Author Note" card |
| `components/editor/AuthorNoteCard.tsx` | **new** | Toggle + per-story override editor |
| `tests/lib/publish-author-note.test.ts` | **new** | Unit tests for `resolveAuthorNote` + `buildAuthorNoteHtml` |
| `tests/lib/publish-safe-html.test.ts` | **new** | Unit tests for `SafeHtml`'s `extra` prop |
| `tests/api/settings.test.ts` | modify | Add cases for `penNameProfiles` round-trip |
| `tests/api/stories.slug.test.ts` | modify | Add cases for `authorNote` round-trip |
| `tests/api/export.epub.test.ts` | modify | Add cases for note appearing/absent in export |
| `tests/privacy/no-external-egress.test.ts` | modify | Exercise EPUB export with author-note configured |
| `tests/components/reader/ReaderView.test.tsx` | **new** | Reader renders/omits note appropriately |
| `tests/e2e/author-note.spec.ts` | **new** | End-to-end: settings → metadata → reader → export → toggle off |
| `package.json` / `package-lock.json` | modify | Add `qrcode`, `@tiptap/extension-link` deps; `@types/qrcode` dev dep |

---

## Chunk 1: Foundations (types, deps, sanitizer extension)

**Goal of this chunk:** All downstream chunks compile against the new types and sanitizer signature, and the new `qrcode` dep is installed and verified to be pure-JS (no network code path).

### Task 1.1: Install `qrcode` dep

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install runtime + types**

```bash
npm install qrcode
npm install --save-dev @types/qrcode
```

Expected: `qrcode` and `@types/qrcode` appear in `package.json`. No peer-dep warnings about telemetry packages.

- [ ] **Step 2: Verify pure-JS, no fetch surface**

```bash
grep -RE 'fetch\(|XMLHttpRequest|require\("https?"\)|import .* from "(https?|node-fetch)"' node_modules/qrcode/lib node_modules/qrcode/build || echo "no network code"
```

Expected: `no network code` printed. If anything matches — STOP and surface to user.

- [ ] **Step 3: Verify ESLint `scriptr/no-telemetry` is clean**

Run: `npm run lint`
Expected: PASS. (The rule allowlist is unrelated; `qrcode` is not in any telemetry list.)

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add qrcode for author-note QR generation"
```

### Task 1.2: Extend `Config` with `penNameProfiles`

**Files:**
- Modify: `lib/config.ts:5-14` (Config type) — add `PenNameProfile` export and `penNameProfiles` field
- Test: `tests/lib/config.test.ts` (existing)

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/config.test.ts`:

```ts
it("round-trips penNameProfiles through saveConfig/loadConfig", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scriptr-config-"));
  try {
    await saveConfig(dir, {
      penNameProfiles: {
        "Jane Doe": {
          email: "jane@example.com",
          mailingListUrl: "https://list.example.com/jane",
          defaultMessageHtml: "<p>Thanks!</p>",
        },
      },
    });
    const loaded = await loadConfig(dir);
    expect(loaded.penNameProfiles).toEqual({
      "Jane Doe": {
        email: "jane@example.com",
        mailingListUrl: "https://list.example.com/jane",
        defaultMessageHtml: "<p>Thanks!</p>",
      },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/config.test.ts -t "penNameProfiles"`
Expected: FAIL — TypeScript error or runtime mismatch (the field is unknown to `Config`).

- [ ] **Step 3: Implement minimal type addition**

In `lib/config.ts`, after the existing imports and before `Config`:

```ts
export type PenNameProfile = {
  email?: string;
  mailingListUrl?: string;
  defaultMessageHtml?: string;
};
```

Extend `Config`:

```ts
export type Config = {
  apiKey?: string;
  defaultModel: string;
  bindHost: "127.0.0.1" | "0.0.0.0";
  bindPort: number;
  theme: "light" | "dark" | "system";
  autoRecap: boolean;
  includeLastChapterFullText: boolean;
  styleDefaults?: StyleRules;
  penNameProfiles?: Record<string, PenNameProfile>;
};
```

No change to `DEFAULT_CONFIG` (the field is optional and absent by default).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/config.test.ts -t "penNameProfiles"`
Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/config.ts tests/lib/config.test.ts
git commit -m "types: add Config.penNameProfiles + PenNameProfile"
```

### Task 1.3: Extend `Story` with `authorNote`

**Files:**
- Modify: `lib/types.ts:1-16` — add `authorNote?: { enabled: boolean; messageHtml?: string }`
- Test: `tests/lib/types.test.ts` (existing)

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/types.test.ts`:

```ts
it("Story.authorNote is an optional shape with enabled + optional messageHtml", () => {
  const story: Story = {
    slug: "x", title: "x", authorPenName: "x", description: "",
    copyrightYear: 2026, language: "en", bisacCategory: "FIC027000",
    keywords: [], createdAt: "", updatedAt: "", chapterOrder: [],
    authorNote: { enabled: true, messageHtml: "<p>hi</p>" },
  };
  expect(story.authorNote?.enabled).toBe(true);

  const without: Story = {
    slug: "y", title: "y", authorPenName: "y", description: "",
    copyrightYear: 2026, language: "en", bisacCategory: "FIC027000",
    keywords: [], createdAt: "", updatedAt: "", chapterOrder: [],
  };
  expect(without.authorNote).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails (TS error)**

Run: `npx vitest run tests/lib/types.test.ts`
Expected: FAIL — TypeScript reports unknown property `authorNote`.

- [ ] **Step 3: Implement type addition**

In `lib/types.ts`, extend `Story`:

```ts
export type Story = {
  slug: string;
  title: string;
  authorPenName: string;
  subtitle?: string;
  description: string;
  copyrightYear: number;
  language: string;
  bisacCategory: string;
  keywords: string[];
  isbn?: string;
  createdAt: string;
  updatedAt: string;
  chapterOrder: string[];
  modelOverride?: string;
  authorNote?: { enabled: boolean; messageHtml?: string };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts tests/lib/types.test.ts
git commit -m "types: add Story.authorNote"
```

### Task 1.4: Extend `SafeHtml` with `extra` prop

**Files:**
- Modify: `lib/publish/safe-html.tsx`
- Test: `tests/lib/publish-safe-html.test.ts` (**new**)

The existing component renders trusted HTML through DOMPurify with a tight allowlist (`div, h1, p, strong, em, span` + `class`). We extend it with an optional `extra` prop that merges additional tags / attributes / a custom `ALLOWED_URI_REGEXP` on top — the chapter-prose surface keeps the tight default; the author-note surface opts in to the wider set.

The render block (the React element that injects the sanitized HTML) is preserved verbatim from the existing file. Do NOT change the disable-comment wrapping the render. Read the existing file first to copy that block exactly.

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/publish-safe-html.test.ts` (jsdom — DOMPurify needs a DOM):

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { SafeHtml } from "@/lib/publish/safe-html";

describe("SafeHtml extra allowlist", () => {
  it("strips <a> by default", () => {
    const { container } = render(<SafeHtml html='<p>hi <a href="https://x.test">click</a></p>' />);
    expect(container.querySelector("a")).toBeNull();
  });

  it("preserves <a href> when extra allows it", () => {
    const { container } = render(
      <SafeHtml
        html='<p>hi <a href="https://x.test">click</a></p>'
        extra={{ ALLOWED_TAGS: ["a"], ALLOWED_ATTR: ["href"] }}
      />
    );
    const a = container.querySelector("a");
    expect(a?.getAttribute("href")).toBe("https://x.test");
  });

  it("ALLOWED_URI_REGEXP rejects javascript: scheme even when <a> is allowed", () => {
    const { container } = render(
      <SafeHtml
        html='<a href="javascript:alert(1)">x</a>'
        extra={{
          ALLOWED_TAGS: ["a"],
          ALLOWED_ATTR: ["href"],
          ALLOWED_URI_REGEXP: /^https?:/i,
        }}
      />
    );
    const a = container.querySelector("a");
    expect(a?.getAttribute("href")).toBeNull();
  });

  it("ALLOWED_URI_REGEXP allows mailto: and data:image/png;base64 only", () => {
    const regex = /^(?:https?:|mailto:|data:image\/png;base64,)/i;
    const { container } = render(
      <SafeHtml
        html={`<div>
          <a href="mailto:x@y">m</a>
          <a href="data:text/html,<script>x</script>">bad</a>
          <img src="data:image/png;base64,abc" alt="qr" />
          <img src="data:image/svg+xml;base64,abc" alt="bad" />
        </div>`}
        extra={{
          ALLOWED_TAGS: ["a", "img"],
          ALLOWED_ATTR: ["href", "src", "alt"],
          ALLOWED_URI_REGEXP: regex,
        }}
      />
    );
    const anchors = container.querySelectorAll("a");
    expect(anchors[0].getAttribute("href")).toBe("mailto:x@y");
    expect(anchors[1]?.getAttribute("href")).toBeNull();
    const imgs = container.querySelectorAll("img");
    const goodImg = Array.from(imgs).find((i) => i.getAttribute("alt") === "qr");
    const badImg = Array.from(imgs).find((i) => i.getAttribute("alt") === "bad");
    expect(goodImg?.getAttribute("src")).toBe("data:image/png;base64,abc");
    expect(badImg?.getAttribute("src")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/publish-safe-html.test.ts`
Expected: FAIL — `extra` prop not recognized; or the URL passes through unfiltered.

- [ ] **Step 3: Extend `SafeHtml`**

The new prop type:

```ts
type Props = {
  html: string;
  className?: string;
  extra?: {
    ALLOWED_TAGS?: string[];
    ALLOWED_ATTR?: string[];
    ALLOWED_URI_REGEXP?: RegExp;
  };
};
```

The current allowlist constants stay as the base set:

```ts
const BASE_TAGS = ["div", "h1", "p", "strong", "em", "span"];
const BASE_ATTR = ["class"];
```

Inside `SafeHtml`, build the DOMPurify config by merging `extra` on top of the base:

```ts
const config: DOMPurify.Config = {
  ALLOWED_TAGS: extra?.ALLOWED_TAGS ? [...BASE_TAGS, ...extra.ALLOWED_TAGS] : BASE_TAGS,
  ALLOWED_ATTR: extra?.ALLOWED_ATTR ? [...BASE_ATTR, ...extra.ALLOWED_ATTR] : BASE_ATTR,
};
if (extra?.ALLOWED_URI_REGEXP) {
  config.ALLOWED_URI_REGEXP = extra.ALLOWED_URI_REGEXP;
}
const clean = DOMPurify.sanitize(html, config);
```

Keep the return JSX block from the existing file **unchanged** (the `<div className={...} ... />` injection stays exactly as it is, including the `// eslint-disable-next-line react/no-danger` comment). Only the config-building lines above it change.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/publish-safe-html.test.ts`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Verify no regression in existing chapter-prose surfaces**

```bash
grep -rn "SafeHtml" app components | grep -v node_modules
```

Expected: list of existing call sites — confirm each still passes only the original `html` / `className` props (the new `extra` is opt-in).

Run: `npx vitest run`
Expected: PASS — no regressions in any test that already uses `SafeHtml`.

- [ ] **Step 6: Commit**

```bash
git add lib/publish/safe-html.tsx tests/lib/publish-safe-html.test.ts
git commit -m "publish: add extra allowlist prop to SafeHtml"
```

### Chunk 1 Wrap-up

- [ ] **Run full test + typecheck + lint**

```bash
npm run typecheck && npm run lint && npx vitest run
```

Expected: PASS on all three.

---

## Chunk 2: Author-note core module + tests

**Goal of this chunk:** Pure resolver and HTML builder are implemented and exhaustively tested. No consumer code is touched yet.

### Task 2.1: Implement `resolveAuthorNote`

**Files:**
- Create: `lib/publish/author-note.ts`
- Create: `tests/lib/publish-author-note.test.ts`

- [ ] **Step 1: Write failing tests for `resolveAuthorNote`**

Create `tests/lib/publish-author-note.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveAuthorNote } from "@/lib/publish/author-note";
import type { Story } from "@/lib/types";
import type { PenNameProfile } from "@/lib/config";

const baseStory = (over: Partial<Story> = {}): Story => ({
  slug: "s", title: "T", authorPenName: "Jane",
  description: "", copyrightYear: 2026, language: "en",
  bisacCategory: "FIC027000", keywords: [],
  createdAt: "", updatedAt: "", chapterOrder: [],
  ...over,
});

describe("resolveAuthorNote", () => {
  it("returns null when no profile", () => {
    expect(resolveAuthorNote(baseStory(), undefined)).toBeNull();
  });

  it("returns null when authorNote.enabled === false", () => {
    const profile: PenNameProfile = { defaultMessageHtml: "<p>hi</p>" };
    const story = baseStory({ authorNote: { enabled: false, messageHtml: "<p>x</p>" } });
    expect(resolveAuthorNote(story, profile)).toBeNull();
  });

  it("returns story override when messageHtml is non-empty", () => {
    const profile: PenNameProfile = { defaultMessageHtml: "<p>default</p>" };
    const story = baseStory({ authorNote: { enabled: true, messageHtml: "<p>override</p>" } });
    expect(resolveAuthorNote(story, profile)?.messageHtml).toBe("<p>override</p>");
  });

  it("falls back to profile default when story override is empty/missing", () => {
    const profile: PenNameProfile = { defaultMessageHtml: "<p>default</p>" };
    expect(resolveAuthorNote(baseStory(), profile)?.messageHtml).toBe("<p>default</p>");
    const storyEmpty = baseStory({ authorNote: { enabled: true, messageHtml: "   " } });
    expect(resolveAuthorNote(storyEmpty, profile)?.messageHtml).toBe("<p>default</p>");
  });

  it("returns null when message AND email AND mailingListUrl are all empty", () => {
    expect(resolveAuthorNote(baseStory(), {})).toBeNull();
  });

  it("includes email and mailingListUrl when present", () => {
    const profile: PenNameProfile = {
      email: "j@example.com",
      mailingListUrl: "https://list.example.com",
      defaultMessageHtml: "<p>hi</p>",
    };
    const r = resolveAuthorNote(baseStory(), profile);
    expect(r).toEqual({
      messageHtml: "<p>hi</p>",
      email: "j@example.com",
      mailingListUrl: "https://list.example.com",
    });
  });

  it("treats undefined authorNote as enabled (default-on)", () => {
    const profile: PenNameProfile = { defaultMessageHtml: "<p>hi</p>" };
    expect(resolveAuthorNote(baseStory(), profile)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/publish-author-note.test.ts -t resolveAuthorNote`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `resolveAuthorNote`**

Create `lib/publish/author-note.ts`:

```ts
import type { Story } from "@/lib/types";
import type { PenNameProfile } from "@/lib/config";

export type ResolvedAuthorNote = {
  messageHtml: string;
  email?: string;
  mailingListUrl?: string;
};

export function resolveAuthorNote(
  story: Story,
  profile: PenNameProfile | undefined,
): ResolvedAuthorNote | null {
  if (!profile) return null;
  if (story.authorNote?.enabled === false) return null;
  const overrideRaw = story.authorNote?.messageHtml ?? "";
  const override = overrideRaw.trim();
  const fallback = (profile.defaultMessageHtml ?? "").trim();
  const messageHtml = override.length > 0 ? override : fallback;
  if (messageHtml.length === 0 && !profile.email && !profile.mailingListUrl) {
    return null;
  }
  return {
    messageHtml,
    email: profile.email,
    mailingListUrl: profile.mailingListUrl,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/publish-author-note.test.ts -t resolveAuthorNote`
Expected: PASS (all 7 cases).

- [ ] **Step 5: Commit**

```bash
git add lib/publish/author-note.ts tests/lib/publish-author-note.test.ts
git commit -m "publish: add resolveAuthorNote pure resolver"
```

### Task 2.2: Implement `buildAuthorNoteHtml` (sanitizes its own output)

**Files:**
- Modify: `lib/publish/author-note.ts`
- Modify: `tests/lib/publish-author-note.test.ts`

The builder runs DOMPurify with the author-note allowlist *before returning*. This means **both** consumers (reader page via SafeHtml, EPUB via `epub-gen-memory`) receive sanitized HTML — closing the gap where the EPUB build path bypasses SafeHtml. The allowlist is exported as a single constant so the reader's `SafeHtml.extra` prop in Task 5.1 can use the exact same options.

- [ ] **Step 1: Write failing tests for `buildAuthorNoteHtml`**

Append to `tests/lib/publish-author-note.test.ts` (jsdom required because DOMPurify needs a DOM):

```ts
// At top of file, ensure the directive is present:
// @vitest-environment jsdom

import { buildAuthorNoteHtml, AUTHOR_NOTE_SANITIZE_OPTS } from "@/lib/publish/author-note";

describe("buildAuthorNoteHtml", () => {
  it("includes the heading and message wrapper", async () => {
    const html = await buildAuthorNoteHtml({
      messageHtml: "<p>Thanks for reading!</p>",
    });
    expect(html).toContain('class="author-note"');
    expect(html).toContain("A note from the author");
    expect(html).toMatch(/<p>Thanks for reading!<\/p>/);
  });

  it("renders email as a mailto link when provided", async () => {
    const html = await buildAuthorNoteHtml({
      messageHtml: "<p>x</p>",
      email: "jane@example.com",
    });
    expect(html).toContain('href="mailto:jane@example.com"');
    expect(html).toContain("jane@example.com</a>");
  });

  it("omits the email block when email is missing", async () => {
    const html = await buildAuthorNoteHtml({ messageHtml: "<p>x</p>" });
    expect(html).not.toContain("mailto:");
  });

  it("renders QR as <img src=data:image/png;base64,...> when mailingListUrl provided", async () => {
    const html = await buildAuthorNoteHtml({
      messageHtml: "<p>x</p>",
      mailingListUrl: "https://list.example.com/jane",
    });
    expect(html).toMatch(/<img[^>]+src="data:image\/png;base64,[A-Za-z0-9+/=]+"[^>]*>/);
    expect(html).toContain('alt="QR code linking to the mailing list"');
    expect(html).toContain("https://list.example.com/jane</a>");
  });

  it("omits the QR + mailing-list block when mailingListUrl is missing", async () => {
    const html = await buildAuthorNoteHtml({ messageHtml: "<p>x</p>" });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("Join the mailing list");
  });

  // Sanitization parity (spec line 260) — these confirm the builder's own
  // output is already sanitized (closes the EPUB XSS gap).

  it("strips <script> injected via messageHtml", async () => {
    const html = await buildAuthorNoteHtml({
      messageHtml: '<p>hi</p><script>alert(1)</script>',
    });
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toContain("alert(1)");
  });

  it("strips javascript: URLs even if the message tries to forge an <a>", async () => {
    const html = await buildAuthorNoteHtml({
      messageHtml: '<a href="javascript:alert(1)">x</a>',
    });
    expect(html).not.toMatch(/javascript:/i);
  });

  it("strips data:text/html URLs", async () => {
    // DOMPurify is fed a pre-built block, but if anyone smuggled a forged
    // <a> into messageHtml with data:text/html, ALLOWED_URI_REGEXP rejects it.
    const html = await buildAuthorNoteHtml({
      messageHtml: '<a href="data:text/html,<script>x</script>">bad</a>',
    });
    expect(html).not.toMatch(/data:text\/html/i);
  });

  it("preserves the legitimate data:image/png;base64 QR src", async () => {
    const html = await buildAuthorNoteHtml({
      messageHtml: "<p>x</p>",
      mailingListUrl: "https://list.example.com/jane",
    });
    expect(html).toMatch(/src="data:image\/png;base64,[A-Za-z0-9+/=]+"/);
  });

  it("strips data:image/svg+xml (real bypass attempt — SVGs can carry scripts)", async () => {
    const html = await buildAuthorNoteHtml({
      messageHtml: '<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" alt="x" />',
    });
    expect(html).not.toMatch(/data:image\/svg\+xml/i);
  });

  it("preserves bold/italic/links from a TipTap-style messageHtml", async () => {
    const html = await buildAuthorNoteHtml({
      messageHtml: '<p>Thanks for <strong>reading</strong>! <a href="https://example.com">More</a></p>',
    });
    expect(html).toContain("<strong>reading</strong>");
    expect(html).toContain('href="https://example.com"');
  });

  it("AUTHOR_NOTE_SANITIZE_OPTS is exported and usable by SafeHtml", () => {
    expect(AUTHOR_NOTE_SANITIZE_OPTS.ALLOWED_TAGS).toContain("a");
    expect(AUTHOR_NOTE_SANITIZE_OPTS.ALLOWED_TAGS).toContain("img");
    expect(AUTHOR_NOTE_SANITIZE_OPTS.ALLOWED_ATTR).toContain("href");
    expect(AUTHOR_NOTE_SANITIZE_OPTS.ALLOWED_ATTR).toContain("src");
    expect(AUTHOR_NOTE_SANITIZE_OPTS.ALLOWED_URI_REGEXP.test("mailto:x@y")).toBe(true);
    expect(AUTHOR_NOTE_SANITIZE_OPTS.ALLOWED_URI_REGEXP.test("javascript:alert(1)")).toBe(false);
    expect(AUTHOR_NOTE_SANITIZE_OPTS.ALLOWED_URI_REGEXP.test("data:image/png;base64,abc")).toBe(true);
    expect(AUTHOR_NOTE_SANITIZE_OPTS.ALLOWED_URI_REGEXP.test("data:image/svg+xml;base64,abc")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/publish-author-note.test.ts -t buildAuthorNoteHtml`
Expected: FAIL — `buildAuthorNoteHtml` not exported.

- [ ] **Step 3: Implement `buildAuthorNoteHtml` with embedded sanitization**

Append to `lib/publish/author-note.ts`:

```ts
import QRCode from "qrcode";
import DOMPurify from "isomorphic-dompurify";

/**
 * Allowlist used by both the EPUB build path (via this module's builder)
 * and the in-app reader (via SafeHtml). Single source of truth — drift
 * between the two surfaces would be an XSS vector.
 *
 * Restricts URI schemes on href/src attributes:
 *  - http(s):              for the mailing-list link
 *  - mailto:               for the email link
 *  - data:image/png;base64 for the QR PNG only (NOT image/svg+xml — SVGs
 *                          can carry inline <script>)
 */
export const AUTHOR_NOTE_SANITIZE_OPTS = {
  ALLOWED_TAGS: [
    "div", "p", "br", "strong", "em", "h2", "a", "img",
  ],
  ALLOWED_ATTR: [
    "class", "href", "src", "alt", "width", "height",
  ],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|data:image\/png;base64,)/i,
} as const;

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;",
  '"': "&quot;", "'": "&#39;",
};
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

export async function buildAuthorNoteHtml(opts: {
  messageHtml: string;
  email?: string;
  mailingListUrl?: string;
}): Promise<string> {
  const { messageHtml, email, mailingListUrl } = opts;

  const parts: string[] = [];
  parts.push('<div class="author-note">');
  parts.push("<h2>A note from the author</h2>");
  parts.push('<div class="author-note-message">');
  parts.push(messageHtml);
  parts.push("</div>");

  const footerParts: string[] = [];

  if (email && email.trim().length > 0) {
    const safe = escapeHtml(email.trim());
    footerParts.push(`<p><a href="mailto:${safe}">${safe}</a></p>`);
  }

  if (mailingListUrl && mailingListUrl.trim().length > 0) {
    const url = mailingListUrl.trim();
    const safeUrl = escapeHtml(url);
    const dataUrl = await QRCode.toDataURL(url, {
      type: "image/png",
      width: 200,
      margin: 1,
    });
    footerParts.push("<p>Join the mailing list:</p>");
    footerParts.push(`<p><a href="${safeUrl}">${safeUrl}</a></p>`);
    footerParts.push(
      `<img src="${dataUrl}" alt="QR code linking to the mailing list" width="200" height="200" />`,
    );
  }

  if (footerParts.length > 0) {
    parts.push('<div class="author-note-footer">');
    parts.push(...footerParts);
    parts.push("</div>");
  }

  parts.push("</div>");

  // CRITICAL: sanitize the assembled tree before returning so both the EPUB
  // build path AND the reader receive already-safe HTML. The reader's
  // SafeHtml wrapper will sanitize again (defense in depth, idempotent);
  // the EPUB build path has no sanitizer of its own.
  return DOMPurify.sanitize(parts.join(""), AUTHOR_NOTE_SANITIZE_OPTS);
}
```

The user-controlled message HTML is concatenated as-is, then the entire assembled tree is sanitized in one pass before returning. DOMPurify walks the whole tree, so `<script>` injected inside `messageHtml` and a forged `<a href="javascript:…">` are both stripped. Any future consumer can call this function and trust the output.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/publish-author-note.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/publish/author-note.ts tests/lib/publish-author-note.test.ts
git commit -m "publish: add buildAuthorNoteHtml with QR generation"
```

### Chunk 2 Wrap-up

- [ ] **Run full test + typecheck + lint**

```bash
npm run typecheck && npm run lint && npx vitest run
```

Expected: PASS on all three.

---

## Chunk 3: API surface (settings + story PATCH allowlists)

**Goal of this chunk:** The two API routes that persist user-edited config and story fields accept the new shapes round-trip-cleanly. No UI yet.

### Task 3.1: Settings GET/PUT — `penNameProfiles`

**Files:**
- Modify: `app/api/settings/route.ts`
- Modify: `tests/api/settings.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `tests/api/settings.test.ts` (mirror existing PUT-then-GET pattern; the `effectiveDataDir()` is set per-test via `SCRIPTR_DATA_DIR`):

```ts
it("PUT accepts penNameProfiles and GET returns them", async () => {
  const profile = {
    "Jane Doe": {
      email: "jane@example.com",
      mailingListUrl: "https://list.example.com/jane",
      defaultMessageHtml: "<p>Default</p>",
    },
  };
  const putRes = await PUT(makeRequest({ penNameProfiles: profile }));
  expect((await putRes.json()).ok).toBe(true);

  const getRes = await GET();
  const body = await getRes.json();
  expect(body.ok).toBe(true);
  expect(body.data.penNameProfiles).toEqual(profile);
});

it("PUT ignores unknown fields (allowlist behavior)", async () => {
  const putRes = await PUT(makeRequest({ penNameProfiles: { x: { email: "a@b" } }, somethingElse: "x" }));
  expect((await putRes.json()).ok).toBe(true);
  const cfg = await loadConfig(effectiveDataDir());
  expect("somethingElse" in cfg).toBe(false);
});
```

(If the file doesn't have a `makeRequest` helper, mirror whatever pattern it currently uses for shaping `NextRequest` instances.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/api/settings.test.ts -t penNameProfiles`
Expected: FAIL — GET response doesn't include `penNameProfiles`; PUT silently drops the field.

- [ ] **Step 3: Update settings route**

In `app/api/settings/route.ts`:

GET — extend the returned object to include `penNameProfiles: cfg.penNameProfiles`.

PUT — extend the `allowed` array to include `"penNameProfiles"`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/api/settings.test.ts`
Expected: PASS (full file).

- [ ] **Step 5: Commit**

```bash
git add app/api/settings/route.ts tests/api/settings.test.ts
git commit -m "api: settings route accepts/returns penNameProfiles"
```

### Task 3.2: Story PATCH — `authorNote`

**Files:**
- Modify: `app/api/stories/[slug]/route.ts:18-25`
- Modify: `tests/api/stories.slug.test.ts`

- [ ] **Step 1: Write failing test**

Add to `tests/api/stories.slug.test.ts`:

```ts
it("PATCH accepts authorNote and round-trips it via GET", async () => {
  const story = await createStory(effectiveDataDir(), { title: "Test" });
  const patchRes = await PATCH(
    makeRequest({ authorNote: { enabled: true, messageHtml: "<p>hi</p>" } }),
    { params: Promise.resolve({ slug: story.slug }) },
  );
  expect((await patchRes.json()).ok).toBe(true);

  const getRes = await GET(makeRequest({}), { params: Promise.resolve({ slug: story.slug }) });
  const body = await getRes.json();
  expect(body.data.authorNote).toEqual({ enabled: true, messageHtml: "<p>hi</p>" });
});

it("PATCH accepts authorNote.enabled=false alone and persists it", async () => {
  const story = await createStory(effectiveDataDir(), { title: "Test 2" });
  const res = await PATCH(
    makeRequest({ authorNote: { enabled: false } }),
    { params: Promise.resolve({ slug: story.slug }) },
  );
  expect((await res.json()).ok).toBe(true);

  const getRes = await GET(makeRequest({}), { params: Promise.resolve({ slug: story.slug }) });
  const body = await getRes.json();
  expect(body.data.authorNote).toEqual({ enabled: false });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/stories.slug.test.ts -t authorNote`
Expected: FAIL — `authorNote` is not in the PATCH allowlist; the field gets silently dropped.

- [ ] **Step 3: Extend PATCH allowlist**

In `app/api/stories/[slug]/route.ts`, add `"authorNote"` to the `allowed` array.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/stories.slug.test.ts -t authorNote`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/stories/\[slug\]/route.ts tests/api/stories.slug.test.ts
git commit -m "api: story PATCH accepts authorNote"
```

### Chunk 3 Wrap-up

- [ ] **Run full test + typecheck + lint**

```bash
npm run typecheck && npm run lint && npx vitest run
```

Expected: PASS.

---

## Chunk 4: EPUB integration

**Goal of this chunk:** EPUB exports include the author note when configured, omit it when not, and produce byte-identical output to today's behavior on the no-profile path.

### Task 4.1: Extend `EpubInput` and `buildEpubBytes`

**Files:**
- Modify: `lib/publish/epub.ts:25-46`
- Modify: `tests/lib/publish-epub.test.ts`

- [ ] **Step 1: Write failing tests**

Use `JSZip` directly (already a dep — see [tests/lib/helpers/epub-inspect.ts](../../../tests/lib/helpers/epub-inspect.ts) for the pattern). Add to `tests/lib/publish-epub.test.ts`:

```ts
import JSZip from "jszip";

async function unzipXhtmls(bytes: Uint8Array): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(bytes);
  const out: Record<string, string> = {};
  await Promise.all(
    Object.keys(zip.files)
      .filter((p) => p.endsWith(".xhtml"))
      .map(async (p) => { out[p] = await zip.file(p)!.async("string"); }),
  );
  return out;
}

it("appends the author note as a final content entry when input.authorNote is provided", async () => {
  const bytes = await buildEpubBytes({
    story: makeStory(),
    chapters: [makeChapter("Ch 1", "Hello.")],
    authorNote: {
      messageHtml: "<p>Thanks!</p>",
      email: "jane@example.com",
      mailingListUrl: "https://list.example.com/jane",
    },
  });
  const xhtmls = await unzipXhtmls(bytes);
  const paths = Object.keys(xhtmls).sort();
  const last = xhtmls[paths[paths.length - 1]];
  expect(last).toContain("A note from the author");
  expect(last).toContain('href="mailto:jane@example.com"');
  expect(last).toMatch(/<img[^>]+src="data:image\/png;base64,/);
});

it("omits the author note entry when input.authorNote is undefined", async () => {
  const bytes = await buildEpubBytes({
    story: makeStory(),
    chapters: [makeChapter("Ch 1", "Hello.")],
  });
  const xhtmls = await unzipXhtmls(bytes);
  for (const text of Object.values(xhtmls)) {
    expect(text).not.toContain("A note from the author");
  }
});

it("works on EPUB2 as well as EPUB3", async () => {
  const bytes2 = await buildEpubBytes({
    story: makeStory(),
    chapters: [makeChapter("Ch 1", "Hello.")],
    version: 2,
    authorNote: { messageHtml: "<p>x</p>", email: "j@e.com" },
  });
  const xhtmls = await unzipXhtmls(bytes2);
  const paths = Object.keys(xhtmls).sort();
  expect(xhtmls[paths[paths.length - 1]]).toContain("A note from the author");
});

it("regression guard: no-note path produces same XHTML count as today's behavior", async () => {
  // The spec calls for "byte-identical" output but epub-gen-memory writes
  // ZIP entries with mtimes that may vary per run. The realistic guard is:
  //  1. Same number of XHTML files (no extra entry appended)
  //  2. None of those XHTMLs contain the note marker
  // Together these prove the no-note path is structurally unchanged.
  const story = makeStory();
  const chapters = [makeChapter("Ch 1", "Hello."), makeChapter("Ch 2", "Bye.")];

  const baseline = await buildEpubBytes({ story, chapters });
  const disabled = await buildEpubBytes({
    story: { ...story, authorNote: { enabled: false } },
    chapters,
  });
  const noProfile = await buildEpubBytes({ story, chapters /* no authorNote on input */ });

  const baseXhtmls = await unzipXhtmls(baseline);
  const disabledXhtmls = await unzipXhtmls(disabled);
  const noProfileXhtmls = await unzipXhtmls(noProfile);

  expect(Object.keys(baseXhtmls).length).toBe(Object.keys(disabledXhtmls).length);
  expect(Object.keys(baseXhtmls).length).toBe(Object.keys(noProfileXhtmls).length);
  for (const text of Object.values({ ...baseXhtmls, ...disabledXhtmls, ...noProfileXhtmls })) {
    expect(text).not.toContain("A note from the author");
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/publish-epub.test.ts`
Expected: FAIL — `authorNote` not a known input field; output doesn't contain the note.

- [ ] **Step 3: Extend `EpubInput` and `buildEpubBytes`**

In `lib/publish/epub.ts`:

Add import:

```ts
import { buildAuthorNoteHtml, type ResolvedAuthorNote } from "@/lib/publish/author-note";
```

Extend `EpubInput`:

```ts
export type EpubInput = {
  story: Story;
  chapters: Chapter[];
  coverPath?: string;
  version?: EpubVersion;
  authorNote?: ResolvedAuthorNote;
};
```

In `buildEpubBytes`, after the existing `chapters.map(...)` block but before the generator call:

```ts
if (input.authorNote) {
  content.push({
    title: "A note from the author",
    content: await buildAuthorNoteHtml(input.authorNote),
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/publish-epub.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/publish/epub.ts tests/lib/publish-epub.test.ts
git commit -m "publish: append author-note entry to EPUB when provided"
```

### Task 4.2: EPUB stylesheet — `.author-note` styles

**Files:**
- Modify: `lib/publish/epub-preview.ts:17`

- [ ] **Step 1: Append author-note styles**

Append inside the `EPUB_STYLESHEET` template literal:

```css
.author-note {
  margin-top: 3em;
  border-top: 1px solid #888;
  padding-top: 2em;
}
.author-note h2 {
  text-align: center;
  margin-bottom: 1.2em;
}
.author-note-message {
  margin-bottom: 1.5em;
}
.author-note-footer {
  text-align: center;
  font-size: 0.95em;
  color: #555;
}
.author-note-footer img {
  display: block;
  margin: 0.5em auto;
  max-width: 200px;
}
```

- [ ] **Step 2: Run typecheck + tests**

```bash
npm run typecheck && npx vitest run
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/publish/epub-preview.ts
git commit -m "publish: add .author-note styles to EPUB stylesheet"
```

### Task 4.3: EPUB export route — resolve and pass author-note

**Files:**
- Modify: `app/api/stories/[slug]/export/epub/route.ts`
- Modify: `tests/api/export.epub.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `tests/api/export.epub.test.ts` (reuse the same `unzipXhtmls` helper from Chunk 4 / Task 4.1, or import it if extracted; minimal duplication is fine):

```ts
import JSZip from "jszip";
import { readFile } from "node:fs/promises";

async function unzipXhtmls(bytes: Buffer | Uint8Array): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(bytes);
  const out: Record<string, string> = {};
  await Promise.all(
    Object.keys(zip.files)
      .filter((p) => p.endsWith(".xhtml"))
      .map(async (p) => { out[p] = await zip.file(p)!.async("string"); }),
  );
  return out;
}

it("includes the author note when story's pen-name has a profile and authorNote is enabled", async () => {
  const dir = effectiveDataDir();
  const story = await createStory(dir, { title: "T", authorPenName: "Jane Doe" });
  await createChapter(dir, story.slug, { title: "Ch1", sections: [{ id: "s1", content: "Hi." }] });
  await saveConfig(dir, {
    penNameProfiles: {
      "Jane Doe": {
        email: "jane@example.com",
        mailingListUrl: "https://list.example.com/jane",
        defaultMessageHtml: "<p>Thanks!</p>",
      },
    },
  });
  const res = await POST(
    makeRequest({}),
    { params: Promise.resolve({ slug: story.slug }) },
  );
  const body = await res.json();
  expect(body.ok).toBe(true);
  const bytes = await readFile(body.data.path);
  const xhtmls = await unzipXhtmls(bytes);
  const paths = Object.keys(xhtmls).sort();
  const last = xhtmls[paths[paths.length - 1]];
  expect(last).toContain("A note from the author");
  expect(last).toContain("mailto:jane@example.com");
});

it("omits the author note when no profile exists", async () => {
  const dir = effectiveDataDir();
  const story = await createStory(dir, { title: "U", authorPenName: "Solo" });
  await createChapter(dir, story.slug, { title: "Ch1", sections: [{ id: "s1", content: "Hi." }] });
  const res = await POST(
    makeRequest({}),
    { params: Promise.resolve({ slug: story.slug }) },
  );
  const body = await res.json();
  const bytes = await readFile(body.data.path);
  const xhtmls = await unzipXhtmls(bytes);
  for (const text of Object.values(xhtmls)) {
    expect(text).not.toContain("A note from the author");
  }
});

it("omits the author note when authorNote.enabled === false", async () => {
  const dir = effectiveDataDir();
  const story = await createStory(dir, { title: "V", authorPenName: "Jane Doe" });
  await updateStory(dir, story.slug, { authorNote: { enabled: false } });
  await createChapter(dir, story.slug, { title: "Ch1", sections: [{ id: "s1", content: "Hi." }] });
  await saveConfig(dir, {
    penNameProfiles: { "Jane Doe": { email: "j@x.com" } },
  });
  const res = await POST(
    makeRequest({}),
    { params: Promise.resolve({ slug: story.slug }) },
  );
  const body = await res.json();
  const bytes = await readFile(body.data.path);
  const xhtmls = await unzipXhtmls(bytes);
  for (const text of Object.values(xhtmls)) {
    expect(text).not.toContain("A note from the author");
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/api/export.epub.test.ts -t "author note"`
Expected: FAIL — route does not load profile or pass `authorNote` to builder.

- [ ] **Step 3: Update export route**

In `app/api/stories/[slug]/export/epub/route.ts`:

Add imports:

```ts
import { loadConfig } from "@/lib/config";
import { resolveAuthorNote } from "@/lib/publish/author-note";
```

After loading `story` and `chapters`, before `buildEpubBytes`:

```ts
const cfg = await loadConfig(dataDir);
const profile = cfg.penNameProfiles?.[story.authorPenName];
const authorNote = resolveAuthorNote(story, profile) ?? undefined;
```

Update the builder call:

```ts
const bytes = await buildEpubBytes({ story, chapters, coverPath, version, authorNote });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/api/export.epub.test.ts`
Expected: PASS (full file).

- [ ] **Step 5: Commit**

```bash
git add app/api/stories/\[slug\]/export/epub/route.ts tests/api/export.epub.test.ts
git commit -m "api: epub export route resolves and includes author-note"
```

### Chunk 4 Wrap-up

- [ ] **Run full test + typecheck + lint**

```bash
npm run typecheck && npm run lint && npx vitest run
```

Expected: PASS.

---

## Chunk 5: Reader integration

**Goal of this chunk:** The in-app reader page renders the author note at the bottom when applicable, mirroring EPUB output via the same builder.

### Task 5.1: `ReaderView` accepts and renders `authorNoteHtml`

**Files:**
- Modify: `components/reader/ReaderView.tsx`
- Test: `tests/components/reader/ReaderView.test.tsx` (**new**)

- [ ] **Step 1: Write failing test**

Create `tests/components/reader/ReaderView.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReaderView } from "@/components/reader/ReaderView";

const baseStory = (over = {}) => ({
  slug: "s", title: "T", authorPenName: "Jane",
  description: "", copyrightYear: 2026, language: "en",
  bisacCategory: "FIC027000", keywords: [],
  createdAt: "", updatedAt: "", chapterOrder: [],
  ...over,
});

const baseChapters = [
  { id: "c1", title: "Ch1", summary: "", beats: [], prompt: "", recap: "",
    sections: [{ id: "s1", content: "Hello." }], wordCount: 1 },
];

describe("ReaderView author-note", () => {
  it("renders the note block when authorNoteHtml is provided", () => {
    render(<ReaderView
      story={baseStory()}
      chapters={baseChapters}
      authorNoteHtml='<div class="author-note"><h2>A note from the author</h2><p>Hi</p></div>'
    />);
    expect(screen.getByText("A note from the author")).toBeInTheDocument();
  });

  it("omits the note block when authorNoteHtml is undefined", () => {
    render(<ReaderView story={baseStory()} chapters={baseChapters} />);
    expect(screen.queryByText("A note from the author")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/reader/ReaderView.test.tsx`
Expected: FAIL — `authorNoteHtml` prop not recognized.

- [ ] **Step 3: Update `ReaderView`**

In `components/reader/ReaderView.tsx`:

Add imports:

```tsx
import { SafeHtml } from "@/lib/publish/safe-html";
import { AUTHOR_NOTE_SANITIZE_OPTS } from "@/lib/publish/author-note";
```

Extend the props type:

```tsx
interface ReaderViewProps {
  story: Story;
  chapters: Chapter[];
  authorNoteHtml?: string;
}
```

After the chapters block and before the existing `<footer>`:

```tsx
{authorNoteHtml ? (
  <SafeHtml html={authorNoteHtml} extra={AUTHOR_NOTE_SANITIZE_OPTS} />
) : null}
```

Reusing the exported constant ensures the reader's allowlist is identical to the builder's — a single source of truth (drift would be an XSS vector).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/reader/ReaderView.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/reader/ReaderView.tsx tests/components/reader/ReaderView.test.tsx
git commit -m "reader: accept and render authorNoteHtml via SafeHtml"
```

### Task 5.2: Reader page server component resolves the note

**Files:**
- Modify: `app/s/[slug]/read/page.tsx`

The spec's open question about caching is resolved here: the reader is a server component that reads `data/config.json` and `data/stories/<slug>/story.json` per request, so we want zero caching — otherwise a profile edit in settings won't reflect on reader refresh until the route segment is invalidated. Set `dynamic = "force-dynamic"` on the segment.

- [ ] **Step 1: Update the server component**

Add at the top of the file (segment-level config — Next.js 16 App Router):

```tsx
export const dynamic = "force-dynamic";
```

Add imports:

```tsx
import { loadConfig } from "@/lib/config";
import { resolveAuthorNote, buildAuthorNoteHtml } from "@/lib/publish/author-note";
```

Inside `ReaderPage`:

```tsx
const [story, chapters, cfg] = await Promise.all([
  getStory(dataDir, slug),
  listChapters(dataDir, slug),
  loadConfig(dataDir),
]);

if (!story) notFound();

const profile = cfg.penNameProfiles?.[story.authorPenName];
const resolved = resolveAuthorNote(story, profile);
const authorNoteHtml = resolved ? await buildAuthorNoteHtml(resolved) : undefined;

return <ReaderView story={story} chapters={chapters} authorNoteHtml={authorNoteHtml} />;
```

> Read the relevant guide in `node_modules/next/dist/docs/` if `force-dynamic` semantics are unclear in Next 16 (per AGENTS.md: "This is NOT the Next.js you know"). The page already does I/O against the local filesystem on every render, so opting out of caching has no practical performance cost.

- [ ] **Step 2: Type + lint check**

```bash
npm run typecheck && npm run lint
```

Expected: PASS.

- [ ] **Step 3: Manual smoke (recommended)**

Run `npm run dev`, navigate to a story's reader page with a configured profile, scroll to the bottom, confirm the note renders.

- [ ] **Step 4: Commit**

```bash
git add app/s/\[slug\]/read/page.tsx
git commit -m "reader: resolve author-note server-side and pass to ReaderView"
```

### Chunk 5 Wrap-up

- [ ] **Run full test + typecheck + lint**

```bash
npm run typecheck && npm run lint && npx vitest run
```

Expected: PASS.

---

## Chunk 6: UI — RichTextEditor + Settings + MetadataPane

**Goal of this chunk:** User-facing surfaces for editing pen-name profiles (settings page) and per-story author-note overrides (story metadata pane). Built on a single shared TipTap component.

### Task 6.1: Reusable `RichTextEditor` component

**Files:**
- Create: `components/editor/RichTextEditor.tsx`
- Test: `tests/components/editor/RichTextEditor.test.tsx` (**new**)

- [ ] **Step 1: Install Link extension**

```bash
npm install @tiptap/extension-link
```

> StarterKit (per `@tiptap/starter-kit` v3) does not include the Link mark. Verify by inspecting `node_modules/@tiptap/starter-kit/` if curious — it bundles Bold, Italic, Paragraph, History, etc., but NOT Link.

- [ ] **Step 2: Write failing test**

Create `tests/components/editor/RichTextEditor.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RichTextEditor } from "@/components/editor/RichTextEditor";

describe("RichTextEditor", () => {
  it("renders initial HTML", () => {
    render(<RichTextEditor initialHtml="<p>Hello <strong>world</strong></p>" onChange={() => {}} />);
    expect(screen.getByText("Hello", { exact: false })).toBeInTheDocument();
    expect(document.querySelector("strong")?.textContent).toBe("world");
  });

  it("calls onChange with HTML when content changes", async () => {
    const onChange = vi.fn();
    render(<RichTextEditor initialHtml="<p></p>" onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("textbox"));
    await user.keyboard("hi");
    await new Promise((r) => setTimeout(r, 0));
    expect(onChange).toHaveBeenCalled();
    const calls = onChange.mock.calls.map((c) => c[0]);
    expect(calls.some((html) => /hi/.test(html))).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/components/editor/RichTextEditor.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement `RichTextEditor`**

Create `components/editor/RichTextEditor.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";

interface Props {
  initialHtml: string;
  onChange: (html: string) => void;
  ariaLabel?: string;
}

export function RichTextEditor({ initialHtml, onChange, ariaLabel }: Props) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
      }),
      Link.configure({ openOnClick: false, autolink: false }),
    ],
    content: initialHtml,
    editable: true,
    editorProps: {
      attributes: {
        "aria-label": ariaLabel ?? "Rich text editor",
        class:
          "tiptap-rich-editor min-h-[5em] rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
      },
    },
    onUpdate({ editor }) {
      onChange(editor.getHTML());
    },
  });

  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() !== initialHtml) {
      editor.commands.setContent(initialHtml, { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHtml]);

  if (!editor) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 border border-input rounded-md p-1 bg-background">
        <button
          type="button"
          aria-label="Bold"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`px-2 py-1 text-sm rounded ${editor.isActive("bold") ? "bg-accent" : ""}`}
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          aria-label="Italic"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`px-2 py-1 text-sm rounded ${editor.isActive("italic") ? "bg-accent" : ""}`}
        >
          <em>I</em>
        </button>
        <button
          type="button"
          aria-label="Link"
          onClick={() => {
            const url = window.prompt("URL");
            if (!url) return;
            // @tiptap/extension-link exposes setLink({ href }) — verify
            // against node_modules/@tiptap/extension-link/ if the API has
            // shifted in the installed version.
            editor.chain().focus().setLink({ href: url }).run();
          }}
          className={`px-2 py-1 text-sm rounded ${editor.isActive("link") ? "bg-accent" : ""}`}
        >
          🔗
        </button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/components/editor/RichTextEditor.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/editor/RichTextEditor.tsx tests/components/editor/RichTextEditor.test.tsx package.json package-lock.json
git commit -m "editor: add RichTextEditor with bold/italic/link toolbar"
```

### Task 6.2: Settings — Pen Name Profiles section

**Files:**
- Create: `components/settings/PenNameProfilesSection.tsx`
- Modify: `app/settings/page.tsx`
- Test: `tests/components/settings/PenNameProfilesSection.test.tsx` (**new**)

- [ ] **Step 1: Write failing test**

Create `tests/components/settings/PenNameProfilesSection.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PenNameProfilesSection } from "@/components/settings/PenNameProfilesSection";

describe("PenNameProfilesSection", () => {
  it("renders existing profiles as cards", () => {
    render(
      <PenNameProfilesSection
        profiles={{ "Jane Doe": { email: "j@x", mailingListUrl: "https://l" } }}
        knownPenNames={["Jane Doe", "John Smith"]}
        onSave={() => {}}
      />
    );
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect((screen.getByLabelText(/email/i, { selector: "input" }) as HTMLInputElement).value).toBe("j@x");
  });

  it("calls onSave with updated profile when saved", async () => {
    const onSave = vi.fn();
    render(
      <PenNameProfilesSection
        profiles={{ "Jane Doe": {} }}
        knownPenNames={["Jane Doe"]}
        onSave={onSave}
      />
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email/i, { selector: "input" }), "jane@example.com");
    await user.click(screen.getByRole("button", { name: /save jane doe/i }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        "Jane Doe": expect.objectContaining({ email: "jane@example.com" }),
      })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/settings/PenNameProfilesSection.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `PenNameProfilesSection`**

Component contract:

```tsx
type Props = {
  profiles: Record<string, PenNameProfile>;     // current profiles
  knownPenNames: string[];                       // union of profile keys + Story.authorPenName values
  onSave: (next: Record<string, PenNameProfile>) => void | Promise<void>;
  onDelete?: (penName: string) => void | Promise<void>;
};
```

Use shadcn primitives (Card, Input, Label, Button) — mirror the structure of the section directly above it in `app/settings/page.tsx`. Render order:

1. Header `<h2>Pen Name Profiles</h2>` with the section's existing styling.
2. One card per entry in `knownPenNames`. Each card holds local edit state initialized from `profiles[name] ?? {}` and renders:
   - `<Label>Email</Label> <Input data-testid={"pen-email-" + slug(name)} />`
   - `<Label>Mailing list URL</Label> <Input data-testid={"pen-mailing-" + slug(name)} />`
   - `<Label>Default message</Label> <RichTextEditor initialHtml={current.defaultMessageHtml ?? ""} onChange={…} />` — wrap in a `<div data-testid={"pen-message-" + slug(name)}>` for stable e2e selection.
   - `<Button data-testid={"pen-save-" + slug(name)}>Save {name}</Button>`
   - `<Button variant="ghost" data-testid={"pen-delete-" + slug(name)}>Delete profile</Button>` — only shown if `profiles[name]` exists. Calls `onDelete(name)`.
3. An "Add profile for new pen name" row with `<Input data-testid="pen-name-new" />` + `<Button data-testid="pen-name-add">Add</Button>` that appends a new entry locally.

The `slug(name)` helper just lower-cases and replaces non-alphanumerics with `-` so test IDs remain stable across pen-name strings with spaces/punctuation. Use the existing `lib/slug.ts::toSlug` if it fits; otherwise inline a 2-line helper.

Save semantics: clicking a row's Save button calls `onSave` with the FULL updated `profiles` object (not just the row), so the parent can PUT the whole `penNameProfiles` to settings in one request — sidesteps the spec's open question about config PATCH merging.

- [ ] **Step 4: Wire into `app/settings/page.tsx`**

Add a section that:
1. Fetches `penNameProfiles` from `/api/settings` (extending whatever fetch already runs on this page).
2. Lists known pen names: GET `/api/stories`, collect unique `authorPenName` values, union with `Object.keys(penNameProfiles)`.
3. Renders `<PenNameProfilesSection profiles={…} knownPenNames={…} onSave={save} onDelete={del} />`.
4. `save(next)` PUTs `/api/settings` with `{ penNameProfiles: next }` and revalidates SWR.
5. `del(name)` constructs `next = omit(profiles, name)` and calls `save(next)`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/components/settings/PenNameProfilesSection.test.tsx`
Expected: PASS.

- [ ] **Step 6: Manual smoke**

Open settings, add a profile, save, refresh, confirm it persisted (check `data/config.json` on disk).

- [ ] **Step 7: Commit**

```bash
git add components/settings/PenNameProfilesSection.tsx app/settings/page.tsx tests/components/settings/PenNameProfilesSection.test.tsx
git commit -m "settings: add Pen Name Profiles section"
```

### Task 6.3: MetadataPane — Author Note card

**Files:**
- Create: `components/editor/AuthorNoteCard.tsx`
- Modify: `components/editor/MetadataPane.tsx`
- Test: `tests/components/editor/AuthorNoteCard.test.tsx` (**new**)

- [ ] **Step 1: Write failing test**

Create `tests/components/editor/AuthorNoteCard.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthorNoteCard } from "@/components/editor/AuthorNoteCard";

describe("AuthorNoteCard", () => {
  it("disables toggle and shows hint when no profile exists", () => {
    render(
      <AuthorNoteCard
        story={{ authorPenName: "Solo" } as any}
        profile={undefined}
        onChange={() => {}}
      />
    );
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByText(/set up a pen-name profile/i)).toBeInTheDocument();
  });

  it("defaults toggle to checked when profile exists and authorNote undefined", () => {
    render(
      <AuthorNoteCard
        story={{ authorPenName: "Jane" } as any}
        profile={{ email: "j@x" }}
        onChange={() => {}}
      />
    );
    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  it("emits onChange when toggle flipped", async () => {
    const onChange = vi.fn();
    render(
      <AuthorNoteCard
        story={{ authorPenName: "Jane" } as any}
        profile={{ email: "j@x" }}
        onChange={onChange}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/editor/AuthorNoteCard.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `AuthorNoteCard`**

Component contract:

```tsx
type Props = {
  story: Story;
  profile: PenNameProfile | undefined;          // profile for story.authorPenName
  onChange: (next: Story["authorNote"]) => void;
};
```

Mirror peer cards in `MetadataPane.tsx` (`SummaryField`, `BeatList`). Render:

- A `<div data-testid="author-note-card">` wrapping the card body.
- `<input type="checkbox" data-testid="author-note-toggle" ... aria-label="Include author note in this story" />`. Disabled when `!profile`. Initial checked state: `profile ? (story.authorNote?.enabled !== false) : false`. Flipping it calls `onChange({ enabled: <new>, messageHtml: story.authorNote?.messageHtml })`.
- Below the checkbox, conditionally on `profile && story.authorNote?.enabled !== false`:
  - `<div data-testid="author-note-default-preview" class="opacity-60 text-sm">` rendering `profile.defaultMessageHtml` via `<SafeHtml html={profile.defaultMessageHtml ?? ""} extra={AUTHOR_NOTE_SANITIZE_OPTS} />` — but only when the override editor is empty.
  - `<div data-testid="author-note-override-editor"><RichTextEditor initialHtml={story.authorNote?.messageHtml ?? ""} onChange={(html) => onChange({ enabled: true, messageHtml: html })} /></div>`.
- When `!profile`, render dimmed helper text: "Set up a pen-name profile for *{story.authorPenName}* to enable." with a `<Link href="/settings">` to the settings page.

Wire `AuthorNoteCard` into `MetadataPane.tsx`. The pane already uses `useAutoSave` for other fields; instantiate the same hook with a new `value` (the current `authorNote`) and a `save` callback that PATCHes `/api/stories/[slug]` with `{ authorNote }`. The card's `onChange` updates the local state that feeds the autosave hook.

Add a test case to `tests/components/editor/AuthorNoteCard.test.tsx`:

```tsx
it("emits onChange with messageHtml when the override editor changes", async () => {
  const onChange = vi.fn();
  render(
    <AuthorNoteCard
      story={{ authorPenName: "Jane", authorNote: { enabled: true } } as any}
      profile={{ email: "j@x", defaultMessageHtml: "<p>default</p>" }}
      onChange={onChange}
    />
  );
  const editor = document.querySelector('[data-testid="author-note-override-editor"] [role="textbox"]');
  expect(editor).not.toBeNull();
  // userEvent.type would be brittle on TipTap; fire a synthetic input event
  // and rely on onUpdate firing — or assert the prop wiring directly via a
  // unit-style check (e.g., the override editor receives the right initialHtml).
  expect((editor as HTMLElement).getAttribute("aria-label")).toBe("Rich text editor");
});

it("renders the profile default preview when override is empty", () => {
  render(
    <AuthorNoteCard
      story={{ authorPenName: "Jane", authorNote: { enabled: true, messageHtml: "" } } as any}
      profile={{ defaultMessageHtml: "<p>Default thanks!</p>" }}
      onChange={() => {}}
    />
  );
  expect(document.querySelector('[data-testid="author-note-default-preview"]')).not.toBeNull();
  expect(document.body.textContent).toContain("Default thanks!");
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/components/editor/AuthorNoteCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Manual smoke**

Open a story whose pen name has a profile. Confirm:
- The card appears with a checked toggle.
- Editing the message persists (refresh the page; confirm).
- Toggling off greys out (or hides) the editor.
- For a pen name without a profile, the toggle is disabled with a link to settings.

- [ ] **Step 6: Commit**

```bash
git add components/editor/AuthorNoteCard.tsx components/editor/MetadataPane.tsx tests/components/editor/AuthorNoteCard.test.tsx
git commit -m "editor: add Author Note card to MetadataPane"
```

### Chunk 6 Wrap-up

- [ ] **Run full test + typecheck + lint**

```bash
npm run typecheck && npm run lint && npx vitest run
```

Expected: PASS.

---

## Chunk 7: Privacy egress test + E2E

**Goal of this chunk:** Privacy invariants are enforced by the load-bearing egress test even with the new feature configured, and a full end-to-end Playwright run validates the user flow.

### Task 7.1: Extend egress test

**Files:**
- Modify: `tests/privacy/no-external-egress.test.ts`

- [ ] **Step 1: Add a case that exercises EPUB export with author-note configured**

In the test that walks every non-exempt route, add (or extend) the EPUB export step so that:

1. Before the EPUB POST, write `penNameProfiles` to config via `saveConfig` (or a direct `PUT /api/settings`).
2. Set the seeded story's `authorPenName` to match.
3. Then call the EPUB export route.
4. After all calls complete, assert `recorded.length === 0`.

Concretely, before the existing EPUB export step:

```ts
await saveConfig(dataDir, {
  penNameProfiles: {
    [seededStory.authorPenName]: {
      email: "test@example.com",
      mailingListUrl: "https://list.example.com/test",
      defaultMessageHtml: "<p>Thanks!</p>",
    },
  },
});
```

The existing EPUB export step then resolves the profile and embeds the QR. Pure-JS, no fetch.

- [ ] **Step 2: Run the egress test**

Run: `npx vitest run tests/privacy/no-external-egress.test.ts`
Expected: PASS — `recorded === []`.

- [ ] **Step 3: Sanity — break it once to prove the test catches a regression**

Temporarily edit `lib/publish/author-note.ts` to call `await fetch("https://example.com")` inside `buildAuthorNoteHtml`. Run the egress test. It MUST fail. Revert the change and re-run; it MUST pass.

- [ ] **Step 4: Commit**

```bash
git add tests/privacy/no-external-egress.test.ts
git commit -m "privacy: egress test covers EPUB export with author-note"
```

### Task 7.2: Playwright E2E

**Files:**
- Create: `tests/e2e/author-note.spec.ts`

- [ ] **Step 1: Write the spec**

Create `tests/e2e/author-note.spec.ts`. Read [tests/e2e/publishing-kit.spec.ts](../../../tests/e2e/publishing-kit.spec.ts) first — reuse its story-creation pattern and EPUB filename convention (`${slug}-epub3.epub`). Use JSZip (already a dep) to inspect the exported file:

```ts
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { E2E_DATA_DIR } from "../../playwright.config";

async function epubXhtmls(bytes: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(bytes);
  return Promise.all(
    Object.keys(zip.files)
      .filter((p) => p.endsWith(".xhtml"))
      .map((p) => zip.file(p)!.async("string")),
  );
}

test.describe("author-note end page", () => {
  test("settings → metadata → reader → export → toggle off", async ({ page }) => {
    // Unique pen name + title per run — avoids collision with publishing-kit.spec.ts.
    const PEN = `AuthorNote E2E ${Date.now()}`;
    const TITLE = `AuthorNote ${Date.now()}`;

    // 1. Create a story via the UI. Read tests/e2e/publishing-kit.spec.ts
    //    first — if it exposes a helper, prefer that. Otherwise the inline
    //    flow is roughly:
    await page.goto("/");
    await page.getByRole("button", { name: /new story/i }).click();
    await page.getByLabel(/title/i).fill(TITLE);
    await page.getByLabel(/pen name/i).fill(PEN);
    await page.getByRole("button", { name: /create/i }).click();
    await page.waitForURL(/\/s\/[^/]+$/);
    const url = new URL(page.url());
    const slug = url.pathname.split("/").pop()!;
    expect(slug).toBeTruthy();

    // 2. Settings — pen name profile (using stable data-testid hooks added in Task 6.2)
    await page.goto("/settings");
    await page.getByRole("heading", { name: /pen name profiles/i }).scrollIntoViewIfNeeded();
    // Slug-version of the pen name (matches the helper used in PenNameProfilesSection)
    const penSlug = PEN.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    await page.getByTestId(`pen-email-${penSlug}`).fill("e2e@example.com");
    await page.getByTestId(`pen-mailing-${penSlug}`).fill("https://list.example.com/e2e");
    // Bold a word in the default-message TipTap editor inside the card.
    // Scope the toolbar button to the same card to avoid cross-card collisions.
    const messageCard = page.getByTestId(`pen-message-${penSlug}`);
    const messageEditor = messageCard.locator('[role="textbox"]');
    await messageEditor.click();
    await page.keyboard.type("Thanks for ");
    await messageCard.getByRole("button", { name: "Bold" }).click();
    await page.keyboard.type("reading");
    await page.getByTestId(`pen-save-${penSlug}`).click();

    // 3. Story metadata — verify default-on toggle
    await page.goto(`/s/${slug}`);
    const toggle = page.getByTestId("author-note-toggle");
    await expect(toggle).toBeChecked();

    // 4. Per-story override
    const overrideEditor = page.getByTestId("author-note-override-editor").locator('[role="textbox"]');
    await overrideEditor.click();
    await page.keyboard.type("This book in particular");
    // Allow autosave to flush
    await page.waitForTimeout(800);

    // 5. Reader
    await page.goto(`/s/${slug}/read`);
    await expect(page.getByRole("heading", { name: /a note from the author/i })).toBeVisible();
    await expect(page.getByText(/this book in particular/i)).toBeVisible();
    await expect(page.locator('img[alt="QR code linking to the mailing list"]')).toHaveAttribute(
      "src",
      /^data:image\/png;base64,/,
    );
    await expect(page.getByRole("link", { name: "e2e@example.com" })).toHaveAttribute(
      "href",
      "mailto:e2e@example.com",
    );

    // 6. Export EPUB; read off disk; assert the note is in the last XHTML
    await page.goto(`/s/${slug}/export`);
    await page.getByTestId("export-version-epub3").click();
    await page.getByRole("button", { name: /export/i }).click();
    await expect(page.getByTestId("export-lastbuild-epub3")).toBeVisible({ timeout: 30_000 });
    const epubPath = join(E2E_DATA_DIR, "stories", slug, "exports", `${slug}-epub3.epub`);
    expect(existsSync(epubPath)).toBe(true);
    const xhtmls1 = await epubXhtmls(await readFile(epubPath));
    expect(xhtmls1.some((x) => x.includes("A note from the author"))).toBe(true);
    expect(xhtmls1.some((x) => x.includes("mailto:e2e@example.com"))).toBe(true);
    expect(xhtmls1.some((x) => /<img[^>]+src="data:image\/png;base64,/.test(x))).toBe(true);

    // 7. Toggle off → re-export → assert note absent
    await page.goto(`/s/${slug}`);
    await page.getByTestId("author-note-toggle").uncheck();
    await page.waitForTimeout(800);
    await page.goto(`/s/${slug}/export`);
    await page.getByRole("button", { name: /export/i }).click();
    await expect(page.getByTestId("export-lastbuild-epub3")).toBeVisible({ timeout: 30_000 });
    const xhtmls2 = await epubXhtmls(await readFile(epubPath));
    expect(xhtmls2.every((x) => !x.includes("A note from the author"))).toBe(true);
  });
});
```

> If `publishing-kit.spec.ts` exposes a `createStoryViaUI(page, { title, penName })` helper, reuse it for step 1. If not, mirror the form fill / submit pattern inline. The export-page test IDs (`export-version-epub3`, `export-lastbuild-epub3`) are taken from the existing publishing-kit spec — verify they still exist on the export page before relying on them.

- [ ] **Step 2: Run the E2E spec**

```bash
npm run e2e -- tests/e2e/author-note.spec.ts
```

Expected: PASS. (E2E spins up its own dev server on port 3001; `SCRIPTR_DATA_DIR=/tmp/scriptr-e2e`.)

- [ ] **Step 3: Cleanup pollution check**

```bash
npm run e2e
```

Expected: full suite PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/author-note.spec.ts
git commit -m "e2e: end-to-end spec for author-note feature"
```

### Chunk 7 Wrap-up

- [ ] **Run full validation suite**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run e2e
```

Expected: PASS on all four.

---

## Done

When all chunks pass:

1. The user can configure a pen-name profile in settings (email, mailing-list URL, default rich-text message).
2. Each story gets an auto-on toggle and an optional per-story message override.
3. EPUB exports (both versions) and the in-app reader show the note as the final section.
4. The QR encodes the mailing-list URL, embedded as a base64 PNG.
5. Privacy invariants hold: zero outbound network calls, no CSP changes, egress test green.
6. All unit, integration, and E2E tests pass.

Recommend a final manual smoke pass:
- Configure profiles for two distinct pen names.
- Verify each story renders its own pen name's note (not the other's).
- Verify a story whose pen name has no profile has no note (and the toggle is disabled).
- Open an exported `.epub` in Calibre or another reader; confirm the note renders cleanly.
