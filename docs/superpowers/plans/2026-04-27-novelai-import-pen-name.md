# NovelAI Import Pen-Name Picker — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user pick (or type) an author pen name during NovelAI new-story import, defaulting to the only saved profile when exactly one exists, so the per-story Author Note toggle becomes operative on the first visit to the new story.

**Architecture:** Backend gains a one-line additive change — the commit route accepts an optional `story.authorPenName: string` and threads it into `createStory` (which already supports the field). Frontend gains a new presentational `PenNamePicker` component (a `<select>` over saved profiles + a "Custom…" sentinel that swaps to a free-text input; falls back to a plain input when no profiles exist). The dialog adds an SWR fetch for `/api/settings`, extends `StoryFormState` with `authorPenName`, renders the picker in `MetadataFields`, and includes the field in the commit payload.

**Tech Stack:** Next.js 16 (App Router), React 19, vitest (jsdom for component tests, node for route tests), SWR. Manual React 19 render harness for component tests, mirroring [tests/components/editor/AuthorNoteCard.test.tsx](../../../tests/components/editor/AuthorNoteCard.test.tsx).

**Spec:** [docs/superpowers/specs/2026-04-27-novelai-import-pen-name-design.md](../specs/2026-04-27-novelai-import-pen-name-design.md)

---

## File Structure

**Create:**
- `components/import/PenNamePicker.tsx` — presentational picker (select+custom mode, or plain input when no profiles).
- `tests/components/import/PenNamePicker.test.tsx` — picker tests (jsdom).

**Modify:**
- `app/api/import/novelai/commit/route.ts` — accept and validate optional `story.authorPenName`, pass to `createStory`. Affects the per-story validation block (lines ~85–111) and the `createStory(...)` call in the loop (~line 119).
- `components/import/NewStoryFromNovelAIDialog.tsx` — extend `StoryFormState` and `toForm`, fetch settings via SWR, render `<PenNamePicker>` inside `MetadataFields`, include `authorPenName` in commit payload. Export `toForm` so it can be unit-tested directly.
- `tests/api/import-novelai.commit.test.ts` — three new test cases (round-trip, default, validation).
- `tests/components/import/NewStoryFromNovelAIDialog.test.tsx` — one new end-to-end-ish test (settings → picker → commit payload includes pen name) plus a `toForm` init-rule test block.

**No changes:**
- `lib/storage/stories.ts` — `createStory` already supports `authorPenName`.
- `app/api/settings/route.ts` — already returns `penNameProfiles`.
- Any storage/disk shape — `Story.authorPenName` field already exists.
- Egress test, CSP, no-telemetry rule — covered already.

---

## Chunk 1: Backend, Component, Wire-up

### Task 1: Backend — accept `authorPenName` in commit payload

**Files:**
- Modify: `app/api/import/novelai/commit/route.ts:37-150`
- Test: `tests/api/import-novelai.commit.test.ts` (extend)

The commit route's `handleNewStory` currently calls `createStory(dataDir, { title: entry.story.title })` and then a follow-up `updateStory(...)` with description/keywords. We thread `authorPenName` into the `createStory` call so the field lands on first write — no second PATCH needed.

- [ ] **Step 1: Read the existing test to understand the harness**

Read [tests/api/import-novelai.commit.test.ts](../../../tests/api/import-novelai.commit.test.ts) lines 1–80. Note the `makeJsonReq` helper, the `EMPTY_BIBLE` fixture, and the `beforeEach`/`afterEach` that point `SCRIPTR_DATA_DIR` at a temp dir. Reuse all of these.

- [ ] **Step 2: Write three failing tests in `tests/api/import-novelai.commit.test.ts`**

Add to the existing `describe("POST /api/import/novelai/commit — new-story mode (single)", ...)` block (after the last `it(...)` in that block):

```ts
it("persists authorPenName when provided", async () => {
  const { POST } = await import("@/app/api/import/novelai/commit/route");
  const res = await POST(
    makeJsonReq("http://localhost/api/import/novelai/commit", {
      target: "new-story",
      stories: [
        {
          story: {
            title: "Pen Named Book",
            description: "",
            keywords: [],
            authorPenName: "Sarah Thorne",
          },
          bible: EMPTY_BIBLE,
          chapters: [{ title: "One", body: "body" }],
        },
      ],
    })
  );
  expect(res.status).toBe(200);
  const story = await getStory(tmp, "pen-named-book");
  expect(story?.authorPenName).toBe("Sarah Thorne");
});

it("defaults authorPenName to empty string when omitted (backwards-compat)", async () => {
  const { POST } = await import("@/app/api/import/novelai/commit/route");
  const res = await POST(
    makeJsonReq("http://localhost/api/import/novelai/commit", {
      target: "new-story",
      stories: [
        {
          story: { title: "No Pen Name", description: "", keywords: [] },
          bible: EMPTY_BIBLE,
          chapters: [{ title: "One", body: "body" }],
        },
      ],
    })
  );
  expect(res.status).toBe(200);
  const story = await getStory(tmp, "no-pen-name");
  expect(story?.authorPenName).toBe("");
});

it("rejects authorPenName when not a string", async () => {
  const { POST } = await import("@/app/api/import/novelai/commit/route");
  const res = await POST(
    makeJsonReq("http://localhost/api/import/novelai/commit", {
      target: "new-story",
      stories: [
        {
          story: {
            title: "Bad Pen Name",
            description: "",
            keywords: [],
            authorPenName: 42,
          },
          bible: EMPTY_BIBLE,
          chapters: [{ title: "One", body: "body" }],
        },
      ],
    })
  );
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.ok).toBe(false);
  expect(body.error).toMatch(/authorPenName must be a string/);
});
```

- [ ] **Step 3: Run tests — they should fail**

```bash
npx vitest run tests/api/import-novelai.commit.test.ts
```

Expected: the new "persists authorPenName" test fails (created story has `authorPenName: ""` instead of `"Sarah Thorne"`); the "defaults to empty string" test passes (already the current behavior); the "rejects when not a string" test fails (currently returns 200 — the field is silently ignored).

- [ ] **Step 4: Wire `authorPenName` through the route**

In `app/api/import/novelai/commit/route.ts`, edit `handleNewStory`:

1. Add a per-story validation check just after the existing `validateBible` check (around line 110), inside the `for (let i = 0; i < body.stories.length; i++)` loop:

```ts
if (
  s.story.authorPenName !== undefined &&
  typeof s.story.authorPenName !== "string"
) {
  return fail(
    body.stories.length === 1
      ? "authorPenName must be a string"
      : `authorPenName must be a string (story ${i + 1})`,
    400
  );
}
```

2. Pass `authorPenName` to `createStory` (line ~119). Change:

```ts
const story = await createStory(dataDir, { title: entry.story.title });
```

to:

```ts
const story = await createStory(dataDir, {
  title: entry.story.title,
  authorPenName: entry.story.authorPenName,
});
```

3. Update the `NewStoryEntry` type at the top of the file (line ~37) so TypeScript accepts the new field:

```ts
type NewStoryEntry = {
  story: {
    title: string;
    description: string;
    keywords: string[];
    authorPenName?: string;
  };
  bible: Bible;
  chapters: ProposedChapter[];
};
```

- [ ] **Step 5: Run tests — they should pass**

```bash
npx vitest run tests/api/import-novelai.commit.test.ts
```

Expected: all tests pass, including the three new ones.

- [ ] **Step 6: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add app/api/import/novelai/commit/route.ts tests/api/import-novelai.commit.test.ts
git commit -m "feat(import): accept authorPenName in NovelAI commit payload"
```

---

### Task 2: New `PenNamePicker` component

**Files:**
- Create: `components/import/PenNamePicker.tsx`
- Create: `tests/components/import/PenNamePicker.test.tsx`

A self-contained, presentational picker. The parent owns the settings fetch and passes `profiles` in. No SWR inside the component.

- [ ] **Step 1: Read the test harness model**

Read [tests/components/editor/AuthorNoteCard.test.tsx](../../../tests/components/editor/AuthorNoteCard.test.tsx) lines 1–60. Reuse the `mount` helper pattern verbatim — it's the project's standard React 19 jsdom render utility.

- [ ] **Step 2: Write the failing tests in `tests/components/import/PenNamePicker.test.tsx`**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { PenNamePicker } from "@/components/import/PenNamePicker";
import type { PenNameProfile } from "@/lib/config";

type Mounted = {
  container: HTMLDivElement;
  root: Root;
  unmount: () => void;
};

function mount(element: React.ReactElement): Mounted {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root!: Root;
  act(() => {
    root = createRoot(container);
    root.render(element);
  });
  const unmount = () => {
    act(() => {
      root.unmount();
    });
    container.remove();
  };
  return { container, root, unmount };
}

const profile = (over: Partial<PenNameProfile> = {}): PenNameProfile => ({
  email: "",
  mailingListUrl: "",
  defaultMessageHtml: "",
  ...over,
});

describe("PenNamePicker", () => {
  it("renders a plain input + helper link when no profiles exist", () => {
    const onChange = vi.fn();
    const { container, unmount } = mount(
      <PenNamePicker profiles={{}} value="" onChange={onChange} />,
    );

    const select = container.querySelector('[data-testid="pen-name-select"]');
    expect(select).toBeNull();

    const input = container.querySelector(
      '[data-testid="pen-name-input"]',
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(container.textContent).toContain("No saved profiles");

    unmount();
  });

  it("treats undefined profiles the same as empty", () => {
    const { container, unmount } = mount(
      <PenNamePicker profiles={undefined} value="" onChange={vi.fn()} />,
    );
    expect(
      container.querySelector('[data-testid="pen-name-input"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="pen-name-select"]'),
    ).toBeNull();
    unmount();
  });

  it("renders a <select> with one <option> per profile when profiles exist", () => {
    // Mount with a matching value so the placeholder isn't selected; avoids
    // React's "value not in options" warning cluttering test output.
    const { container, unmount } = mount(
      <PenNamePicker
        profiles={{ "Sarah Thorne": profile(), "Natalie Knot": profile() }}
        value="Sarah Thorne"
        onChange={vi.fn()}
      />,
    );
    const select = container.querySelector(
      '[data-testid="pen-name-select"]',
    ) as HTMLSelectElement | null;
    expect(select).not.toBeNull();

    const optionTexts = Array.from(select!.querySelectorAll("option")).map(
      (o) => o.textContent,
    );
    expect(optionTexts).toContain("Sarah Thorne");
    expect(optionTexts).toContain("Natalie Knot");
    expect(optionTexts).toContain("Custom…");
    expect(optionTexts).toContain("Choose pen name…");

    unmount();
  });

  it("emits onChange with the selected profile name", () => {
    const onChange = vi.fn();
    const { container, unmount } = mount(
      <PenNamePicker
        profiles={{ "Sarah Thorne": profile() }}
        value=""
        onChange={onChange}
      />,
    );
    const select = container.querySelector(
      '[data-testid="pen-name-select"]',
    ) as HTMLSelectElement;
    act(() => {
      select.value = "Sarah Thorne";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("Sarah Thorne");
    unmount();
  });

  it("switches to custom mode and clears value when 'Custom…' is picked", () => {
    const onChange = vi.fn();
    const { container, unmount } = mount(
      <PenNamePicker
        profiles={{ "Sarah Thorne": profile() }}
        value="Sarah Thorne"
        onChange={onChange}
      />,
    );
    const select = container.querySelector(
      '[data-testid="pen-name-select"]',
    ) as HTMLSelectElement;
    act(() => {
      select.value = "__custom__";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("");

    // The input appears because the picker's *own* mode state flipped to
    // "custom" — the parent in this test never re-renders with the new
    // value. The DOM input still shows the prop value ("Sarah Thorne") since
    // the parent hasn't propagated the cleared string yet; we don't assert
    // input.value because it depends on the parent's re-render behavior.
    const input = container.querySelector(
      '[data-testid="pen-name-input"]',
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();

    unmount();
  });

  it("emits onChange per keystroke in custom mode", () => {
    const onChange = vi.fn();
    const { container, unmount } = mount(
      <PenNamePicker
        profiles={{ "Sarah Thorne": profile() }}
        value="Made Up Name"
        onChange={onChange}
      />,
    );
    const input = container.querySelector(
      '[data-testid="pen-name-input"]',
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    act(() => {
      input.value = "Made Up Names";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("Made Up Names");
    unmount();
  });

  it("mounts in 'saved' mode when value matches a profile key", () => {
    const { container, unmount } = mount(
      <PenNamePicker
        profiles={{ "Sarah Thorne": profile() }}
        value="Sarah Thorne"
        onChange={vi.fn()}
      />,
    );
    const select = container.querySelector(
      '[data-testid="pen-name-select"]',
    ) as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    expect(select!.value).toBe("Sarah Thorne");
    unmount();
  });

  it("mounts in 'custom' mode when value is non-empty and matches no profile", () => {
    const { container, unmount } = mount(
      <PenNamePicker
        profiles={{ "Sarah Thorne": profile() }}
        value="Made Up Name"
        onChange={vi.fn()}
      />,
    );
    expect(
      container.querySelector('[data-testid="pen-name-input"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="pen-name-select"]'),
    ).toBeNull();
    unmount();
  });
});
```

- [ ] **Step 3: Run tests — they should fail with module-not-found**

```bash
npx vitest run tests/components/import/PenNamePicker.test.tsx
```

Expected: FAIL — "Cannot find module '@/components/import/PenNamePicker'".

- [ ] **Step 4: Implement `components/import/PenNamePicker.tsx`**

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import type { PenNameProfile } from "@/lib/config";

const CUSTOM_SENTINEL = "__custom__";
const PLACEHOLDER_SENTINEL = "";

interface PenNamePickerProps {
  /** Profile map from /api/settings; undefined while loading. */
  profiles: Record<string, PenNameProfile> | undefined;
  /** Current pen name on the parent's StoryFormState. */
  value: string;
  /** Emits the new pen name string. Empty string is allowed. */
  onChange: (next: string) => void;
}

function deriveInitialMode(
  profiles: Record<string, PenNameProfile> | undefined,
  value: string,
): "saved" | "custom" {
  if (!value) return "saved";
  if (profiles && Object.prototype.hasOwnProperty.call(profiles, value)) {
    return "saved";
  }
  return "custom";
}

export function PenNamePicker({
  profiles,
  value,
  onChange,
}: PenNamePickerProps) {
  const profileNames = profiles ? Object.keys(profiles).sort() : [];
  const hasProfiles = profileNames.length > 0;
  const [mode, setMode] = useState<"saved" | "custom">(() =>
    deriveInitialMode(profiles, value),
  );

  if (!hasProfiles) {
    return (
      <div className="flex flex-col gap-1">
        <Input
          aria-label="Author pen name"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          data-testid="pen-name-input"
        />
        <p className="text-xs text-muted-foreground">
          No saved profiles —{" "}
          <Link href="/settings" className="underline">
            set one up
          </Link>{" "}
          so the author note can be enabled for this story.
        </p>
      </div>
    );
  }

  if (mode === "custom") {
    return (
      <div className="flex flex-col gap-1">
        <Input
          aria-label="Author pen name"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          data-testid="pen-name-input"
        />
        <button
          type="button"
          className="text-xs underline text-muted-foreground self-start"
          onClick={() => {
            setMode("saved");
            onChange("");
          }}
        >
          Use saved profile
        </button>
      </div>
    );
  }

  const selectValue = profileNames.includes(value)
    ? value
    : PLACEHOLDER_SENTINEL;

  return (
    <select
      aria-label="Author pen name"
      data-testid="pen-name-select"
      value={selectValue}
      onChange={(e) => {
        const v = e.target.value;
        if (v === CUSTOM_SENTINEL) {
          setMode("custom");
          onChange("");
          return;
        }
        onChange(v);
      }}
      className="border border-input rounded px-2 py-1 text-sm bg-background"
    >
      <option value={PLACEHOLDER_SENTINEL} disabled>
        Choose pen name…
      </option>
      {profileNames.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
      <option value={CUSTOM_SENTINEL}>Custom…</option>
    </select>
  );
}
```

- [ ] **Step 5: Run tests — they should pass**

```bash
npx vitest run tests/components/import/PenNamePicker.test.tsx
```

Expected: all 8 tests pass.

- [ ] **Step 6: Run typecheck and lint**

```bash
npm run typecheck && npm run lint
```

Expected: no errors. (The custom no-telemetry rule does not affect this component.)

- [ ] **Step 7: Commit**

```bash
git add components/import/PenNamePicker.tsx tests/components/import/PenNamePicker.test.tsx
git commit -m "feat(import): add PenNamePicker component"
```

---

### Task 3: Wire picker into the dialog + commit payload

**Files:**
- Modify: `components/import/NewStoryFromNovelAIDialog.tsx`
- Modify: `tests/components/import/NewStoryFromNovelAIDialog.test.tsx`

Steps in order: extend `StoryFormState` and `toForm`, fetch settings, plumb the picker into `MetadataFields`, include `authorPenName` in the commit payload. Add tests for the `toForm` init rule and one end-to-end-ish dialog test that verifies the commit payload.

- [ ] **Step 1: Write the failing `toForm` init-rule tests**

In `tests/components/import/NewStoryFromNovelAIDialog.test.tsx`, add a new `describe` block at the bottom of the file. First, change the import line to also pull in `toForm`:

```ts
import { NewStoryFromNovelAIDialog, toForm } from "@/components/import/NewStoryFromNovelAIDialog";
```

Then append:

```ts
describe("toForm — pen-name init rule", () => {
  // Minimal StoryProposal shaped just enough for toForm.
  const proposal = (title = "T") => ({
    split: { chapters: [], splitSource: "marker" as const },
    proposed: {
      story: { title, description: "", keywords: [] },
      bible: {
        characters: [],
        setting: "",
        pov: "third-limited" as const,
        tone: "",
        styleNotes: "",
        nsfwPreferences: "",
      },
    },
  });

  const profile = () => ({
    email: "",
    mailingListUrl: "",
    defaultMessageHtml: "",
  });

  it("sets authorPenName to '' when profiles is undefined", () => {
    const f = toForm(proposal(), undefined);
    expect(f.authorPenName).toBe("");
  });

  it("sets authorPenName to '' when profiles is empty", () => {
    const f = toForm(proposal(), {});
    expect(f.authorPenName).toBe("");
  });

  it("sets authorPenName to the only key when exactly one profile exists", () => {
    const f = toForm(proposal(), { "Sarah Thorne": profile() });
    expect(f.authorPenName).toBe("Sarah Thorne");
  });

  it("sets authorPenName to '' when more than one profile exists", () => {
    const f = toForm(proposal(), {
      "Sarah Thorne": profile(),
      "Natalie Knot": profile(),
    });
    expect(f.authorPenName).toBe("");
  });
});
```

- [ ] **Step 2: Write the failing dialog-integration test**

Append to the same `describe("NewStoryFromNovelAIDialog", ...)` block (above the closing `});`):

```ts
it("commit payload includes authorPenName when picker has selection", async () => {
  let commitBody: unknown = null;
  const fetchMock = vi
    .fn()
    .mockImplementation(async (url: unknown, init?: { body?: string }) => {
      const u = String(url);
      if (u.endsWith("/api/settings")) {
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              penNameProfiles: {
                "Sarah Thorne": {
                  email: "",
                  mailingListUrl: "",
                  defaultMessageHtml: "",
                },
              },
            },
          }),
          { status: 200 }
        );
      }
      if (u.endsWith("/parse")) {
        return new Response(JSON.stringify(fakeSingleStoryResponse()), {
          status: 200,
        });
      }
      if (u.endsWith("/commit")) {
        commitBody = JSON.parse(init?.body ?? "{}");
        return new Response(
          JSON.stringify({
            ok: true,
            // Use the slug that matches whatever fakeSingleStoryResponse()
            // produces. Doesn't affect the assertions below — the test only
            // inspects commitBody — but keeps the mocked response coherent.
            data: { slugs: ["story-slug"], chapterIds: ["c1"] },
          }),
          { status: 200 }
        );
      }
      return new Response("", { status: 404 });
    });
  global.fetch = fetchMock as unknown as typeof fetch;

  const { container, unmount } = mount(
    <NewStoryFromNovelAIDialog open onOpenChange={() => {}} />
  );
  const fileInput = container.querySelector(
    'input[type="file"]'
  ) as HTMLInputElement;
  setFileOnInput(fileInput, new File([new Uint8Array([1])], "x.txt"));
  await flush();
  await flush();

  // With exactly one profile, picker auto-selects it. Commit straight away.
  const buttons = Array.from(container.querySelectorAll("button"));
  const createBtn = buttons.find((b) =>
    /^create story$/i.test(b.textContent ?? "")
  ) as HTMLButtonElement;
  act(() => {
    createBtn.click();
  });
  await flush();
  await flush();

  expect(commitBody).toBeTruthy();
  const payload = commitBody as {
    stories: Array<{ story: { authorPenName?: string } }>;
  };
  expect(payload.stories[0].story.authorPenName).toBe("Sarah Thorne");

  unmount();
});
```

If `fakeSingleStoryResponse` doesn't exist as a helper in that test file, define an inline equivalent — check the file for the exact helper name; otherwise reuse the response shape from the existing parse-and-render test (around line 167).

- [ ] **Step 3: Run the new tests — they should fail**

```bash
npx vitest run tests/components/import/NewStoryFromNovelAIDialog.test.tsx
```

Expected: the four `toForm` init tests fail with "toForm is not exported"; the commit-payload test fails because `authorPenName` is `undefined` in the payload.

- [ ] **Step 4: Modify `components/import/NewStoryFromNovelAIDialog.tsx`**

Apply the following edits in order:

**4a. Add SWR import + settings types at the top of the file** (after the existing imports):

```ts
import useSWR from "swr";
import type { PenNameProfile } from "@/lib/config";
import { PenNamePicker } from "@/components/import/PenNamePicker";

interface SettingsLite {
  penNameProfiles?: Record<string, PenNameProfile>;
}

const jsonFetcher = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url);
  const json = (await res.json()) as { ok: boolean; data?: T; error?: string };
  if (!json.ok) throw new Error(json.error ?? "request failed");
  return json.data as T;
};
```

(`SettingsLite` and `jsonFetcher` mirror the inlined copies in [components/editor/MetadataPane.tsx:27-36](../../../components/editor/MetadataPane.tsx#L27-L36). Do not hoist them — that's an out-of-scope refactor.)

**4b. Extend `StoryFormState` and export `toForm`:**

```ts
type StoryFormState = {
  title: string;
  description: string;
  keywords: string;
  authorPenName: string;
  chapters: ProposedChapter[];
  bible: Bible;
  splitSource: StoryProposal["split"]["splitSource"];
};

export function toForm(
  s: StoryProposal,
  profiles: Record<string, PenNameProfile> | undefined,
): StoryFormState {
  const profileKeys = profiles ? Object.keys(profiles) : [];
  const initialPenName = profileKeys.length === 1 ? profileKeys[0] : "";
  return {
    title: s.proposed.story.title,
    description: s.proposed.story.description,
    keywords: s.proposed.story.keywords.join(", "),
    chapters: s.split.chapters,
    bible: s.proposed.bible,
    splitSource: s.split.splitSource,
    authorPenName: initialPenName,
  };
}
```

**4c. Inside `NewStoryFromNovelAIDialog`, add the SWR settings fetch:**

Just below `const router = useRouter();`:

```ts
const { data: settings } = useSWR<SettingsLite>(
  "/api/settings",
  jsonFetcher,
  { revalidateOnFocus: false },
);
const profiles = settings?.penNameProfiles;
```

**4d. Update the `onFile` callback's success branch** to pass `profiles` into `toForm`:

```ts
setStories(body.data.stories.map((p) => toForm(p, profiles)));
```

**4d.1 — IMPORTANT: add `profiles` to the `onFile` `useCallback` deps array.**

The existing `onFile` is wrapped in `useCallback(..., [])`, which closes over `profiles` from the **first** render — likely `undefined` before SWR resolves. If the deps array stays empty, `toForm` will always see `undefined` and the auto-select-when-one-profile rule won't fire. Change the closing bracket:

```ts
const onFile = useCallback(async (f: File) => {
  // …existing body, now using `profiles`…
}, [profiles]);
```

This is the documented init-rule tradeoff in action: if the user opens the dialog *and* picks a file before `/api/settings` resolves, `profiles` will still be `undefined` when `toForm` runs and they'll have to pick manually. That's accepted (sub-100 ms race for a local read). Adding `profiles` to the deps array just ensures the *post-resolve* path works — it doesn't try to retroactively fix already-loaded forms.

**4e. Update the commit payload** in `onCommit`:

```ts
stories: stories.map((s) => ({
  story: {
    title: s.title.trim() || "Untitled",
    description: s.description,
    keywords: s.keywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean),
    authorPenName: s.authorPenName,
  },
  bible: s.bible,
  chapters: s.chapters,
})),
```

**4f. Render the picker in `MetadataFields`:**

Pass `profiles` as a prop to `MetadataFields` (call site: `<MetadataFields story={story} onChange={onChange} profiles={profiles} />` in both `StoryCard` and `StoryCardBody`; both also need to accept and forward it).

Inside `MetadataFields`, just below the Title block, add:

```tsx
<div>
  <div className="text-xs uppercase text-muted-foreground mb-1">
    Author pen name
  </div>
  <PenNamePicker
    profiles={profiles}
    value={story.authorPenName}
    onChange={(next) => onChange({ authorPenName: next })}
  />
</div>
```

Update the props on `StoryCard`, `StoryCardBody`, and `MetadataFields` to include:

```ts
profiles: Record<string, PenNameProfile> | undefined;
```

- [ ] **Step 5: Run tests — they should pass**

```bash
npx vitest run tests/components/import/NewStoryFromNovelAIDialog.test.tsx tests/components/import/PenNamePicker.test.tsx tests/api/import-novelai.commit.test.ts
```

Expected: all tests pass, including the four new `toForm` tests, the commit-payload test, and the existing API tests (cheap insurance that no shared types regressed).

- [ ] **Step 6: Run the full suite to confirm no regressions**

```bash
npm test
```

Expected: every test passes, including the previously-passing `NewStoryFromNovelAIDialog` tests (they don't mock `/api/settings`, so SWR's fetch will fall through to the test's 404 fallback → `settings` stays `undefined` → `profiles` is `undefined` → picker renders the no-profiles input → those tests' assertions on title/keywords/commit are unaffected).

- [ ] **Step 7: Run typecheck and lint**

```bash
npm run typecheck && npm run lint
```

Expected: no errors.

- [ ] **Step 8: Manual smoke (optional but recommended for UI work)**

Per [CLAUDE.md](../../../CLAUDE.md): "For UI or frontend changes, start the dev server and use the feature in a browser before reporting the task as complete."

```bash
npm run dev
```

Open `http://127.0.0.1:3000`. From the library page, trigger NovelAI import. With the user's current `data/config.json` (no profiles), the picker should be a plain input + "No saved profiles — set one up" hint. Then visit `/settings`, add a `Sarah Thorne` profile, return to import — the picker should now be a `<select>` with `Sarah Thorne` auto-selected. Pick "Custom…" → input swaps in. Pick a saved profile → input swaps out.

Stop the dev server when done.

- [ ] **Step 9: Commit**

```bash
git add components/import/NewStoryFromNovelAIDialog.tsx tests/components/import/NewStoryFromNovelAIDialog.test.tsx
git commit -m "feat(import): wire pen-name picker into NovelAI new-story dialog"
```

---

## Verification checklist

Before declaring the work done, confirm:

- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `npm run lint` passes.
- [ ] Manually verified in browser per Task 3 Step 8 (if UI changes are observable in your data/ setup).
- [ ] Three commits on the branch: backend, picker, dialog wire-up.
- [ ] No changes outside the files listed in the File Structure section above.

## Out-of-plan reminders

- **Do not** add a useEffect to `NewStoryFromNovelAIDialog` that retro-fills `authorPenName` after `toForm` ran with `profiles === undefined`. The spec calls this out as a documented tradeoff — see the spec's "Defaulting & init rules" section.
- **Do not** hoist `SettingsLite` and `jsonFetcher` from `MetadataPane.tsx` into a shared module. That's a separate cleanup; this plan duplicates them.
- **Do not** modify `AddChaptersFromNovelAIDialog.tsx`. It's an existing-story import; pen name is already set on the story.
