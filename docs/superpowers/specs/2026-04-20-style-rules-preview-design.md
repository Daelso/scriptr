# scriptr — Style Rules Preview Design Spec

**Date:** 2026-04-20
**Author:** Chase (with Claude)
**Status:** Draft

## Summary

Add a live preview block to the Settings → Writing Style Defaults section that renders the exact text produced by `formatStyleRules()` as the user toggles switches and selects. The preview updates on every change and shows the same numbered `# Style rules` block that gets injected into generation prompts, so the author can see in-place how their toggle choices turn into prompt content.

This is purely presentational — no data model, API, or persistence changes. It reuses the existing `formatStyleRules()` function verbatim so the preview is always faithful to what the model actually receives.

## Goals

1. Make it obvious what each style toggle contributes to the prompt.
2. Keep the preview text in sync with real generation by calling the same `formatStyleRules()` used by `lib/prompts.ts`.
3. Encourage exploration — users can flip switches and immediately see the language change without having to generate a chapter.
4. Land in the existing narrow single-column settings layout without restructuring the page.

## Non-goals

- Previewing the full system prompt (intro, character voice, chapter context, etc.). Only the style rules block.
- Previewing Generation toggles (auto-recap, include-last-chapter) — those don't flow through `formatStyleRules`.
- A per-story override preview inside the Bible editor. Follow-up once the component exists.
- Persisting or exporting the preview text. Copy-to-clipboard only.

## UI

Inside [components/settings/SettingsForm.tsx](../../../components/settings/SettingsForm.tsx), directly below the "Additional rules" textarea and above the "Reset to built-in defaults" button within the Writing Style Defaults section.

Layout:

- Small heading: `Preview` (matches existing label sizing).
- Subtext: *"This is the style block injected into every generation prompt."*
- A `<pre>` with monospace font, `whitespace-pre-wrap`, bordered, muted background — matching the app's existing muted surfaces.
- A copy-to-clipboard icon button in the top-right corner of the preview block. On click, uses `navigator.clipboard.writeText()` and fires a `sonner` toast — matching the existing `toast.success("Settings saved")` pattern.

### Empty state

`formatStyleRules()` returns `""` when every toggle is off, tense/explicitness are unknown, dialogue tags are `"vary"`, and custom rules are empty. In that case the block renders an italic muted placeholder: *"No style rules — model will use its defaults."* The copy button is hidden in the empty state (nothing to copy). Spacing matches the non-empty state so the layout doesn't jump.

### Reactivity

The preview is a pure derivation of `form.style`:

```ts
const preview = formatStyleRules(form.style);
```

React already re-renders on every `patch({ style: ... })` call, so no `useEffect`, no local state, and no memoization is required for correctness. `formatStyleRules` is cheap (string concatenation over ~10 boolean checks); `useMemo` would add complexity without measurable benefit.

## Component boundary

Extract a presentational component `StyleRulesPreview` co-located with `SettingsForm`:

```ts
function StyleRulesPreview(props: { rules: Required<StyleRules> }): JSX.Element
```

Responsibilities:

- Call `formatStyleRules(props.rules)`.
- Render the bordered `<pre>`, heading, subtext, copy button, and empty-state placeholder.
- Nothing else — no form state, no fetching, no saving.

Kept in `components/settings/SettingsForm.tsx` alongside the existing `StyleToggle` helper unless it grows beyond ~40 lines, in which case it moves to its own file under `components/settings/`. Defaulting to co-location keeps the change small and follows the pattern already in the file.

## Data flow

```
form.style (useState in SettingsForm)
   │
   ▼
<StyleRulesPreview rules={form.style} />
   │
   ▼
formatStyleRules(rules)  ← pre-existing, unchanged
   │
   ▼
<pre>{text}</pre>
```

No new state, no new fetch, no new API route.

## Error handling

None required. `formatStyleRules` is a pure function over a typed `Required<StyleRules>` shape. `navigator.clipboard.writeText` returns a Promise — the copy handler awaits it inside a `try/catch` and fires `toast.error("Copy failed")` on rejection (for Firefox permissions edge cases). No other failure modes exist.

## Testing

Unit tests in `tests/components/settings/StyleRulesPreview.test.tsx` (new directory if none exists):

1. **Renders formatted rules.** Given a representative `Required<StyleRules>` with a mix of toggles, assert the `<pre>` contains the exact output of `formatStyleRules(rules)`.
2. **Renders empty-state placeholder.** Given all-off rules (every boolean false, tense/explicitness/dialogueTags set to values that emit nothing, empty `customRules`), assert the placeholder copy is present and the copy button is absent.
3. **Copy button invokes clipboard.** Mock `navigator.clipboard.writeText`, click the copy button, assert it was called with the rendered text.

No e2e test required — the feature has no backend and no cross-page interactions.

## Out of scope / follow-ups

- **Bible-level preview.** The Bible editor's `BibleStyleOverrides` panel resolves its own rules via `resolveStyleRules(config, bible)`. Once `StyleRulesPreview` exists, dropping it into the Bible editor is a small follow-up — but it requires access to the resolved rules, not just the overrides, which is a separate decision and not part of this change.
- **Generation toggles.** If users later want a broader "what gets added to prompts" view, it would need new formatting logic that could drift from real generation. Deferred until there's concrete demand.
