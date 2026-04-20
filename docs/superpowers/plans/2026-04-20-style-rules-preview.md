# Style Rules Preview Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live read-only preview block inside the Settings → Writing Style Defaults section that renders the exact output of `formatStyleRules(form.style)` as the user toggles switches, so they can see the "starter prompt" their settings produce.

**Architecture:** Introduce a single presentational component `StyleRulesPreview({ rules })` that calls the existing `formatStyleRules` and renders the result in a `<pre>` with a copy button. Mount it inside [components/settings/SettingsForm.tsx](../../../components/settings/SettingsForm.tsx) between the "Additional rules" textarea and the "Reset to built-in defaults" button. No backend, API, data-model, or persistence changes.

**Tech Stack:** Next.js 15 (App Router), TypeScript, React 19, vitest + jsdom, shadcn/ui, Tailwind, `sonner` for toasts, `lucide-react` for icons.

**Reference spec:** [docs/superpowers/specs/2026-04-20-style-rules-preview-design.md](../specs/2026-04-20-style-rules-preview-design.md).

**Quality gates (run after every task):**
- `npm run typecheck` — 0 errors.
- `npm run lint` — 0 errors.
- `npm test` — all green.

At the end of every task: commit. Small commits, frequent commits.

---

## File Structure

- **New:** `components/settings/StyleRulesPreview.tsx` — presentational-only; props-in, JSX-out. Owns all preview-specific layout, copy logic, and empty-state handling.
- **New:** `tests/components/settings/StyleRulesPreview.test.tsx` — unit tests using the project's manual React-19 render harness (no `@testing-library/react` by project rule; see `tests/components/editor/SectionCard.test.tsx` for the pattern).
- **Modified:** `components/settings/SettingsForm.tsx` — a single import + one JSX insertion. No refactor of surrounding code.

Pulling the component into its own file (rather than co-locating it inside `SettingsForm.tsx` as the spec leaves open) is the right call because:
1. The file is already ~470 lines and growing; dropping another 40+ lines + a copy handler bloats it.
2. A separate file makes it trivial to reuse from the Bible editor later (called out as a follow-up in the spec).
3. Test file target path mirrors the component's own path.

---

## Chunk 1: Component + wire-up

Tests first, build the component, wire it into the form, verify by hand. Everything lives together because the component is trivial without its mount point.

### Task 1.1: Scaffold the failing empty-state test

**Files:**
- Create: `tests/components/settings/StyleRulesPreview.test.tsx`

- [ ] **Step 1: Create the test file with the empty-state test**

The preview's empty state fires when `formatStyleRules(rules)` returns `""`. Reaching that return value with a `Required<StyleRules>` is awkward (both `DEFAULT_STYLE.tense = "past"` and `DEFAULT_STYLE.explicitness = "explicit"` emit lines, so you'd need out-of-enum values that also trip `logger.warn`). Per the spec, mock `formatStyleRules` to return `""` and assert the component's UI contract: the placeholder text appears and the copy button is absent.

Create `tests/components/settings/StyleRulesPreview.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

vi.mock("@/lib/style", async () => {
  const actual = await vi.importActual<typeof import("@/lib/style")>("@/lib/style");
  return {
    ...actual,
    formatStyleRules: vi.fn(),
  };
});

import { formatStyleRules, DEFAULT_STYLE } from "@/lib/style";
import { StyleRulesPreview } from "@/components/settings/StyleRulesPreview";

type Mounted = { container: HTMLDivElement; root: Root; unmount: () => void };
function mount(element: React.ReactElement): Mounted {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root!: Root;
  act(() => {
    root = createRoot(container);
    root.render(element);
  });
  const unmount = () => {
    act(() => { root.unmount(); });
    container.remove();
  };
  return { container, root, unmount };
}

const mockFormat = vi.mocked(formatStyleRules);

describe("StyleRulesPreview — empty state", () => {
  beforeEach(() => {
    mockFormat.mockReset();
  });

  it("renders the placeholder and hides the copy button when formatStyleRules returns \"\"", () => {
    mockFormat.mockReturnValue("");
    const { container, unmount } = mount(
      <StyleRulesPreview rules={DEFAULT_STYLE} />,
    );
    try {
      expect(container.textContent).toContain("No style rules");
      expect(container.querySelector('[aria-label="Copy style rules"]')).toBeNull();
    } finally {
      unmount();
    }
  });
});
```

Each test owns its mount/unmount pair via `try/finally`, so no global DOM cleanup hook is needed — the `unmount()` inside `finally` removes the container from `document.body` deterministically.

- [ ] **Step 2: Run test to verify it fails for the right reason**

Run: `npm test -- tests/components/settings/StyleRulesPreview.test.tsx`
Expected: FAIL with `Cannot find module '@/components/settings/StyleRulesPreview'` (or similar resolution error). The component does not exist yet.

- [ ] **Step 3: Commit the failing test**

```bash
git add tests/components/settings/StyleRulesPreview.test.tsx
git commit -m "test(settings): failing test for StyleRulesPreview empty state"
```

---

### Task 1.2: Create the component (minimal empty-state support)

**Files:**
- Create: `components/settings/StyleRulesPreview.tsx`

- [ ] **Step 1: Write the minimal component**

Create `components/settings/StyleRulesPreview.tsx`:

```tsx
"use client";

import { formatStyleRules, type StyleRules } from "@/lib/style";

export function StyleRulesPreview(props: { rules: Required<StyleRules> }) {
  const text = formatStyleRules(props.rules);

  if (text === "") {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">Preview</p>
        <p className="text-xs text-muted-foreground">
          This is the style block injected into every generation prompt.
        </p>
        <div className="rounded-md border bg-muted/40 p-3">
          <p className="text-xs italic text-muted-foreground">
            No style rules — model will use its defaults.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-medium">Preview</p>
      <p className="text-xs text-muted-foreground">
        This is the style block injected into every generation prompt.
      </p>
      <pre className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 font-mono text-xs">
        {text}
      </pre>
    </div>
  );
}
```

The copy button is deliberately omitted in this step — it arrives with the next test. Keeping the component minimal makes each test drive exactly one change.

- [ ] **Step 2: Run the empty-state test to confirm it passes**

Run: `npm test -- tests/components/settings/StyleRulesPreview.test.tsx`
Expected: the empty-state test passes.

- [ ] **Step 3: Run quality gates**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add components/settings/StyleRulesPreview.tsx
git commit -m "feat(settings): StyleRulesPreview empty-state scaffold"
```

---

### Task 1.3: Failing test for rendering populated rules

**Files:**
- Modify: `tests/components/settings/StyleRulesPreview.test.tsx`

- [ ] **Step 1: Append a populated-render test to the file**

Add this `describe` block **after** the existing `describe("StyleRulesPreview — empty state", ...)` block in the same test file:

```tsx
describe("StyleRulesPreview — populated", () => {
  beforeEach(() => {
    mockFormat.mockReset();
  });

  it("renders the exact formatStyleRules output inside the <pre>", () => {
    const sample = "# Style rules\n1. Use contractions.\n2. Do not use em-dashes.";
    mockFormat.mockReturnValue(sample);

    const { container, unmount } = mount(
      <StyleRulesPreview rules={DEFAULT_STYLE} />,
    );
    try {
      const pre = container.querySelector("pre");
      expect(pre).not.toBeNull();
      expect(pre?.textContent).toBe(sample);
      expect(mockFormat).toHaveBeenCalledWith(DEFAULT_STYLE);
    } finally {
      unmount();
    }
  });
});
```

- [ ] **Step 2: Run the tests to confirm the populated test passes (empty-state still green)**

Run: `npm test -- tests/components/settings/StyleRulesPreview.test.tsx`
Expected: both tests pass. (The implementation from Task 1.2 already handles the non-empty branch — this test locks the contract in.)

- [ ] **Step 3: Commit**

```bash
git add tests/components/settings/StyleRulesPreview.test.tsx
git commit -m "test(settings): StyleRulesPreview renders formatStyleRules output"
```

---

### Task 1.4: Failing test for the copy button

**Files:**
- Modify: `tests/components/settings/StyleRulesPreview.test.tsx`

- [ ] **Step 1: Append a copy-button test**

Add this `describe` block to the test file (after the "populated" block):

```tsx
describe("StyleRulesPreview — copy button", () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");

  beforeEach(() => {
    mockFormat.mockReset();
  });

  afterEach(() => {
    // Restore the original clipboard descriptor (or remove our mock if there was none) so
    // subsequent test files don't inherit our fake.
    if (originalClipboard) {
      Object.defineProperty(navigator, "clipboard", originalClipboard);
    } else {
      delete (navigator as unknown as { clipboard?: unknown }).clipboard;
    }
  });

  it("writes the rendered text to the clipboard on click", async () => {
    const sample = "# Style rules\n1. Use contractions.";
    mockFormat.mockReturnValue(sample);

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const { container, unmount } = mount(
      <StyleRulesPreview rules={DEFAULT_STYLE} />,
    );
    try {
      const btn = container.querySelector<HTMLButtonElement>(
        '[aria-label="Copy style rules"]',
      );
      expect(btn).not.toBeNull();
      await act(async () => {
        btn!.click();
      });
      expect(writeText).toHaveBeenCalledWith(sample);
    } finally {
      unmount();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify the new test fails**

Run: `npm test -- tests/components/settings/StyleRulesPreview.test.tsx`
Expected: the copy-button test fails with "expected null not to be null" (no button with that aria-label exists yet).

- [ ] **Step 3: Commit the failing test**

```bash
git add tests/components/settings/StyleRulesPreview.test.tsx
git commit -m "test(settings): failing test for StyleRulesPreview copy button"
```

---

### Task 1.5: Implement the copy button

**Files:**
- Modify: `components/settings/StyleRulesPreview.tsx`

- [ ] **Step 1: Add the copy button to the populated branch**

Replace the entire contents of `components/settings/StyleRulesPreview.tsx` with:

```tsx
"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";

import { formatStyleRules, type StyleRules } from "@/lib/style";

export function StyleRulesPreview(props: { rules: Required<StyleRules> }) {
  const text = formatStyleRules(props.rules);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Copy failed");
    }
  }

  if (text === "") {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">Preview</p>
        <p className="text-xs text-muted-foreground">
          This is the style block injected into every generation prompt.
        </p>
        <div className="rounded-md border bg-muted/40 p-3">
          <p className="text-xs italic text-muted-foreground">
            No style rules — model will use its defaults.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-medium">Preview</p>
      <p className="text-xs text-muted-foreground">
        This is the style block injected into every generation prompt.
      </p>
      <div className="relative">
        <pre className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 pr-10 font-mono text-xs">
          {text}
        </pre>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy style rules"
          className="absolute right-2 top-2 flex items-center rounded-sm p-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          <Copy className="size-4" />
        </button>
      </div>
    </div>
  );
}
```

Notes on the diff:
- `pr-10` on the `<pre>` leaves room so long lines don't run under the button.
- The `aria-label="Copy style rules"` string is the locator used by both the test and keyboard users; match the existing eye/eye-off pattern in [SettingsForm.tsx:195](../../../components/settings/SettingsForm.tsx#L195).
- `toast` is imported from `sonner` — already used elsewhere in the settings form ([SettingsForm.tsx:6](../../../components/settings/SettingsForm.tsx#L6)), so no new dependency.

- [ ] **Step 2: Run all StyleRulesPreview tests — all pass**

Run: `npm test -- tests/components/settings/StyleRulesPreview.test.tsx`
Expected: all three tests pass (empty state, populated, copy button).

- [ ] **Step 3: Run quality gates**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add components/settings/StyleRulesPreview.tsx
git commit -m "feat(settings): add copy button to StyleRulesPreview"
```

---

### Task 1.6: Wire the preview into `SettingsForm`

**Files:**
- Modify: `components/settings/SettingsForm.tsx`

- [ ] **Step 1: Add the import**

At the top of `components/settings/SettingsForm.tsx`, add the new import alongside the existing `@/components/...` imports:

```tsx
import { StyleRulesPreview } from "@/components/settings/StyleRulesPreview";
```

- [ ] **Step 2: Mount the component between the "Additional rules" textarea and the "Reset" button**

Find the block in [components/settings/SettingsForm.tsx:392-413](../../../components/settings/SettingsForm.tsx#L392-L413) that renders the "Additional rules" textarea and the "Reset to built-in defaults" button. Insert `<StyleRulesPreview rules={form.style} />` between them. Expected shape:

```tsx
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="custom-rules">Additional rules</Label>
          <textarea
            id="custom-rules"
            /* ...unchanged... */
          />
          <p className="text-xs text-muted-foreground">
            Free-text rules appended verbatim. Different from Bible → Style Notes, which describes the story&apos;s voice.
          </p>
        </div>

        <StyleRulesPreview rules={form.style} />

        <Button
          type="button"
          variant="ghost"
          className="self-start"
          onClick={() => patch({ style: { ...DEFAULT_STYLE } })}
        >
          Reset to built-in defaults
        </Button>
```

Nothing else in the file changes.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including any that touch `SettingsForm` rendering. No test should newly fail — the wire-up is additive.

- [ ] **Step 4: Run quality gates**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 5: Manual UI smoke test**

Per [AGENTS.md](../../../AGENTS.md), UI changes must be exercised in a browser before declaring completion.

1. Start the dev server: `npm run dev` (in a second terminal).
2. Open `http://localhost:3000/settings`.
3. Scroll to **Writing Style Defaults**. Verify the Preview block renders between "Additional rules" and "Reset to built-in defaults".
4. Flip toggles (e.g., turn off "Use contractions", toggle "Avoid em-dashes") — the preview text updates on every click with no visible lag.
5. Change **Tense** and **Explicitness** — the numbered lines update to match.
6. Type in **Additional rules** — the appended "Additional rules:" section updates live.
7. Click **Reset to built-in defaults** — the preview returns to the default output.
8. Turn off every Boolean toggle, change **Tense** and **Explicitness** to combinations that keep emitting lines — confirm preview stays non-empty (this exercises the populated branch in-browser, since reaching the true empty state requires out-of-enum values).
9. Click the **copy button**. Paste into a scratch buffer (e.g., a terminal) — content matches the `<pre>` text. Confirm the "Copied" toast appears.

If any step fails, stop and report; do not mark complete.

- [ ] **Step 6: Commit**

```bash
git add components/settings/SettingsForm.tsx
git commit -m "feat(settings): embed StyleRulesPreview in settings form"
```

---

## Done

After Task 1.6:

- [ ] All three StyleRulesPreview tests pass (`npm test -- tests/components/settings/StyleRulesPreview.test.tsx`).
- [ ] Full `npm test` is green.
- [ ] `npm run typecheck` and `npm run lint` are clean.
- [ ] Manual UI smoke from Task 1.6 Step 5 completed successfully.
- [ ] Branch is ready to merge / PR.

No follow-up work on this plan. Bible-editor preview reuse is a separate, optional follow-up called out in the spec's "Out of scope" section.
