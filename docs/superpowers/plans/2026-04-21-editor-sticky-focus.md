# Section Editor Sticky Focus Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the chapter-prose section editor preserve cursor position when the user clicks off (metadata pane, kebab menu, elsewhere), and place the cursor at the clicked character position on initial entry — so editing feels like a normal text editor instead of a click-out-and-lose-everything mode toggle.

**Architecture:** Pure client-side refactor of three files in `components/editor/`. Lift edit-state ownership (`editingSectionId`, `pendingCaret`) from `SectionCard` up to `SectionList` so exactly one section is editable at a time and outside-clicks don't lose it. Change `SectionEditor` to consume a mount-captured `caret` prop via `posAtCoords` (drop `autofocus: "end"`), remove the `onBlur: handleExit` path, and call the already-exported `useAutoSave.flush()` on blur as a safety net. Swap `onClick` for `onMouseDown` on the read-only `<p>` so coord capture happens before the browser resolves the click's default focus.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tiptap 3 (`@tiptap/react` + `@tiptap/starter-kit`), Zustand, SWR, vitest 4 (jsdom per-file), Playwright.

**Reference spec:** [docs/superpowers/specs/2026-04-21-section-editor-sticky-focus-design.md](../specs/2026-04-21-section-editor-sticky-focus-design.md).

**Base branch / worktree:** Fresh feature branch `feature/editor-sticky-focus` at `/home/chase/projects/scriptr/.worktrees/editor-sticky-focus`. See "Setup" below. If a different worktree is preferred (or main is used directly), adjust paths in every command accordingly.

**Quality gates (run after every task):**
- `npm run typecheck` — 0 errors.
- `npm run lint` — 0 errors (the privacy `scriptr/no-telemetry` rule must stay green).
- `npm test` — all green (including `tests/privacy/no-external-egress.test.ts`, which is **not** modified by this plan).

After the E2E task only: `npm run e2e` must also pass.

**Commit hygiene:** Small, frequent commits with specific `git add <file>` (never `git add -A`, to avoid dragging in unrelated edits). Every commit message ends with the trailer:

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

**Privacy pillar:** Zero new routes, zero new egress, zero telemetry. `tests/privacy/no-external-egress.test.ts` must continue passing **without modification**. If that test ever needs changes for this feature, something has gone wrong — stop and re-read the spec.

**Next.js 16 reminder (from AGENTS.md):** This is not the Next.js you know from training data. None of the tasks in this plan touch App Router internals, route handlers, or the Next config — they are pure client-component edits — so the risk is low, but if you find yourself reaching for server/client boundary APIs, stop and read `node_modules/next/dist/docs/` first.

---

## Setup

- [ ] **Step 1: Create the worktree**

Run from `/home/chase/projects/scriptr`:

```bash
git fetch origin
git worktree add -b feature/editor-sticky-focus .worktrees/editor-sticky-focus origin/main
```

- [ ] **Step 2: Install deps inside the worktree**

```bash
cd /home/chase/projects/scriptr/.worktrees/editor-sticky-focus
npm install
```

Expected: deps resolve cleanly, no audit failures that weren't already on main. If `npm install` reports new issues that differ from main, stop and investigate before proceeding.

- [ ] **Step 3: Baseline**

```bash
cd /home/chase/projects/scriptr/.worktrees/editor-sticky-focus
npm run typecheck
npm run lint
npm test
```

All three must pass. If any is failing on the unchanged checkout, fix / investigate before starting implementation — we need a green baseline to distinguish regressions we cause.

---

## File structure

**New files:**

| Path | Responsibility |
|------|----------------|
| `tests/components/editor/SectionList.sticky-focus.test.tsx` | Unit tests for `SectionList`'s new edit-state ownership (selection, swap, Esc, `disableActions` auto-exit). |
| `tests/components/editor/SectionEditor.test.tsx` | Unit tests for `SectionEditor`'s new `caret` prop, `posAtCoords` mount behavior, blur semantics, flush call. (File may already exist — check first; if so this is a MOD.) |
| `tests/e2e/editor-sticky-focus.spec.ts` | Playwright spec: type in section, blur to metadata pane, assert editor stays mounted; click another section; assert swap + unmount. |

**Modified files:**

| Path | What changes |
|------|--------------|
| `components/editor/SectionEditor.tsx` | Drop `autofocus: "end"`. Drop `onBlur: handleExit`. Add `caret` prop, mount-captured via `useRef`, resolved via `editor.view.posAtCoords` to call `setTextSelection(pos).focus()`. Wire `editorProps.handleDOMEvents.blur` to `useAutoSave`'s exported `flush`. |
| `components/editor/SectionCard.tsx` | Remove local `editRequested` + `handleEditorExit`. Add props `isEditing: boolean`, `caret: { x, y } \| null`, `onRequestEdit(sectionId, caret \| null): void`, `onExit(): void`. Replace `onClick` on the read-only `<p>` with `onMouseDown` that captures `clientX/clientY` and calls `onRequestEdit(section.id, { x, y })`. Keep `onKeyDown` (Enter/Space) to call `onRequestEdit(section.id, null)`. |
| `components/editor/SectionList.tsx` | Add `useState<string \| null>` for `editingSectionId` and `useState<{ x: number; y: number } \| null>` for `pendingCaret`. Add `useEffect` that clears both when `disableActions` flips true. Plumb `isEditing`, `caret`, `onRequestEdit`, `onExit` into each `SectionCard`. |
| `tests/components/editor/SectionCard.test.tsx` | Update existing "click-to-edit" tests to the new prop contract (`isEditing`, `onRequestEdit`). Add coverage for `onMouseDown` capturing coords, keyboard path passing `null` coords, no `SectionEditor` rendered when `isEditing === false`. |

**Files NOT modified:**

- `hooks/useAutoSave.ts` — the `flush()` export at [hooks/useAutoSave.ts:133-141](../../hooks/useAutoSave.ts#L133-L141) already has the exact semantics the spec relies on (cancels pending debounce, no-op on first render or when disabled, awaits wrapped save). The existing test at `tests/hooks/useAutoSave.test.ts:225-237` already covers flush's happy path. Don't touch either.
- `components/editor/EditorPane.tsx` — parent of `SectionList`, already threads `disableActions` via the generation store. No changes needed; the new `useEffect` in `SectionList` consumes the existing signal.
- `tests/privacy/no-external-egress.test.ts` — no new routes, no changes.
- All other files in `components/editor/` (`BibleField.tsx`, `ChapterHeader.tsx`, etc.) — scope is prose sections only.

---

## Chunk 1: Component refactor (4 tasks)

Tasks 1-3 land the component API changes in dependency order (bottom-up: `SectionEditor` → `SectionCard` → `SectionList`). To keep typecheck green **after every commit**, the new `caret` prop is declared **optional with a null default** on both `SectionEditor` and `SectionCard`; only `SectionList` always passes it explicitly. That way Task 1 alone compiles (existing `SectionCard` callers don't need to know about the new prop yet), Task 2 alone compiles (existing `SectionList` doesn't need to pass it yet), and Task 3 wires the real value through. Task 4 is E2E.

### Task 1: `SectionEditor` — caret prop, no blur-exit, blur flush

**Files:**
- Modify: `components/editor/SectionEditor.tsx`
- Create or modify: `tests/components/editor/SectionEditor.test.tsx`

- [ ] **Step 1: Check whether the test file exists**

```bash
cd /home/chase/projects/scriptr/.worktrees/editor-sticky-focus
ls tests/components/editor/SectionEditor.test.tsx 2>/dev/null || echo "NOT FOUND"
```

If NOT FOUND, create a new file in Step 2 with the full header + helper block (see `tests/components/editor/SectionCard.test.tsx` for the canonical React-19 manual-render harness). If found, append to it.

- [ ] **Step 2: Write failing tests for the new SectionEditor API**

The spec requires four behaviors we'll verify:

1. With `caret={{x,y}}`, `editor.view.posAtCoords` is called once on mount; when it returns `{ pos: N }`, `setTextSelection(N)` and `focus()` are called.
2. With `caret={null}`, `focus("end")` is called instead.
3. Blur does NOT call `onExit` (regression guard — this is the whole point of the feature).
4. Blur DOES call the `useAutoSave` flush (the belt-and-suspenders persistence guarantee).

Create `tests/components/editor/SectionEditor.test.tsx` (or append to it) with:

```tsx
// @vitest-environment jsdom
/**
 * Tests for SectionEditor — new sticky-focus behavior: caret prop resolved via
 * posAtCoords on mount, no blur-exit, blur triggers useAutoSave flush.
 *
 * Uses the project's manual React-19 render harness (no @testing-library/react
 * by project rule — see tests/components/editor/SectionCard.test.tsx).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

// Mock the autosave hook before importing SectionEditor so the editor sees our
// mock. We expose a spy `flushSpy` that the tests inspect.
const flushSpy = vi.fn(async () => {});
vi.mock("@/hooks/useAutoSave", () => ({
  useAutoSave: () => ({ status: "idle" as const, flush: flushSpy }),
}));

// Mock @tiptap/react so we can intercept `useEditor` and drive it from the
// test. The real Tiptap requires a live DOM/ProseMirror view which is heavy
// for a unit test; we only care that SectionEditor wires up the right calls.
const setTextSelectionSpy = vi.fn(() => ({ focus: vi.fn() }));
const commandsFocusSpy = vi.fn();
const posAtCoordsStub = vi.fn(
  (_: { left: number; top: number }) => ({ pos: 42, inside: -1 } as const),
);

vi.mock("@tiptap/react", () => {
  const useEditor = (opts: Record<string, unknown>) => {
    // Return a fake editor object exposing just what SectionEditor touches.
    return {
      view: {
        posAtCoords: posAtCoordsStub,
      },
      commands: {
        setTextSelection: setTextSelectionSpy,
        focus: commandsFocusSpy,
      },
      // Tests don't assert on options, but capture them if needed later.
      __opts: opts,
    };
  };
  const EditorContent = () => <div data-testid="proseMirror" />;
  return { useEditor, EditorContent };
});

import { SectionEditor } from "@/components/editor/SectionEditor";

type Mounted = {
  container: HTMLDivElement;
  root: Root;
  unmount: () => void;
  rerender: (el: React.ReactElement) => void;
};
function mount(el: React.ReactElement): Mounted {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root!: Root;
  act(() => {
    root = createRoot(container);
    root.render(el);
  });
  return {
    container,
    root,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
    rerender: (next) => {
      act(() => root.render(next));
    },
  };
}

beforeEach(() => {
  flushSpy.mockClear();
  setTextSelectionSpy.mockClear();
  commandsFocusSpy.mockClear();
  posAtCoordsStub.mockClear();
  posAtCoordsStub.mockReturnValue({ pos: 42, inside: -1 });
});

describe("SectionEditor sticky-focus behavior", () => {
  it("places the cursor at posAtCoords resolution when caret is provided", () => {
    const { unmount } = mount(
      <SectionEditor
        sectionId="sec-1"
        initialContent="hello world"
        caret={{ x: 10, y: 20 }}
        onSave={vi.fn()}
        onExit={vi.fn()}
      />,
    );

    expect(posAtCoordsStub).toHaveBeenCalledTimes(1);
    expect(posAtCoordsStub).toHaveBeenCalledWith({ left: 10, top: 20 });
    expect(setTextSelectionSpy).toHaveBeenCalledWith(42);
    expect(commandsFocusSpy).not.toHaveBeenCalled();

    unmount();
  });

  it("falls back to focus('end') when caret is null", () => {
    const { unmount } = mount(
      <SectionEditor
        sectionId="sec-1"
        initialContent="hello world"
        caret={null}
        onSave={vi.fn()}
        onExit={vi.fn()}
      />,
    );

    expect(posAtCoordsStub).not.toHaveBeenCalled();
    expect(setTextSelectionSpy).not.toHaveBeenCalled();
    expect(commandsFocusSpy).toHaveBeenCalledWith("end");

    unmount();
  });

  it("falls back to focus('end') when posAtCoords returns null", () => {
    posAtCoordsStub.mockReturnValueOnce(null as unknown as { pos: number; inside: number });

    const { unmount } = mount(
      <SectionEditor
        sectionId="sec-1"
        initialContent="hello world"
        caret={{ x: 999, y: 999 }}
        onSave={vi.fn()}
        onExit={vi.fn()}
      />,
    );

    expect(posAtCoordsStub).toHaveBeenCalledTimes(1);
    expect(setTextSelectionSpy).not.toHaveBeenCalled();
    expect(commandsFocusSpy).toHaveBeenCalledWith("end");

    unmount();
  });

  it("does not re-resolve caret when the caret prop identity changes mid-mount", () => {
    // Simulates a parent re-render that hands a new caret object down without
    // unmounting. The mount-captured ref must ignore the new prop.
    const { rerender, unmount } = mount(
      <SectionEditor
        sectionId="sec-1"
        initialContent="hello"
        caret={{ x: 10, y: 20 }}
        onSave={vi.fn()}
        onExit={vi.fn()}
      />,
    );
    expect(posAtCoordsStub).toHaveBeenCalledTimes(1);
    posAtCoordsStub.mockClear();

    // Re-render the SAME root with a different caret object. The mount-only
    // useEffect has already run; since the dep array is [editor] and editor
    // identity is stable, the effect must NOT re-fire.
    rerender(
      <SectionEditor
        sectionId="sec-1"
        initialContent="hello"
        caret={{ x: 500, y: 500 }}
        onSave={vi.fn()}
        onExit={vi.fn()}
      />,
    );
    expect(posAtCoordsStub).not.toHaveBeenCalled();

    unmount();
  });
});
```

The `mount` helper above must expose a `rerender` — add it the same way `SectionCard.test.tsx:37-41` does:

```ts
const rerender = (el: React.ReactElement) => {
  act(() => { root.render(el); });
};
return { container, root, unmount, rerender };
```

- [ ] **Step 3: Run tests — expect failure**

```bash
cd /home/chase/projects/scriptr/.worktrees/editor-sticky-focus
npx vitest run tests/components/editor/SectionEditor.test.tsx
```

Expected: fail. The current `SectionEditor` does not accept a `caret` prop; it uses `autofocus: "end"` and has no `posAtCoords` call. TypeScript should also complain about the `caret` prop.

- [ ] **Step 4: Update the `SectionEditor` implementation**

Edit `components/editor/SectionEditor.tsx`:

1. **Update props interface.** Add `caret` as optional with null default — keeps existing `SectionCard` callers type-safe until Task 2 starts passing it:

```ts
interface SectionEditorProps {
  sectionId: string;
  initialContent: string;
  /**
   * Viewport coordinates of the user's click on the read-only <p>, passed
   * from the parent on the read-only → editing transition. Captured once on
   * mount via a ref; subsequent re-renders ignore prop identity changes.
   * Null (or undefined) when the editor was opened via keyboard (Enter/Space)
   * or has no caller yet, in which case the cursor lands at end-of-content.
   */
  caret?: { x: number; y: number } | null;
  onSave: (sectionId: string, newContent: string) => Promise<void>;
  onExit: () => void;
}
```

2. **Capture caret on mount** (inside the component body, above `useEditor`). Normalize `undefined` to `null` when capturing so the downstream check is simple:

```ts
const caretOnMountRef = useRef<{ x: number; y: number } | null>(caret ?? null);
```

3. **Remove `autofocus: "end"`** from the `useEditor` options. We place the cursor explicitly in step 6.

4. **Remove `onBlur: handleExit`** from the `useEditor` options. Blur no longer exits — this is the central UX change.

5. **Destructure `flush` from `useAutoSave`.** The current line at [SectionEditor.tsx:103](../../components/editor/SectionEditor.tsx#L103) is `useAutoSave(buffer, save, { debounceMs: 500, enabled: true });` (bare call, result discarded). Replace it with:

```ts
const { flush } = useAutoSave(buffer, save, { debounceMs: 500, enabled: true });
```

**Placement matters:** this line must live **above** `useEditor({...})` so the `handleDOMEvents.blur` closure (added in step 6) can see `flush`. If you move it below, you'll get a temporal-dead-zone error at build time.

6. **Add `editorProps.handleDOMEvents.blur`** to call `flush()`. Inside the `useEditor` options, merge the existing `editorProps` with:

```ts
editorProps: {
  attributes: {
    "aria-label": "Edit section",
    class:
      "tiptap-section-editor text-base leading-relaxed text-foreground whitespace-pre-wrap outline-none",
  },
  handleKeyDown: (_view, event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      handleExit();
      return true;
    }
    return false;
  },
  handleDOMEvents: {
    blur: () => {
      // Fire-and-forget. `flush` cancels the pending debounce and kicks off
      // the save; `useAutoSave` serializes behind any in-flight save
      // internally, so we don't need to await here.
      void flush();
      return false; // don't swallow the event
    },
  },
},
```

7. **Place the cursor on mount** (effect below `useEditor`):

```ts
useEffect(() => {
  if (!editor) return;
  const c = caretOnMountRef.current;
  if (c) {
    const resolved = editor.view.posAtCoords({ left: c.x, top: c.y });
    if (resolved) {
      editor.commands.setTextSelection(resolved.pos).focus();
      return;
    }
  }
  editor.commands.focus("end");
}, [editor]);
```

The dep array is intentionally `[editor]` only — the caret comes from the ref, not the prop, so prop identity churn doesn't re-fire this effect.

- [ ] **Step 5: Run tests — expect pass**

```bash
cd /home/chase/projects/scriptr/.worktrees/editor-sticky-focus
npx vitest run tests/components/editor/SectionEditor.test.tsx
```

Expected: all SectionEditor tests pass. Typecheck still fails at the usage site (`SectionCard`), which is addressed in Task 2.

- [ ] **Step 6: Commit**

```bash
cd /home/chase/projects/scriptr/.worktrees/editor-sticky-focus
git add components/editor/SectionEditor.tsx tests/components/editor/SectionEditor.test.tsx
git commit -m "$(cat <<'EOF'
feat(editor): SectionEditor caret prop + no-blur-exit

Drop autofocus:'end' and onBlur:handleExit; resolve a click-capture
caret prop via posAtCoords on mount (ref-captured), falling back to
focus('end'). Wire handleDOMEvents.blur to useAutoSave.flush() so
pending edits persist without relying on unmount to trigger the flush.

Part of sticky-focus. Spec:
docs/superpowers/specs/2026-04-21-section-editor-sticky-focus-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `SectionCard` — parent-controlled edit state, onMouseDown

**Files:**
- Modify: `components/editor/SectionCard.tsx`
- Modify: `tests/components/editor/SectionCard.test.tsx`

- [ ] **Step 1: Write failing tests**

Open `tests/components/editor/SectionCard.test.tsx`. Before writing, sanity-check the existing tests — they currently only exercise the kebab-menu, inline-note, and regenerating-shimmer paths, with **no** coverage of click-to-edit or the `SectionEditor` branch. Verify:

```bash
cd /home/chase/projects/scriptr/.worktrees/editor-sticky-focus
grep -c "SectionEditor\|editRequested\|isEditing" tests/components/editor/SectionCard.test.tsx
```

Expected: `0`. If any hits appear, a future contributor may have added coverage that needs reconciling — read the hits before proceeding. Otherwise, just add a new `describe` block at the end of the file for the sticky-focus behavior (no existing tests to rewrite).

Key test cases to add / update:

```tsx
describe("SectionCard sticky-focus wiring", () => {
  it("renders read-only <p> (no SectionEditor) when isEditing=false", () => {
    const { container, unmount } = mount(
      <SectionCard
        section={baseSection}
        isEditing={false}
        caret={null}
        onRequestEdit={vi.fn()}
        onExit={vi.fn()}
        onSaveBody={vi.fn()}
      />,
    );
    // ProseMirror would be injected by Tiptap under test if the editor
    // mounted; ensure it's absent.
    expect(container.querySelector('[data-testid="proseMirror"]')).toBeNull();
    // The read-only <p> carries aria-label "Edit section" when canEdit.
    expect(container.querySelector('[aria-label="Edit section"]')).not.toBeNull();
    unmount();
  });

  it("onMouseDown captures clientX/clientY and calls onRequestEdit", () => {
    const onRequestEdit = vi.fn();
    const { container, unmount } = mount(
      <SectionCard
        section={baseSection}
        isEditing={false}
        caret={null}
        onRequestEdit={onRequestEdit}
        onExit={vi.fn()}
        onSaveBody={vi.fn()}
      />,
    );
    const p = container.querySelector(
      '[aria-label="Edit section"]',
    ) as HTMLElement;
    expect(p).not.toBeNull();
    act(() => {
      // Synthetic React MouseEvent fabrication — dispatch a native MouseEvent
      // with the coords; React's synthetic system will pass clientX/clientY
      // through.
      p.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, clientX: 123, clientY: 456 }),
      );
    });
    expect(onRequestEdit).toHaveBeenCalledWith("sec-1", { x: 123, y: 456 });
    unmount();
  });

  it("keyboard Enter activates with null caret", () => {
    const onRequestEdit = vi.fn();
    const { container, unmount } = mount(
      <SectionCard
        section={baseSection}
        isEditing={false}
        caret={null}
        onRequestEdit={onRequestEdit}
        onExit={vi.fn()}
        onSaveBody={vi.fn()}
      />,
    );
    const p = container.querySelector(
      '[aria-label="Edit section"]',
    ) as HTMLElement;
    act(() => {
      p.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onRequestEdit).toHaveBeenCalledWith("sec-1", null);
    unmount();
  });

  it("renders SectionEditor (not read-only <p>) when isEditing=true", () => {
    // Reuses the @tiptap/react + useAutoSave mocks from this file's top
    // (the same mocks used by SectionEditor.test.tsx). If this file doesn't
    // already declare those mocks, add them at the top using the exact
    // shape shown in SectionEditor.test.tsx — the `useEditor` mock must
    // return an object with `view.posAtCoords` and
    // `commands.setTextSelection / focus` so SectionEditor's mount effect
    // doesn't crash.
    const { container, unmount } = mount(
      <SectionCard
        section={baseSection}
        isEditing={true}
        caret={{ x: 10, y: 20 }}
        onRequestEdit={vi.fn()}
        onExit={vi.fn()}
        onSaveBody={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-testid="proseMirror"]')).not.toBeNull();
    unmount();
  });

  it("click alone (without mousedown) does not fire onRequestEdit", () => {
    // Regression guard for the spec's explicit removal of onClick — leaving
    // it in place would double-fire onRequestEdit (once from mousedown, once
    // from click) with the second call carrying stale null coords.
    const onRequestEdit = vi.fn();
    const { container, unmount } = mount(
      <SectionCard
        section={baseSection}
        isEditing={false}
        caret={null}
        onRequestEdit={onRequestEdit}
        onExit={vi.fn()}
        onSaveBody={vi.fn()}
      />,
    );
    const p = container.querySelector(
      '[aria-label="Edit section"]',
    ) as HTMLElement;
    act(() => {
      p.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onRequestEdit).not.toHaveBeenCalled();
    unmount();
  });
});
```

The existing tests in this file should continue to pass unchanged — they only cover the kebab menu, inline note input, and regenerating-shimmer path, all of which survive the new prop-additive contract. The grep in Step 1 above verifies this; if it returns any hits, reconcile before moving on.

- [ ] **Step 2: Run tests — expect failure**

```bash
cd /home/chase/projects/scriptr/.worktrees/editor-sticky-focus
npx vitest run tests/components/editor/SectionCard.test.tsx
```

Expected: fails. `SectionCard` doesn't accept `isEditing`, `caret`, `onRequestEdit`, `onExit` yet.

- [ ] **Step 3: Update the `SectionCard` implementation**

Edit `components/editor/SectionCard.tsx`:

1. **Update props:** remove nothing from the existing contract; add the four new props as optional so the existing `SectionList` callsite (which doesn't pass them yet) still type-checks:

```ts
interface SectionCardProps {
  section: Section;
  isRegenerating?: boolean;
  disableActions?: boolean;
  onRegenerate?: (sectionId: string) => void;
  onRegenerateWithNote?: (sectionId: string, note: string) => void;
  onDelete?: (sectionId: string) => void;
  onSaveBody?: (sectionId: string, newContent: string) => Promise<void>;
  // ─── NEW: sticky-focus plumbing from SectionList ──────────────────────────
  // All four are optional. `isEditing` defaulting to false means the card is
  // read-only by default; `onRequestEdit`/`onExit` being undefined means
  // clicks are no-ops (the card can't "enter edit mode" without a parent to
  // tell it to). This is the safe default for any non-SectionList caller,
  // and keeps the Task 2 commit type-safe before Task 3 wires the plumbing.
  isEditing?: boolean;
  caret?: { x: number; y: number } | null;
  onRequestEdit?: (sectionId: string, caret: { x: number; y: number } | null) => void;
  onExit?: () => void;
}
```

2. **Delete** the `useState` / `setEditRequested` block and the `handleEditorExit` / `handleBodyClick` internals. Replace the `isEditing` derivation with:

```ts
const canEdit = Boolean(onSaveBody) && !isRegenerating && !disableActions;
const editing = Boolean(isEditing) && canEdit;
```

3. **Replace the read-only `<p>` handlers**:

```tsx
<p
  className={cn(
    "text-base leading-relaxed text-foreground whitespace-pre-wrap",
    canEdit && "cursor-text",
  )}
  onMouseDown={(e) => {
    if (!canEdit || !onRequestEdit) return;
    onRequestEdit(section.id, { x: e.clientX, y: e.clientY });
  }}
  onKeyDown={(e) => {
    if (!canEdit || !onRequestEdit) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onRequestEdit(section.id, null);
    }
  }}
  role={canEdit ? "button" : undefined}
  tabIndex={canEdit ? 0 : undefined}
  aria-label={canEdit ? "Edit section" : undefined}
>
  {section.content}
</p>
```

Note the removal of `onClick`. The spec at lines 95-99 explicitly calls this out: leaving `onClick` in place would double-fire `onRequestEdit` after `onMouseDown` has already set state, with the second fire carrying stale `null` coords.

4. **Replace the `<SectionEditor>` invocation** (inside the `editing` branch) with:

```tsx
{editing && onSaveBody ? (
  <SectionEditor
    sectionId={section.id}
    initialContent={section.content}
    caret={caret ?? null}
    onSave={onSaveBody}
    onExit={onExit ?? (() => {})}
  />
) : (
  /* …read-only <p> above… */
)}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd /home/chase/projects/scriptr/.worktrees/editor-sticky-focus
npx vitest run tests/components/editor/SectionCard.test.tsx tests/components/editor/SectionEditor.test.tsx
```

Expected: all SectionCard and SectionEditor tests pass.

- [ ] **Step 5: Typecheck — still expected to fail at SectionList usage**

```bash
cd /home/chase/projects/scriptr/.worktrees/editor-sticky-focus
npm run typecheck
```

Expected: TypeScript complains at `components/editor/SectionList.tsx` because it calls `<SectionCard>` without the new optional props — but they're optional, so the card still compiles. HOWEVER: since `SectionCard` no longer has internal edit state, the editor can never mount until Task 3 passes the props. That's fine for staging; we just can't ship between tasks 2 and 3. Don't finish this chunk until Task 3 is also done.

- [ ] **Step 6: Commit**

```bash
cd /home/chase/projects/scriptr/.worktrees/editor-sticky-focus
git add components/editor/SectionCard.tsx tests/components/editor/SectionCard.test.tsx
git commit -m "$(cat <<'EOF'
feat(editor): SectionCard takes edit state as props

Remove local editRequested state; add isEditing / caret / onRequestEdit
/ onExit props so SectionList owns which section is editable. Replace
onClick on the read-only <p> with onMouseDown that captures clientX/
clientY — avoids double-fire and gives the editor real click position.

Part of sticky-focus. Spec:
docs/superpowers/specs/2026-04-21-section-editor-sticky-focus-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `SectionList` — own edit state, auto-exit on stream

**Files:**
- Modify: `components/editor/SectionList.tsx`
- Create: `tests/components/editor/SectionList.sticky-focus.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `tests/components/editor/SectionList.sticky-focus.test.tsx`. This file tests `SectionList`'s new ownership of `editingSectionId` / `pendingCaret`. Use the same manual harness as `SectionCard.test.tsx`. Mock the generation store and `@tiptap/react` so mounting the real editor is cheap.

```tsx
// @vitest-environment jsdom
/**
 * Tests for SectionList's sticky-focus state ownership: one editingSectionId
 * across siblings, Esc-to-exit, click-to-swap, and auto-exit when
 * disableActions flips true (any generation in flight).
 *
 * Generation store: this suite uses the REAL Zustand store and drives state
 * via useGenerationStore.setState(...) / .getState() — the same pattern as
 * tests/components/editor/generation-store.test.ts. No vi.mock on the store.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import type { Section } from "@/lib/types";
import { useGenerationStore } from "@/components/editor/generation-store";

// Light Tiptap mock — enough for SectionEditor to mount without crashing.
vi.mock("@tiptap/react", () => {
  const useEditor = () => ({
    view: { posAtCoords: () => ({ pos: 0, inside: -1 }) },
    commands: {
      setTextSelection: () => ({ focus: () => {} }),
      focus: () => {},
    },
  });
  const EditorContent = () => <div data-testid="proseMirror" />;
  return { useEditor, EditorContent };
});

// Mock useAutoSave to avoid scheduling real timers.
vi.mock("@/hooks/useAutoSave", () => ({
  useAutoSave: () => ({ status: "idle" as const, flush: vi.fn() }),
}));

import { SectionList } from "@/components/editor/SectionList";

// Reset store to a known-idle state between tests. Mirrors the pattern at
// tests/components/editor/generation-store.test.ts:13-29.
const initialStore = useGenerationStore.getState();
function resetStore() {
  useGenerationStore.setState(
    {
      ...initialStore,
      activeChapterId: null,
      liveText: "",
      isStreaming: false,
      regeneratingSectionId: null,
      regeneratingChapterId: null,
    },
    false,
  );
}

const SECTIONS: Section[] = [
  { id: "A", content: "A content" },
  { id: "B", content: "B content" },
  { id: "C", content: "C content" },
];

type Mounted = {
  container: HTMLDivElement;
  root: Root;
  unmount: () => void;
  rerender: (el: React.ReactElement) => void;
};
function mount(el: React.ReactElement): Mounted {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root!: Root;
  act(() => {
    root = createRoot(container);
    root.render(el);
  });
  return {
    container,
    root,
    unmount: () => { act(() => root.unmount()); container.remove(); },
    rerender: (next) => { act(() => root.render(next)); },
  };
}

beforeEach(() => {
  resetStore();
});

function getCardRoot(container: HTMLElement, sectionId: string): HTMLElement {
  // Each SectionCard renders an <article>. Find the one whose text contains
  // the section id's canonical content — cheap, avoids introducing testids.
  const articles = Array.from(container.querySelectorAll("article"));
  for (const a of articles) {
    if (a.textContent?.includes(`${sectionId} content`)) return a;
  }
  throw new Error(`card ${sectionId} not found`);
}

function getReadOnlyP(container: HTMLElement, sectionId: string): HTMLElement {
  const card = getCardRoot(container, sectionId);
  const p = card.querySelector('[aria-label="Edit section"]');
  if (!p) throw new Error(`read-only <p> for ${sectionId} not found`);
  return p as HTMLElement;
}

function hasEditor(container: HTMLElement, sectionId: string): boolean {
  const card = getCardRoot(container, sectionId);
  return Boolean(card.querySelector('[data-testid="proseMirror"]'));
}

describe("SectionList sticky-focus", () => {
  it("mounts with no section editing", () => {
    const { container, unmount } = mount(
      <SectionList
        slug="s"
        chapterId="ch"
        sections={SECTIONS}
        onSectionSaveBody={vi.fn()}
      />,
    );
    for (const id of ["A", "B", "C"]) expect(hasEditor(container, id)).toBe(false);
    unmount();
  });

  it("mousedown on section A's <p> opens A's editor only", () => {
    const { container, unmount } = mount(
      <SectionList
        slug="s"
        chapterId="ch"
        sections={SECTIONS}
        onSectionSaveBody={vi.fn()}
      />,
    );
    const pA = getReadOnlyP(container, "A");
    act(() => {
      pA.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, clientX: 10, clientY: 20 }),
      );
    });
    expect(hasEditor(container, "A")).toBe(true);
    expect(hasEditor(container, "B")).toBe(false);
    expect(hasEditor(container, "C")).toBe(false);
    unmount();
  });

  it("mousedown on section B after A swaps edit state", () => {
    const { container, unmount } = mount(
      <SectionList
        slug="s"
        chapterId="ch"
        sections={SECTIONS}
        onSectionSaveBody={vi.fn()}
      />,
    );
    act(() => {
      getReadOnlyP(container, "A").dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, clientX: 1, clientY: 1 }),
      );
    });
    expect(hasEditor(container, "A")).toBe(true);

    act(() => {
      getReadOnlyP(container, "B").dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, clientX: 1, clientY: 1 }),
      );
    });
    expect(hasEditor(container, "A")).toBe(false);
    expect(hasEditor(container, "B")).toBe(true);
    unmount();
  });

  it("flipping isStreaming true auto-exits any open editor", () => {
    const { container, unmount } = mount(
      <SectionList
        slug="s"
        chapterId="ch"
        sections={SECTIONS}
        onSectionSaveBody={vi.fn()}
      />,
    );
    act(() => {
      getReadOnlyP(container, "A").dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, clientX: 1, clientY: 1 }),
      );
    });
    expect(hasEditor(container, "A")).toBe(true);

    // Simulate a generation start. Real Zustand store + setState → the
    // SectionList subscription fires, SectionList re-renders, its effect
    // sees disableActions=true and clears editingSectionId.
    act(() => {
      useGenerationStore.setState({ isStreaming: true });
    });
    expect(hasEditor(container, "A")).toBe(false);
    unmount();
  });

});
```

**Esc-exit coverage:** end-to-end Esc handling is owned by `SectionEditor` and tested at that unit level (Task 1's `handleKeyDown` Esc test). The Tiptap mock in this file does not simulate keybinding dispatch through the mounted `proseMirror` div, so re-testing the full chain here would require a heavier mock. The parent `onExit` callback plumbing is still exercised end-to-end by the mousedown-swap and `disableActions` tests — both paths clear `editingSectionId` via the same state setters that `onExit` would invoke.

- [ ] **Step 2: Run tests — expect failure**

```bash
cd /home/chase/projects/scriptr/.worktrees/editor-sticky-focus
npx vitest run tests/components/editor/SectionList.sticky-focus.test.tsx
```

Expected: fails. `SectionList` doesn't own edit state yet.

- [ ] **Step 3: Update `SectionList`**

Edit `components/editor/SectionList.tsx`:

1. Add `useState` + `useEffect` imports:

```ts
import { useEffect, useState } from "react";
```

2. Inside the component body (above `disableActions`), add:

```ts
const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
const [pendingCaret, setPendingCaret] = useState<{ x: number; y: number } | null>(null);
```

3. Below `disableActions`, add the auto-exit effect:

```ts
// Any generation in flight (chapter stream or single-section regen) disables
// action menus via `disableActions`. It also exits edit mode on every card so
// the in-progress autosave flushes before the stream's persistence writes
// overlap with ours. One effect, cheap, idempotent.
useEffect(() => {
  if (disableActions && editingSectionId !== null) {
    setEditingSectionId(null);
    setPendingCaret(null);
  }
}, [disableActions, editingSectionId]);
```

4. Thread the four new props down into each `<SectionCard>`:

```tsx
<SectionCard
  key={section.id}
  section={section}
  isRegenerating={regeneratingSectionId === section.id}
  disableActions={disableActions}
  isEditing={editingSectionId === section.id}
  caret={editingSectionId === section.id ? pendingCaret : null}
  onRequestEdit={(id, caret) => {
    setPendingCaret(caret);
    setEditingSectionId(id);
  }}
  onExit={() => {
    setEditingSectionId(null);
    setPendingCaret(null);
  }}
  onRegenerate={onSectionRegenerate}
  onRegenerateWithNote={onSectionRegenerateWithNote}
  onDelete={onSectionDelete}
  onSaveBody={onSectionSaveBody}
/>
```

- [ ] **Step 4: Run all component tests — expect pass**

```bash
cd /home/chase/projects/scriptr/.worktrees/editor-sticky-focus
npx vitest run tests/components/editor/
```

Expected: all pass.

- [ ] **Step 5: Quality gates**

```bash
cd /home/chase/projects/scriptr/.worktrees/editor-sticky-focus
npm run typecheck
npm run lint
npm test
```

All three must be green. The privacy smoke test in particular (at `tests/privacy/no-external-egress.test.ts`) must continue to pass — we added zero routes, so if it fails, something is off.

- [ ] **Step 6: Commit**

```bash
cd /home/chase/projects/scriptr/.worktrees/editor-sticky-focus
git add components/editor/SectionList.tsx tests/components/editor/SectionList.sticky-focus.test.tsx
git commit -m "$(cat <<'EOF'
feat(editor): SectionList owns editingSectionId + pendingCaret

Lift edit-state ownership from SectionCard so only one section is
editable at a time, outside-clicks don't lose focus, and any
generation in flight clears edit state (flushing pending autosave)
via a single useEffect. Completes the sticky-focus refactor alongside
Tasks 1 and 2.

Spec: docs/superpowers/specs/2026-04-21-section-editor-sticky-focus-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: E2E — sticky focus across blur

**Files:**
- Create: `tests/e2e/editor-sticky-focus.spec.ts`

- [ ] **Step 1: Read the existing E2E patterns**

Before writing, open `tests/e2e/golden-path.spec.ts` and `tests/e2e/publishing-kit.spec.ts`. Match their structure: `test.beforeAll` wipes `E2E_DATA_DIR` from `playwright.config`, then seeds state via the real scriptr HTTP API (no UI automation of seed steps beyond what you're actually asserting). Reuse their route stubs for `/api/generate*` if your flow touches them — otherwise omit.

- [ ] **Step 2: Write the failing E2E spec**

Create `tests/e2e/editor-sticky-focus.spec.ts`. We seed state by mixing UI (matches `golden-path.spec.ts` conventions — story + chapter creation through buttons) with a direct API PATCH (populates sections without generating). Seeding sections through a PATCH avoids the need to stub `/api/generate` and keeps the test fast.

```ts
/**
 * Sticky focus E2E — click into a section, blur to the metadata pane, assert
 * the Tiptap editor stays mounted. Click another section, assert swap. Press
 * Esc, assert no editor is mounted. Fresh story per run (reuses the
 * isolated /tmp/scriptr-e2e data dir via the project's playwright config).
 */
import { test, expect } from "@playwright/test";
import { mkdir, rm } from "node:fs/promises";
import { E2E_DATA_DIR } from "../../playwright.config";

test.beforeAll(async () => {
  await rm(E2E_DATA_DIR, { recursive: true, force: true });
  await mkdir(E2E_DATA_DIR, { recursive: true });
});

test("editor stays mounted across metadata-pane blur and swaps between sections", async ({
  page,
  request,
}) => {
  // ── 1. Create story (UI — mirrors golden-path.spec.ts steps 3-4) ─────────
  await page.goto("/");
  await expect(page.getByRole("button", { name: "New story" }).first()).toBeVisible();
  await page.getByRole("button", { name: "New story" }).first().click();
  await expect(page.getByLabel("Title")).toBeVisible();
  await page.getByLabel("Title").fill("Sticky Focus E2E");
  await page.getByRole("button", { name: "Create story" }).click();
  await page.waitForURL(/\/s\/[^/]+(\?.*)?$/, { timeout: 15_000 });
  const slug = page.url().match(/\/s\/([^/?]+)/)![1];

  // ── 2. Add a chapter titled "Sticky" (UI — mirrors golden-path step 6) ───
  await expect(page.getByText("Chapters")).toBeVisible();
  await page.getByRole("button", { name: "New chapter" }).click();
  const chapterInput = page.getByPlaceholder("Chapter title…");
  await expect(chapterInput).toBeVisible();
  await chapterInput.fill("Sticky");
  await chapterInput.press("Enter");

  // ── 3. Grab the chapter id from the listing API, PATCH in two sections ───
  const listRes = await request.get(`/api/stories/${slug}/chapters`);
  const listJson = (await listRes.json()) as { ok: boolean; data: { id: string }[] };
  expect(listJson.ok).toBe(true);
  const chapterId = listJson.data[0].id;

  const patchRes = await request.patch(
    `/api/stories/${slug}/chapters/${chapterId}`,
    {
      data: {
        sections: [
          { id: "sec-A", content: "Section A body — click into the middle." },
          { id: "sec-B", content: "Section B body — swap target." },
        ],
      },
    },
  );
  expect(patchRes.ok()).toBe(true);

  // ── 4. Reload the editor so SWR picks up the new sections ────────────────
  await page.goto(`/s/${slug}?chapter=${chapterId}`);
  await expect(page.getByText("Section A body")).toBeVisible();
  await expect(page.getByText("Section B body")).toBeVisible();

  // ── 5. Click into section A's prose at a specific character offset ───────
  // `:has-text(...)` selects an <article> whose descendant text matches.
  const sectionA = page.locator('article:has-text("Section A body")').first();
  await sectionA.locator('[aria-label="Edit section"]').click({ position: { x: 60, y: 8 } });
  // Tiptap attaches the `ProseMirror` class to the contenteditable node it
  // applies the `editorProps.attributes` to — i.e. the node carrying our
  // `aria-label="Edit section"` label while editable. Scope the match.
  await expect(sectionA.locator('[aria-label="Edit section"].ProseMirror')).toBeVisible();

  // ── 6. Blur to the right-side metadata pane ──────────────────────────────
  // MetadataPane renders a Chapter Summary textarea with a stable
  // `id="chapter-summary"` (see components/editor/SummaryField.tsx:72). Click
  // it to take focus off the editor.
  await page.locator("#chapter-summary").click();

  // Editor must STILL be mounted on section A. This is the whole point.
  await expect(sectionA.locator('[aria-label="Edit section"].ProseMirror')).toBeVisible();

  // ── 7. Click into section B ──────────────────────────────────────────────
  const sectionB = page.locator('article:has-text("Section B body")').first();
  await sectionB.locator('[aria-label="Edit section"]').click({ position: { x: 60, y: 8 } });
  await expect(sectionB.locator('[aria-label="Edit section"].ProseMirror')).toBeVisible();
  // Section A must have unmounted.
  await expect(sectionA.locator('[aria-label="Edit section"].ProseMirror')).toHaveCount(0);

  // ── 8. Esc exits edit mode ───────────────────────────────────────────────
  await page.keyboard.press("Escape");
  await expect(sectionB.locator('[aria-label="Edit section"].ProseMirror')).toHaveCount(0);
});
```

Selector notes:
- `article:has-text("Section A body")` picks the `SectionCard` article; we use the seeded text as an anchor. If future refactors change the wrapping element, add a `data-testid` to the `<article>` in `SectionCard.tsx` in a follow-up.
- `.ProseMirror` is the class Tiptap applies to the editable node (same node that carries our `aria-label="Edit section"` per `editorProps.attributes`). The combined `[aria-label=…].ProseMirror` selector is the tightest "editor is mounted inside THIS card" assertion without introducing testids.
- `#chapter-summary` comes from `components/editor/SummaryField.tsx:72` — a stable id on the Chapter Summary textarea in the right-pane MetadataPane. If that id changes, pick another stable anchor in MetadataPane (e.g., the `#chapter-target-words` input at `MetadataPane.tsx:80`).

- [ ] **Step 3: Run E2E — expect pass**

`package.json` exposes `"e2e": "playwright test"`. Single-file filtering goes through Playwright directly, not through the npm alias:

```bash
cd /home/chase/projects/scriptr/.worktrees/editor-sticky-focus
npx playwright test tests/e2e/editor-sticky-focus.spec.ts
```

Expected: pass. Playwright boots its own dev server on port 3001 with `SCRIPTR_DATA_DIR=/tmp/scriptr-e2e`; no real `data/` is touched.

If the seed API calls reject (404 or 400), double-check the routes exist:
- `GET /api/stories/:slug/chapters` — list
- `PATCH /api/stories/:slug/chapters/:id` — update sections

Both are exercised elsewhere in the codebase (`app/api/stories/[slug]/chapters/route.ts` and `app/api/stories/[slug]/chapters/[id]/route.ts`). If one signature has changed, open the route file and adjust the call accordingly.

- [ ] **Step 4: Full quality gate**

```bash
cd /home/chase/projects/scriptr/.worktrees/editor-sticky-focus
npm run typecheck
npm run lint
npm test
npm run e2e
```

All four must be green. The privacy smoke runs inside `npm test`; the entire E2E suite (including `golden-path` and `publishing-kit`) runs inside `npm run e2e`.

- [ ] **Step 5: Manual smoke (required before marking Task 4 done)**

Start the dev server:

```bash
cd /home/chase/projects/scriptr/.worktrees/editor-sticky-focus
npm run dev
```

Open `http://127.0.0.1:3000` and manually verify:

1. Click midway into a long section's prose — cursor lands where you clicked (not at the end).
2. Type a few characters, then click a Bible character-row input in the right pane. The section's editor stays visible; you can click back into the prose and continue typing without losing your position.
3. Click on a different section's prose. Focus swaps cleanly; the first section returns to read-only.
4. Press Esc. The current section reverts to read-only.
5. Start a chapter generation (or a section regen). The editor auto-exits; your in-progress edits persist (confirm by refreshing the page — your text is still there).

UI changes are not provably correct from typecheck + unit tests alone — the Tiptap editor's live behavior in a real browser is what the user actually experiences. Do not skip this step. If any of 1-5 fails, the feature isn't done; diagnose and fix before moving on.

- [ ] **Step 6: Commit**

```bash
cd /home/chase/projects/scriptr/.worktrees/editor-sticky-focus
git add tests/e2e/editor-sticky-focus.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): sticky focus across metadata-pane blur and section swap

Seeds a chapter with two sections, clicks into one, blurs to the
metadata pane, asserts the Tiptap editor stays mounted; clicks the
other section, asserts swap; Esc exits.

Spec: docs/superpowers/specs/2026-04-21-section-editor-sticky-focus-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Finalization

- [ ] **Step 1: Diff against main — sanity check**

```bash
cd /home/chase/projects/scriptr/.worktrees/editor-sticky-focus
git log --oneline origin/main..HEAD
git diff origin/main --stat
```

Expected: 3-4 commits (one per task), touching only the files listed in "File structure" above. If any file outside that list appears, investigate — the project's AGENTS.md specifically warns about stray files landing outside the intended worktree.

- [ ] **Step 2: Green gate check (final)**

```bash
cd /home/chase/projects/scriptr/.worktrees/editor-sticky-focus
npm run typecheck && npm run lint && npm test && npm run e2e
```

All four must pass. This is the signal to hand off for code review / merge. Do not merge a failing gate.

- [ ] **Step 3: Open a PR or hand back to the user**

Depending on the project's merge policy, either push + `gh pr create`, or report back to the user with a summary. Surface the branch and let the user decide whether to push; don't push or open a PR unilaterally.

Report to the user:
- Branch name: `feature/editor-sticky-focus`
- Commit list (from `git log --oneline`)
- Summary: "Clicking off the prose editor no longer loses cursor position; clicking into prose lands the cursor where you clicked; exits only on Esc, clicking another section, switching chapter, or generation start. All unit / component / e2e tests pass. Privacy smoke unchanged (no new routes)."

---

## Rollback

If this needs to be reverted after landing, it is a single-PR revert:

```bash
git revert --no-commit <task-4-commit>..<task-1-commit>
git commit -m "revert: sticky focus (temporary)"
```

No storage migrations, no server-side state, no CSP changes — nothing outside the client bundle depends on this change.
