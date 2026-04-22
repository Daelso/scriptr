# scriptr — Section Editor Sticky Focus Design Spec

**Date:** 2026-04-21
**Author:** Chase (with Claude)
**Status:** Draft

## Summary

Make the chapter-body prose editor behave like a real text editor: clicking off the section (metadata pane, kebab menu, elsewhere in the window) preserves your cursor position instead of snapping back to a read-only view and losing it. Clicking into a specific point in the prose places the cursor *at that point* instead of jumping to the end. You leave edit mode only by explicit action (Esc, clicking a different section, switching chapter, or a stream/regen starting).

This applies to the existing Tiptap-based `SectionEditor` flow in [components/editor/SectionCard.tsx](../../../components/editor/SectionCard.tsx) + [components/editor/SectionEditor.tsx](../../../components/editor/SectionEditor.tsx). It affects edits to any persisted section — whether the prose came from Grok generation, the Publishing Kit's import flow, or a prior manual edit. No other editors (Bible, chapter title, story metadata) are in scope.

## Goals

1. Clicking outside the prose (right-side metadata pane, the kebab menu, empty window space, the nav pane) keeps the active `SectionEditor` mounted with its selection intact.
2. Clicking inside the read-only `<p>` places the cursor at the clicked character position, not at the end of the section.
3. Explicit exit paths still work: Esc key, clicking a different section's `<p>`, switching chapter, story unmount, and generation/regen starts all cleanly exit edit mode.
4. Autosave semantics do not regress: the existing `useAutoSave` contract (debounced save while mounted, flush-on-unmount) still applies, and pending edits flush before the editor unmounts on any exit path.
5. Only one section can be in edit mode at a time within a chapter.

## Non-goals

- Every-section-always-editable (Approach B in brainstorming). The cheap read-only `<p>` render is kept for sections not currently being edited.
- Cursor persistence across chapter switches. Switching chapters unmounts the current editor; coming back starts fresh.
- Cursor persistence across sessions (page reloads). In-memory only.
- Bible / chapter-title / story-metadata input focus behavior. Those are plain inputs and out of scope.
- Multi-caret or multi-section simultaneous editing.
- Keyboard-based "click position" — Enter/Space on a focused `<p>` continues to enter edit mode at end-of-content (no click coordinate to resolve).
- New toolbar, new formatting affordances, or any visible UI chrome beyond what already ships.

## Architecture

Two behavioral changes and one state-ownership move. No new files, no new storage, no new API routes.

```
SectionList
  editingSectionId: string | null            [NEW — lifted from SectionCard]
  pendingCaret: { x, y } | null              [NEW — consumed once by SectionEditor on mount]

  SectionCard (per section)
    isEditing = editingSectionId === section.id && !disableActions && !isRegenerating
    onMouseDown on read-only <p>             [NEW — captures clientX/clientY, bubbles to parent]
    onClick / Enter / Space                  [existing — bubbles a "request edit, no caret" signal]

    SectionEditor (mounted only when isEditing)
      - autofocus: "end" removed             [CHANGED]
      - onBlur: handleExit removed           [CHANGED]
      - caret prop                           [NEW — { x, y } | null]
        → on mount, posAtCoords(caret) → setTextSelection(pos).focus()
        → on null, fall back to end-of-content
      - Esc still calls onExit (unchanged)
      - blur triggers explicit autosave flush [NEW — belt-and-suspenders]
```

Files touched:

| Change | Path | Approx LOC |
|---|---|---|
| MOD | `components/editor/SectionList.tsx` | +30 / -5 |
| MOD | `components/editor/SectionCard.tsx` | +10 / -15 |
| MOD | `components/editor/SectionEditor.tsx` | +20 / -10 |
| MOD | `hooks/useAutoSave.ts` (expose flush) | +5 |
| NEW | `tests/components/editor/SectionList.sticky-focus.test.tsx` | ~120 |
| MOD | `tests/components/editor/SectionCard.test.tsx` | +40 |
| MOD | `tests/components/editor/SectionEditor.test.tsx` | +60 |
| NEW | `e2e/sticky-focus.spec.ts` | ~40 |

Zero new runtime dependencies. Zero new CSP origins. Zero new egress surface. Zero new storage writes. Client-side interaction only.

## State ownership — lifting `editRequested` to `SectionList`

Today each `SectionCard` owns its own `editRequested: boolean` local state ([components/editor/SectionCard.tsx:58](../../../components/editor/SectionCard.tsx#L58)). That makes "only one section open at a time" and "handle outside clicks without losing state" awkward because each card has no visibility into siblings.

Move the state up one level:

```ts
// components/editor/SectionList.tsx
const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
const [pendingCaret, setPendingCaret] = useState<{ x: number; y: number } | null>(null);

// Passed to each SectionCard:
//   isEditing={editingSectionId === section.id}
//   caret={editingSectionId === section.id ? pendingCaret : null}
//   onRequestEdit={(id, caret) => {
//     setPendingCaret(caret);
//     setEditingSectionId(id);
//   }}
//   onExit={() => {
//     setEditingSectionId(null);
//     setPendingCaret(null);
//   }}
```

`SectionCard` no longer owns `editRequested`. It becomes a thin pass-through: computes `isEditing` from the prop + its existing disable gates (`!disableActions && !isRegenerating`), and calls `onRequestEdit` on click/mousedown.

When the user clicks section B while section A is editing:
1. `onMouseDown` on B's `<p>` captures its click coords and fires `onRequestEdit("B", coords)`.
2. Parent sets `editingSectionId = "B"`, `pendingCaret = coords`.
3. A re-renders with `isEditing = false` → its `SectionEditor` unmounts → `useAutoSave` unmount effect flushes any pending save.
4. B re-renders with `isEditing = true` → mounts `SectionEditor` with the coord prop.
5. B's editor on-mount uses `posAtCoords` to place the cursor at the click point.

**Why `onMouseDown`, not `onClick`:** the coord capture must happen before the browser resolves the click's default focus behavior. `onClick` fires after mouseup, by which point the selection has already moved; `onMouseDown` is the earliest React-level hook on the gesture.

`SectionList` also exposes a `clearEditing` handler used by the parent `EditorPane` on programmatic exit events (see "Exit triggers" below).

## Click-to-position — cursor placement via `posAtCoords`

Tiptap exposes `editor.view.posAtCoords({ left, top })` which returns a doc position for viewport coordinates. We use it once, on mount, when a `caret` prop is present.

```ts
// components/editor/SectionEditor.tsx (relevant excerpt)
const editor = useEditor({
  immediatelyRender: false,
  // autofocus removed — we manage focus/selection explicitly on mount.
  extensions: [ /* unchanged */ ],
  content: initialHtml,
  editable: true,
  editorProps: { /* unchanged */ },
  onUpdate: /* unchanged */,
  // onBlur handler removed.
});

useEffect(() => {
  if (!editor) return;
  if (caret) {
    const pos = editor.view.posAtCoords({ left: caret.x, top: caret.y });
    if (pos) {
      editor.commands.setTextSelection(pos.pos).focus();
      return;
    }
  }
  // Fallback: focus end-of-doc (previous `autofocus: "end"` behavior).
  editor.commands.focus("end");
}, [editor, caret]);
```

The effect only runs on mount (deps are stable — `editor` is created once per mount, `caret` is the prop passed at mount and not mutated by the parent afterward since `SectionList` clears `pendingCaret` on state change). We deliberately do not re-resolve `caret` mid-edit; subsequent clicks inside the mounted editor are Tiptap-native.

If `posAtCoords` returns `null` (click landed on padding outside any text node, or the container scrolled between mousedown and mount), the effect falls back to end-of-content — the same behavior as today.

## Blur semantics — save without unmount

Today `SectionEditor` exits on blur ([components/editor/SectionEditor.tsx:162-164](../../../components/editor/SectionEditor.tsx#L162-L164)), which triggers the parent to unmount it. This is the root cause of "click off loses my place." The change:

- **Remove the `onBlur: handleExit` hook entirely.** Blur just means the browser's text cursor is somewhere else on the page; the Tiptap instance stays mounted and retains its internal selection and doc state.
- **Keep Esc → `handleExit`.** Explicit dismissal via keyboard.
- **Keep the existing `useAutoSave` debounce + unmount-flush contract.** Typing while mounted triggers a debounced save every 500ms; when the editor eventually does unmount (via any exit path), the hook fires any outstanding save.
- **Add an explicit blur-flush.** When the editor blurs, call `useAutoSave`'s flush function (new, small addition — see below) so that if the user blurs specifically to close the tab or kill the dev server, the pending buffer is persisted without waiting for the debounce.

`useAutoSave` currently exposes no imperative flush. We add one:

```ts
// hooks/useAutoSave.ts — new return shape
export function useAutoSave<T>(value: T, save: ..., opts: ...): {
  status: "idle" | "saving" | "saved" | "error";
  flush: () => Promise<void>;  // NEW — save now if there's a pending buffer
};
```

Existing callers destructure what they need; adding a new field is non-breaking. `SectionEditor` calls `flush()` from an `onBlur` handler on the Tiptap editor (via `editorProps.handleDOMEvents.blur` or an event listener on the view's DOM node — whichever is cleaner; implementation detail for the plan).

Autosave behavior on Esc: handled by the existing unmount flush. `handleExit` → parent clears `editingSectionId` → editor unmounts → `useAutoSave`'s unmount effect runs → pending save flushes. No change needed.

## Exit triggers

Edit mode ends when any of the following happens. Each sets `editingSectionId = null` in `SectionList` (directly or by parent action), which unmounts the `SectionEditor` and flushes any pending autosave.

| Trigger | Mechanism |
|---|---|
| User presses Esc inside editor | `SectionEditor.handleExit()` → parent `onExit` |
| User clicks a different section's `<p>` | `onMouseDown` on the new `<p>` → `onRequestEdit(newId, coords)` replaces `editingSectionId` |
| Stream/regen starts targeting this chapter | `EditorPane` imperatively clears `SectionList`'s edit state (see below) |
| `disableActions` flips true for any other reason | Same as above — `isEditing` derivation returns false for every card |
| Chapter change | `EditorPane` remounts with the new chapter; `SectionList` mounts fresh with `editingSectionId = null` |
| Story/page unmount | Component tree teardown |

**Stream/regen coupling.** `EditorPane` already has visibility into `isStreaming` and `disableActions` via the generation store. We thread a ref or callback from `SectionList` up to `EditorPane` so that when a stream starts, `EditorPane` can call `clearEditing()`. Alternatively — and simpler — `SectionList` subscribes to `disableActions` as a prop (already passed down for the kebab menu) and runs an effect:

```ts
useEffect(() => {
  if (disableActions && editingSectionId !== null) {
    setEditingSectionId(null);
    setPendingCaret(null);
  }
}, [disableActions, editingSectionId]);
```

This replaces the current per-card derivation `isEditing = editRequested && !disableActions && !isRegenerating`. The per-card `isRegenerating` check still runs locally, since a single-section regen only disables one card's edit state rather than the whole list — but since only one section is editable at a time, if the regenerating section is the editing one, the effect above (or the per-card `isEditing && !isRegenerating` guard) clears it.

## Edge cases

- **Kebab menu on the active section.** Opening the kebab moves focus to the menu button, which fires blur on the Tiptap editor. Under the new semantics this is harmless: the editor stays mounted, the flush-on-blur writes any pending text, and closing the menu or picking a menu item leaves the editor available. Picking "Regenerate" or "Delete" unmounts the editor via the existing `disableActions` / unmount path; pending autosave flushes.
- **Click on padding / gutter inside the section card.** `onMouseDown` is bound only to the `<p>` element, not the surrounding `<article>` or the kebab button. Clicks on margins do nothing — no spurious edit entry.
- **`posAtCoords` returns null.** Fall back to end-of-content. Equivalent to today's behavior.
- **Double-click for word select.** `onMouseDown` fires on the first click and enters edit mode with the cursor at the resolved position. The second click arrives at Tiptap (now mounted) and behaves natively — word-select works. If React's synthetic-event batching ever reorders this, the fallback end-of-content placement still produces a usable state.
- **Rapid clicks across sections.** Each `onMouseDown` sets a new `editingSectionId`. React's commit phase unmounts the previous editor synchronously, flushing the autosave via the hook's unmount effect before the new editor mounts.
- **Blur-during-save race.** `flush()` on blur returns a promise; we do not await it inside the event handler (the event handler must stay synchronous). If the user's next action happens before the flush resolves, subsequent saves are serialized by `useAutoSave`'s existing in-flight-save logic. No new race surface.
- **Stream starts mid-edit.** Covered above: `disableActions` effect clears `editingSectionId`, unmount-flush saves the pending buffer before the stream's first token lands. The server-side chapter persistence of the stream is independent of the section body being edited, so there is no write-write collision between the autosave PATCH and the stream's chapter-replace semantics. (Chapter streams replace all sections; the pre-stream autosave preserves the user's edit on the prior section's content, which the stream then overwrites — same outcome as today if they'd pressed Esc a moment before generating.)
- **Imported chapters from the Publishing Kit.** Sections loaded via import use the same `Chapter.sections` model and render through the same `SectionList` / `SectionCard`, so the new behavior applies identically. No import-specific branching.

## Testing

Four layers.

### 1. `SectionList` sticky-focus behavior — `tests/components/editor/SectionList.sticky-focus.test.tsx` (new, jsdom)

- Render a list with three mocked sections. No section is in edit mode initially.
- Simulate `mouseDown` on section B's `<p>` with specific clientX/clientY. Assert `editingSectionId === "B"` and the `SectionEditor` is rendered inside B's card only.
- Simulate `mouseDown` on section C. Assert edit state swaps to C; B's editor has unmounted; any autosave buffer for B was flushed (mock `onSaveBody`, assert it was called if buffer was dirty, not called otherwise).
- Simulate Esc inside B's editor. Assert `editingSectionId === null` and no editor is rendered.
- Flip `disableActions` to true while B is editing. Assert `editingSectionId === null`.

### 2. `SectionCard` click-through — `tests/components/editor/SectionCard.test.tsx` (mod)

- `mouseDown` on the `<p>` calls `onRequestEdit(section.id, { x, y })` with the event's clientX/clientY.
- Keyboard Enter/Space on the focused `<p>` calls `onRequestEdit(section.id, null)` — no coord.
- When `isEditing` prop is false, no `SectionEditor` is rendered (read-only `<p>` with `onMouseDown`).
- When `isEditing` prop is true, `SectionEditor` is rendered and receives the `caret` prop.

### 3. `SectionEditor` caret placement + blur — `tests/components/editor/SectionEditor.test.tsx` (mod)

- Given a `caret` prop with coordinates that map to doc position 42 (stub `editor.view.posAtCoords` to return `{ pos: 42 }`), assert `setTextSelection(42)` was called and `focus()` fired.
- Given `caret === null`, assert `focus("end")` was called.
- Blur does **not** call `onExit` (regression guard against the old behavior).
- Esc still calls `onExit`.
- Blur calls `useAutoSave.flush()` once (mocked hook).

### 4. `useAutoSave` flush API — `tests/hooks/useAutoSave.test.ts` (mod)

- Flush runs the save function with the current value if the buffer differs from the last-saved value.
- Flush is a no-op if buffer matches last-saved.
- Flush serializes behind any in-flight save.

### 5. E2E — `e2e/sticky-focus.spec.ts` (new, Playwright)

- Seed a chapter with two multi-paragraph sections via existing e2e helpers.
- Click midway into section A's prose. Type a distinctive string. Click on the right-side metadata pane (a Bible field). Assert the `SectionEditor` is still visible for section A (a `[data-testid]` or the presence of the Tiptap `ProseMirror` div inside A's card is sufficient).
- Click back into section A at a different position. Assert focus returned without requiring a second click.
- Click on section B's `<p>`. Assert section A's editor has unmounted (no `ProseMirror` inside A) and section B's editor is mounted.
- Press Esc. Assert no editor is mounted anywhere in the list.

E2E does not need to assert exact cursor offsets — jsdom / headless browsers expose enough to verify mount/unmount and visibility, which is the user-visible behavior this spec targets. Offset-precision is covered by the `SectionEditor` unit test via the `posAtCoords` stub.

## Privacy

No privacy surface change. Zero new network calls, zero new CSP origins, zero new telemetry imports, zero `.last-payload.json` writes. `tests/privacy/no-external-egress.test.ts` is **not** modified — no new routes — and is expected to continue passing unchanged (regression guard).

## Rollout

Single-release change. Pure client-side interaction refactor. No migration, no feature flag, no config knob. Existing stories, chapters, sections, and imports work without modification.

## Interaction with other features

- **Generate / regen flows.** Stream start clears edit state; autosave flushes the user's in-progress edit before the stream's first token. No write-write collision because stream persistence is server-driven chapter replacement, and the client-side PATCH from autosave completes before the stream begins writing (serialized by the `clearEditing` effect → unmount → flush → stream fetch).
- **Publishing Kit import.** Imported sections use the same model and UI; the new behavior applies identically.
- **Copy-prompt dialog** (separate feature, same date). Opens a modal that traps focus; blur of the editor leaves it mounted, so closing the modal returns to your prior cursor. No coupling.
- **Chapter title editing.** Out of scope; uses a plain input, different component path.

## Open questions

None that block v1.

- A future nice-to-have: when `pendingCaret` falls back to end-of-content, we could instead use the prior selection if one was stored on the previous blur. Would let users return to "exactly where I stopped typing" without clicking a specific word. Deferred — requires per-section selection persistence that's not needed for the stated pain points.
- Multi-chapter edit persistence (cursor preserved across chapter switches) is explicitly out of scope; revisit only if users ask.
