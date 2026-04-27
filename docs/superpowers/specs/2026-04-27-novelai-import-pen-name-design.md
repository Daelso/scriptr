# scriptr — NovelAI Import Pen-Name Picker Design Spec

**Date:** 2026-04-27
**Author:** Chase (with Claude)
**Status:** Draft

## Summary

The NovelAI import flow currently lands every new story with `authorPenName: ""`, because [components/import/NewStoryFromNovelAIDialog.tsx](../../../components/import/NewStoryFromNovelAIDialog.tsx)'s `MetadataFields` only edits title/description/keywords, and [app/api/import/novelai/commit/route.ts](../../../app/api/import/novelai/commit/route.ts) never threads a pen name into `createStory`. The empty pen name then disables the per-story Author Note toggle in the editor (the toggle is gated on `settings.penNameProfiles?.[story.authorPenName]` resolving to a profile), so users can't enable the "A note from the author" EPUB section without first navigating to the publish page to set a pen name.

This spec adds an "Author pen name" field to the NovelAI new-story import dialog. When the user has saved pen-name profiles, the field is a `<select>` listing them plus a "Custom…" sentinel that swaps in a free-text input. When the user has zero profiles, the field is a plain `<Input>` with a helper line linking to settings. Auto-selects the only profile when exactly one exists. Wires `authorPenName` through the commit payload so `createStory` receives it and the story file ships with the right pen name on first write.

No storage changes — `createStory` already accepts an optional `authorPenName` at [lib/storage/stories.ts:8](../../../lib/storage/stories.ts#L8).

## Goals

1. Let the user set `authorPenName` during NovelAI import without leaving the dialog.
2. Surface saved pen-name profiles so picking one guarantees the editor's Author Note toggle becomes operative on the first visit to the new story.
3. Preserve the existing freeform behavior — a user who hasn't set up profiles (or who wants a one-off pen name) can still type any string.
4. Keep the change additive: zero behavior change for stories already on disk; zero change to the existing-story import path; `authorPenName` remains optional in the commit payload so the API stays backwards-compatible.

## Non-goals

- Adding a pen-name field to [components/import/AddChaptersFromNovelAIDialog.tsx](../../../components/import/AddChaptersFromNovelAIDialog.tsx). That dialog's target is an existing story whose pen name is already set; mutating it from a "add chapters" flow would be surprising.
- Inline profile creation from the import dialog. Users without profiles get a link to `/settings`; they don't get a "create profile" form embedded in the dialog.
- A "default pen-name profile" concept in `data/config.json`. Auto-selecting the only profile is a UI convenience; no new config field.
- Combobox-style hybrid (text input with autocomplete dropdown). Was option (c) in brainstorming; rejected to keep the change small and avoid pulling in a combobox primitive that doesn't exist in the current shadcn/ui surface.
- A "missing profile" warning during import when the typed pen name doesn't match any profile. The Author Note card in the editor's metadata pane already displays this state; duplicating it during import would be noise.
- Bulk apply across multi-story imports. Each `StoryCardBody` gets its own picker; users with `////`-separated multi-story files re-pick per card. Small N in practice.
- Migration of existing stories. The empty-pen-name story already on disk (`sorority-sissification-emily-ascendant`) stays as-is; the user can fix it via the existing `ExportPage` pen-name input.

## Architecture

One new presentational component, one extension to the dialog's per-story state, one extension to the commit payload + route validator. No new dependencies.

```
NewStoryFromNovelAIDialog
  ├ useSWR<SettingsLite>('/api/settings')          ◄── read pen-name profiles
  ├ StoryFormState { …, authorPenName: string }
  └ MetadataFields
      └ <PenNamePicker                             ◄── new component
          profiles={settings.penNameProfiles}
          value={story.authorPenName}
          onChange={(name) => onChange({ authorPenName: name })}
        />
            ├ profiles ≥ 1 → <select> + "Custom…" sentinel
            └ profiles = 0 → <Input> + helper

Commit POST /api/import/novelai/commit
  body.stories[i].story.authorPenName?: string     ◄── new optional field
    └► createStory(dataDir, { title, authorPenName }) ◄── already supported
```

### Data model

No `Story` shape change. `createStory` at [lib/storage/stories.ts:8](../../../lib/storage/stories.ts#L8) already accepts `{ title: string; authorPenName?: string }` and writes the field directly into `story.json`.

The dialog's per-story state grows by one string:

```ts
type StoryFormState = {
  title: string;
  description: string;
  keywords: string;
  authorPenName: string;       // new — defaults per init rule below
  chapters: ProposedChapter[];
  bible: Bible;
  splitSource: StoryProposal["split"]["splitSource"];
};
```

The commit `CommitRequest` for `target: "new-story"` grows by one optional string per entry:

```ts
type NewStoryEntry = {
  story: {
    title: string;
    description: string;
    keywords: string[];
    authorPenName?: string;    // new — optional, validates as string when present
  };
  bible: Bible;
  chapters: ProposedChapter[];
};
```

Optional rather than required so that older clients (e.g. a curl smoke-test predating this change) keep working.

### Component contract — `PenNamePicker`

New file: `components/import/PenNamePicker.tsx`. Self-contained. No SWR inside — the parent dialog owns the settings fetch and passes profiles in as a prop, so the picker stays trivially testable.

```ts
type Props = {
  /** Profile map from /api/settings. `undefined` while loading. */
  profiles: Record<string, PenNameProfile> | undefined;
  /** Current pen name on the parent's StoryFormState. */
  value: string;
  /** Emits the new pen name string. Empty string is allowed. */
  onChange: (next: string) => void;
};
```

Internal mode state (`"saved" | "custom"`) is derived on first render from the props (`value` matches a profile key → `"saved"`, otherwise → `"custom"` if `value` is non-empty, otherwise `"saved"` with placeholder selection). The mode is then held in a `useState` so the picker doesn't toggle back and forth as the user types.

A "Use saved profile" link in `"custom"` mode resets back to `"saved"`. Picking the "Custom…" `<option>` switches to `"custom"`.

The `<select>` placeholder (`"Choose pen name…"`) is rendered as a disabled `<option value="">` so HTML's native required-ish behavior surfaces sensibly, even though we don't enforce non-empty pen names (matching the rest of the codebase). The placeholder is only the selected option at mount time when no profile matches `value`; it is **not user-reachable** after the user picks anything (the `<select>`'s disabled placeholder cannot be re-selected). The only way `value` becomes `""` post-init is `Custom… → typing → clearing the input`.

### Defaulting & init rules

In `toForm(s: StoryProposal, profiles)`:

- If `Object.keys(profiles ?? {}).length === 1`, initial `authorPenName` is that single key.
- Otherwise, initial `authorPenName` is `""`.

`toForm` is currently called once on parse-success. Settings load via SWR may resolve before or after parse. To keep init deterministic without re-running `toForm` on settings load:

- Pass the resolved profiles (or `undefined`) into `toForm` at the moment `setStories(...)` runs.
- If profiles are still loading at that moment (`undefined`), default to `""`. The user can pick when the dropdown populates a render later.

**Documented tradeoff (do not "fix" during implementation):** we intentionally do *not* add a `useEffect` that retro-fills `authorPenName` after `toForm` has already run with `profiles === undefined`. That would deliver Goal 2 more aggressively, but at the cost of mutating user-visible state asynchronously after the dialog has rendered, which is hard to reason about (e.g. did the user mean to leave it blank? did they start typing during the resolve window?). Race window is sub-100 ms in practice — `/api/settings` is a local file read — so the simpler rule is acceptable. If this turns out to bite, revisit in a follow-up spec.

### Commit payload & route validation

In [app/api/import/novelai/commit/route.ts](../../../app/api/import/novelai/commit/route.ts), the `handleNewStory` validator gains:

```ts
if (s.story.authorPenName !== undefined && typeof s.story.authorPenName !== "string") {
  return fail(.../* "authorPenName must be a string" */, 400);
}
```

…and the `createStory` call becomes:

```ts
const story = await createStory(dataDir, {
  title: entry.story.title,
  authorPenName: entry.story.authorPenName,  // undefined → defaults to "" inside createStory
});
```

The follow-up `updateStory` call (which sets description + keywords) is unchanged — no need to PATCH the pen name twice.

### Settings fetch in the dialog

The dialog gains:

```ts
const { data: settings } = useSWR<SettingsLite>(
  "/api/settings",
  jsonFetcher,
  { revalidateOnFocus: false },
);
```

`SettingsLite` and `jsonFetcher` are currently inlined in [components/editor/MetadataPane.tsx](../../../components/editor/MetadataPane.tsx). The dialog duplicates them locally — they're 6 LOC each, and the existing codebase already has both inlined. Hoisting them is out of scope for this spec; the `simplify` skill can reconcile in a separate cleanup if it surfaces.

The dialog renders the picker even before settings resolve (passing `profiles={undefined}`), which the picker handles by falling back to the no-profiles plain-input branch. This avoids a layout-shift between "loading…" and the picker.

## Privacy

No new outbound network calls. The settings GET is local; pen-name profiles are stored in `data/config.json`. The egress test at [tests/privacy/no-external-egress.test.ts](../../../tests/privacy/no-external-egress.test.ts) already covers `/api/settings` and `/api/import/novelai/commit` — no extension needed.

The commit payload now contains a (potentially identifying) author pen name. This is fine: pen names already round-trip via `/api/stories/[slug]` PATCH and the export page; the import path is not creating a new exfiltration surface.

## Testing

### Unit / component (vitest, jsdom)

New file `tests/components/import/PenNamePicker.test.tsx`:

- Renders `<select>` listing every profile key when `profiles` has ≥1 entries.
- Picking a profile fires `onChange(profileKey)`.
- Picking "Custom…" reveals an `<input>` and fires `onChange("")` initially.
- Typing into the custom input fires `onChange(typedValue)` per keystroke.
- Renders plain `<input>` + helper text when `profiles` is `{}` or `undefined`.
- `value` matching a profile key → mounts in `"saved"` mode.
- `value` non-empty and not matching any key → mounts in `"custom"` mode.

### Integration (vitest, node)

Extend [tests/api/import-novelai.commit.test.ts](../../../tests/api/import-novelai.commit.test.ts) (file confirmed to exist at design time — alongside `import-novelai.commit-rollback.test.ts` and `import-novelai.commit-existing-rollback.test.ts`):

- POST `target: "new-story"` with `story.authorPenName: "Sarah Thorne"` → created `story.json` has that pen name.
- POST without `authorPenName` → created story has `authorPenName: ""` (regression guard for backwards-compat).
- POST with `authorPenName: 42` → 400 with the specific error string.

### Init-rule unit (vitest, node)

A focused test on `toForm` (extracted from the dialog file or tested via export depending on what's cleanest at implementation time):

- `toForm(parsed, { "Sarah Thorne": {...} })` → `result.authorPenName === "Sarah Thorne"`.
- `toForm(parsed, { "Sarah Thorne": {...}, "Natalie Knot": {...} })` → `result.authorPenName === ""`.
- `toForm(parsed, undefined)` → `result.authorPenName === ""`.
- `toForm(parsed, {})` → `result.authorPenName === ""`.

### Dialog integration (vitest, jsdom)

Optional but cheap: extend the existing `NewStoryFromNovelAIDialog` test (if one exists; otherwise skip) with a flow that mocks `/api/settings` + `/api/import/novelai/parse`, types into the picker, hits Commit, and asserts the POSTed payload includes `authorPenName`.

### E2E (Playwright)

No new e2e. The existing NovelAI import e2e (if any) covers the happy path; pen name is additive and a vitest+component combo gives sufficient coverage. Adding an e2e here would require fixture profiles in `data/config.json` and a settings-API roundtrip — not worth the runtime tax.

## Rollout / migration

None. Behavior is purely additive:
- Existing stories on disk are untouched.
- Existing imports (without the new field) keep working — the API field is optional.
- The `AddChaptersFromNovelAIDialog` flow is unchanged.

## Open questions

None at design time. Two assumptions made by default in brainstorming, both endorsed by the user:

1. Auto-select when exactly one profile exists (not "auto-select the most-recently-used" or similar — there's no notion of recency in the current config).
2. No "missing profile" warning when typed pen name doesn't match a saved profile. The Author Note card in the editor surfaces this state already.

## Files touched

- `components/import/NewStoryFromNovelAIDialog.tsx` — extend `StoryFormState`, render `<PenNamePicker>`, fetch settings via SWR, include `authorPenName` in commit payload.
- `components/import/PenNamePicker.tsx` — **new**, presentational picker.
- `app/api/import/novelai/commit/route.ts` — accept and validate optional `story.authorPenName`, pass to `createStory`.
- `tests/components/import/PenNamePicker.test.tsx` — **new**.
- `tests/api/import-novelai.commit.test.ts` (or equivalent) — extend with three pen-name assertions.
