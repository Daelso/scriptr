# scriptr — Style Rules Design Spec

**Date:** 2026-04-20
**Author:** Chase (with Claude)
**Status:** Draft

## Summary

Add configurable **style rules** that inject voice/craft instructions into every prompt sent to Grok. Rules come from three layers: hardcoded built-ins, user globals saved in `data/config.json`, and per-story overrides saved on the Bible. The effective rule set for any generation is the merged result, shown to Grok as a numbered `# Style rules` block inside the user prompt, right before the write directive.

The goal is to suppress common AI-prose tells (em-dashes, "it wasn't X, it was Y" constructions, rhetorical narration) and give the author per-story control over tense, explicitness, and dialogue-tag discipline without rewriting the Bible's free-text notes each time.

## Goals

1. Let the user configure named style toggles once, globally, and have them apply to every story by default.
2. Let any story pin or relax an individual rule without detaching the rest from the globals.
3. Make the resulting instructions visible to the model in a consistent, low-ambiguity block — the same shape across chapter, continue, and section-regen flows.
4. Keep the Privacy Panel's promise: the user can see exactly what was sent, including style rules, by inspecting `.last-payload.json`.
5. Ship without breaking existing stories or config files (every new field optional, additive merge).

## Non-goals

- AI-driven style learning (no "analyze my other stories and infer rules").
- Per-chapter or per-scene overrides (story-level is the finest granularity).
- Runtime rule validation that rewrites Grok output if it violates a rule.
- Presets or style-pack sharing between users.
- Model-specific prompt tuning (same instruction text for all models).

## Data model

New file `lib/style.ts`:

```ts
export type StyleRules = {
  useContractions?: boolean;
  noEmDashes?: boolean;
  noSemicolons?: boolean;
  noNotXButY?: boolean;              // blocks "it wasn't X, it was Y" constructions
  noRhetoricalQuestions?: boolean;   // blocks rhetorical questions in narration
  sensoryGrounding?: boolean;        // favor concrete sensory detail
  tense?: "past" | "present";
  explicitness?: "fade" | "suggestive" | "explicit" | "graphic";
  dialogueTags?: "prefer-said" | "vary";
  customRules?: string;              // free-text addendum, appended verbatim
};

export const DEFAULT_STYLE: Required<Omit<StyleRules, "customRules">> & { customRules: string } = {
  useContractions: true,
  noEmDashes: true,
  noSemicolons: false,
  noNotXButY: true,
  noRhetoricalQuestions: true,
  sensoryGrounding: true,
  tense: "past",
  explicitness: "explicit",
  dialogueTags: "prefer-said",
  customRules: "",
};
```

Every field on `StyleRules` is optional. Undefined means "inherit from the layer below." Storage:

- **Built-ins** — `DEFAULT_STYLE` constant in `lib/style.ts`.
- **User globals** — `Config.styleDefaults?: StyleRules` in [lib/config.ts](lib/config.ts), persisted in `data/config.json` alongside existing fields. Optional in the type; undefined resolves to `{}`.
- **Per-story overrides** — `Bible.styleOverrides?: StyleRules` in [lib/types.ts](lib/types.ts), persisted on disk as part of the Bible JSON. Optional; undefined resolves to `{}`.

Resolution helper in `lib/style.ts`:

```ts
export function resolveStyleRules(config: Config, bible: Bible): Required<StyleRules> {
  const base = DEFAULT_STYLE;
  const globals = config.styleDefaults ?? {};
  const story = bible.styleOverrides ?? {};
  return { ...base, ...stripUndefined(globals), ...stripUndefined(story) };
}
```

`stripUndefined` drops `undefined` values so a bible that omits a key does not clobber a global that sets it. This is `resolveStyleRules`'s one non-obvious invariant — keys present with `undefined` would otherwise overwrite. Layer precedence (lowest to highest): built-ins → globals → story.

**Custom-rules special case.** Unlike the other fields, `customRules` concatenates rather than replaces: the effective string is `[globals.customRules, story.customRules].filter(Boolean).join("\n")`. Encoded in `resolveStyleRules`; documented inline.

## Prompt integration

New helper in `lib/style.ts`:

```ts
export function formatStyleRules(rules: Required<StyleRules>): string
```

Returns a numbered list. Toggles that match the no-op default (e.g. `useContractions: false`) are omitted. Example output when most rules are on:

```
# Style rules
1. Use contractions (I'm, don't, won't) in narration and dialogue.
2. Do not use em-dashes. Use commas, periods, or parentheses instead.
3. Avoid "it wasn't X, it was Y" constructions.
4. Avoid rhetorical questions in narration.
5. Favor concrete sensory detail over abstract emotion statements.
6. Write in past tense.
7. Explicitness: explicit — detailed physical and sensory description, no censorship or fade-outs.
8. Prefer "said" as the default dialogue tag. Vary only when the tag carries information.
9. Additional rules:
<customRules verbatim>
```

If the result would be empty (all toggles off and no customRules), `formatStyleRules` returns an empty string and the caller omits the block entirely — no orphaned header.

**Injection point.** All three generation builders in [lib/prompts.ts](lib/prompts.ts) gain one new required parameter, `style: Required<StyleRules>`, and append `formatStyleRules(style)` to the user prompt **after** the bible / recaps / beats / current-text blocks and **before** the final write directive:

- `buildChapterPrompt` — append before `"Write this chapter now. Separate scenes..."`.
- `buildContinuePrompt` — append before `"Continue writing. Separate scenes..."`.
- `buildSectionRegenPrompt` — append after the marked-scene block, before the implicit end.

`buildRecapPrompt` does **not** receive style — recaps are plot summaries, not prose. Its signature is unchanged.

**Why inside the user prompt.** Three reasons:

1. The system prompt is short and role-framing ("you are a novelist writing..."). Stuffing style rules there inflates the invariant portion of the prompt for diminishing returns.
2. Packing rules adjacent to the bible/beats context they govern keeps them in working context on long generations — the model sees constraints in the same locality as the material they apply to.
3. All three generation modes already pack their constraints into the user prompt; mode-consistent placement is easier to reason about than split system/user injection.

**Call sites.** The generate routes — [app/api/generate/route.ts](app/api/generate/route.ts) (dispatches full, continue, section modes) — call `resolveStyleRules(config, bible)` after loading the story's bible and pass the result into the prompt builders. `.last-payload.json` is unchanged in shape (`{model, mode, system, user}`); the rules block simply becomes part of `user`.

## UI

### Globals — Settings page

[components/settings/SettingsForm.tsx](components/settings/SettingsForm.tsx) gains a new section between "Generation" and "Appearance":

```
WRITING STYLE DEFAULTS
  [switch]   Use contractions                       (default: on)
  [switch]   Avoid em-dashes                        (default: on)
  [switch]   Avoid semicolons                       (default: off)
  [switch]   Avoid "it wasn't X, it was Y"          (default: on)
  [switch]   Avoid rhetorical questions in narration (default: on)
  [switch]   Favor concrete sensory detail           (default: on)
  [select]   Tense           past / present         (default: past)
  [select]   Explicitness    fade / suggestive / explicit / graphic  (default: explicit)
  [select]   Dialogue tags   prefer "said" / vary freely             (default: prefer "said")
  [textarea] Additional rules (free text)           (default: empty)
  [button]   Reset to built-in defaults
```

Saved via the existing `PUT /api/settings`. [app/api/settings/route.ts](app/api/settings/route.ts) adds `"styleDefaults"` to its `allowed` keys array. `GET /api/settings` returns `styleDefaults` alongside existing fields so the form can hydrate.

"Reset to built-in defaults" sets `styleDefaults` to `{}` (not `DEFAULT_STYLE`) so future tweaks to the built-ins propagate to users who haven't explicitly pinned values.

### Per-story overrides — Bible editor

A collapsible `<details>` block titled **"Style overrides (advanced)"** sits inside the existing Bible editor pane. Same controls as the globals form, with three differences:

1. **Switches become tri-state.** Replaced by a compact segmented control with three options: `Inherit · On · Off`. `Inherit` is the default; picking it clears the field from `styleOverrides`. The `Inherit` label shows the resolved value in parentheses ("Inherit (on)") so the user knows what they'd get.
2. **Selects get an Inherit option.** Prepended: `Inherit (<resolved value>)`. Selecting it clears the field.
3. **Custom rules are additive, not replacing.** Label: **"Additional rules (appended to global)"**. The story's `customRules` concatenates after the global's in the final prompt.

**Override indicator.** Any row where the story pins a value shows a small dot or badge next to its label so the user can see at a glance which rules deviate from globals.

**Bulk clear.** An "Inherit all" button above the controls clears `bible.styleOverrides` to `{}` in one action.

### Wire-up

- Globals form reads/writes via existing `/api/settings`.
- Per-story overrides ride along with the existing bible PUT at [app/api/stories/[slug]/bible/route.ts](app/api/stories/[slug]/bible/route.ts). That route already accepts the full Bible object, so `styleOverrides` serializes as-is without route changes.

## Defaults, migrations, privacy

### Built-in defaults

See `DEFAULT_STYLE` in the Data model section. Tuned to suppress common AI-prose tells for this use case: contractions and sensory grounding on, em-dashes and "not X, it's Y" off, past tense, explicit by default, "said" preferred.

### Migrations

- **Config.** `styleDefaults?: StyleRules` is optional and additive. Existing `data/config.json` files parse unchanged via `loadConfig`'s shallow merge with `DEFAULT_CONFIG`. Undefined `styleDefaults` resolves to `{}` and `resolveStyleRules` falls back to built-ins.
- **Bible.** `styleOverrides?: StyleRules` is optional and additive. Existing bibles on disk load unchanged. Zod validator (if one exists) gets the optional field added; otherwise no schema change is needed.

No migration script, no backfill, no breaking change for existing users.

### Privacy

The resolved style rules are part of the prompt sent to Grok. Expected and transparent. The Privacy Panel at [components/settings/PrivacyPanel.tsx](components/settings/PrivacyPanel.tsx) already renders `.last-payload.json` verbatim, so users see every style instruction that went out on the most recent generation. No new network surface, no third-party call, no additional telemetry vector.

The privacy smoke test at `tests/privacy/no-external-egress.test.ts` is unchanged — no new routes, and the feature only extends payloads on the existing generate routes (which are already on the exemption list).

## Component breakdown

Each unit has one clear job and a stable interface.

- **`lib/style.ts`** — type `StyleRules`, constant `DEFAULT_STYLE`, `resolveStyleRules(config, bible)`, `formatStyleRules(rules)`. Pure functions, no I/O, no React. Depends only on `lib/config.ts` and `lib/types.ts` types.
- **`lib/config.ts`** — add `styleDefaults?: StyleRules` to the `Config` type and `DEFAULT_CONFIG`. No behavior changes.
- **`lib/types.ts`** — add `styleOverrides?: StyleRules` to `Bible`. No other type changes.
- **`lib/prompts.ts`** — add `style: Required<StyleRules>` parameter to `buildChapterPrompt`, `buildContinuePrompt`, `buildSectionRegenPrompt`. Append `formatStyleRules(style)` inside the user string at the specified position. `buildRecapPrompt` unchanged.
- **`app/api/settings/route.ts`** — add `"styleDefaults"` to `allowed`; include it in the `GET` response.
- **`app/api/generate/route.ts`** (and the `stop`/`recap` siblings as applicable) — load config and bible, call `resolveStyleRules`, pass the result into whichever prompt builder is being invoked.
- **`components/settings/SettingsForm.tsx`** — new "Writing style defaults" section. Reads/writes `styleDefaults` via `/api/settings`.
- **New component: `components/bible/StyleOverridesSection.tsx`** — collapsible tri-state form embedded in the Bible editor. Props: `{ overrides: StyleRules, resolved: Required<StyleRules>, onChange: (next: StyleRules) => void }`. Resolves the "inherit" display text from the `resolved` prop.

The resolver (`resolveStyleRules`) and the formatter (`formatStyleRules`) are the two testable boundaries. Every other piece either reads their output or passes their input around.

## Testing

### Unit — `lib/style.ts`

`resolveStyleRules`:
- returns built-ins when config.styleDefaults and bible.styleOverrides are both absent;
- applies globals over built-ins;
- applies bible over globals;
- explicit-undefined in bible does NOT clobber global (stripUndefined invariant);
- concatenates `customRules` from both layers with a newline; either-side-empty handled;
- returned object has all required keys populated (caller never sees undefined).

`formatStyleRules`:
- empty output when no toggles diverge from their no-op default and customRules is blank;
- each toggle at its active value produces its exact instruction line (snapshot tests);
- each select value produces its exact instruction line;
- numbering is contiguous (no gaps when toggles are skipped);
- `customRules` appended verbatim, whitespace-only customRules omitted.

### Unit — `lib/prompts.ts`

For each of `buildChapterPrompt`, `buildContinuePrompt`, `buildSectionRegenPrompt`:
- asserts the rules block appears after the last story-context block;
- asserts the rules block appears before the final write directive;
- asserts the system prompt is unchanged (no rules leakage into system).

`buildRecapPrompt`:
- asserts the function signature does not accept `style`;
- no rules block ever appears in the output.

### Route — `app/api/settings/route.ts`

- `PUT` with a `styleDefaults` payload persists to `data/config.json`.
- `GET` returns `styleDefaults` alongside existing fields.
- Fields inside `styleDefaults` that aren't in `StyleRules` are passed through as-is (consistent with existing Config handling — no runtime validator).
- `PUT` with a bible containing `styleOverrides` persists round-trip (covered by existing bible route tests; add one assertion).

### Privacy smoke — `tests/privacy/no-external-egress.test.ts`

No change. The feature doesn't add routes; it extends payloads on routes that are already on the exemption list.

### E2E — `tests/e2e/golden-path.spec.ts`

No change required for the core test. **Optional follow-up**, not in scope for this spec: a Playwright spec that toggles a global style, opens a story Bible, overrides one rule, and asserts the recorded `.last-payload.json` contains the expected style line. Useful as regression coverage but not a blocker.

### Coverage targets

- Every code path in `resolveStyleRules` is exercised.
- Every toggle in `formatStyleRules` has at least one test asserting its exact output string.
- Prompt injection order (after context, before directive) is asserted in each generation mode.

## Error handling

- **Invalid enum values in stored config** (e.g. `tense: "fugue"` because a user hand-edited `data/config.json`) — `formatStyleRules` treats unknown select values the same as the default: omits the instruction. No throw. Logged at WARN via `lib/logger.ts` so the user can see the issue in the server console.
- **Missing bible.styleOverrides** — already handled: `resolveStyleRules` reads through `??`.
- **Corrupt Bible on disk** — out of scope for this feature; existing bible-loading error handling already covers it.
- **Save collision between globals and bible** — none exists; they're different files and different routes.

There is no need for runtime Zod validation of `StyleRules` at API boundaries beyond what the existing Config/Bible handling already does; shape mismatches either degrade gracefully (enum miss → skipped rule) or fail at the existing JSON parse step.

## Open questions resolved during brainstorm

| Question | Answer |
|---|---|
| Per-story vs. global? | Both. Globals + per-toggle story overrides. |
| How granular are overrides? | Per-toggle tri-state (inherit / on / off). Not a master "use custom" switch. |
| Does the new explicitness select replace the existing `nsfwPreferences` free-text on the Bible? | No. Both kept: select sets tier, free text adds specifics. |
| System prompt or user prompt? | User prompt. |
| Where in the user prompt? | After context, before the final write directive. |
| Does recap get style? | No — plot summary, style-irrelevant. |

## Appendix — instruction text

The exact strings that `formatStyleRules` emits. Kept in the design so they are reviewable before implementation; bikeshedding here is cheaper than bikeshedding in a test snapshot later.

| Toggle | State | Line |
|---|---|---|
| useContractions | true | `Use contractions (I'm, don't, won't) in narration and dialogue.` |
| useContractions | false | (omitted — no "avoid contractions" inverse) |
| noEmDashes | true | `Do not use em-dashes. Use commas, periods, or parentheses instead.` |
| noSemicolons | true | `Do not use semicolons.` |
| noNotXButY | true | `Avoid "it wasn't X, it was Y" constructions.` |
| noRhetoricalQuestions | true | `Avoid rhetorical questions in narration.` |
| sensoryGrounding | true | `Favor concrete sensory detail over abstract emotion statements.` |
| tense | past | `Write in past tense.` |
| tense | present | `Write in present tense.` |
| explicitness | fade | `Explicitness: fade-to-black — suggest intimacy, cut before physical detail.` |
| explicitness | suggestive | `Explicitness: suggestive — evocative but non-graphic; imply rather than describe.` |
| explicitness | explicit | `Explicitness: explicit — detailed physical and sensory description, no censorship or fade-outs.` |
| explicitness | graphic | `Explicitness: graphic — unflinching, anatomically specific, no euphemism.` |
| dialogueTags | prefer-said | `Prefer "said" as the default dialogue tag. Vary only when the tag carries information.` |
| dialogueTags | vary | (omitted — the no-op default from Grok's baseline training) |
| customRules | non-empty | `Additional rules:\n<verbatim string>` |
