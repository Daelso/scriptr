# scriptr — Copy Prompt for Web UI Design Spec

**Date:** 2026-04-21
**Author:** Chase (with Claude)
**Status:** Draft

## Summary

Add a **Copy prompt** action to the chapter editor that exports the exact prompt scriptr would send to the Grok API for the current chapter, flattened into a single pasteable block, so the user can paste it into the Grok web UI (free) instead of paying for API access.

The feature closes the loop with the existing Publishing Kit import dialog: user sets up story + bible + chapter beats in scriptr → clicks **Copy prompt** → pastes into a Grok web UI chat → Grok generates prose → user pastes the prose back into scriptr via the Publishing Kit's import flow, which lands it as a first-class `Chapter`.

No new network surface. The prompt is built server-side by the same prompt builder that feeds the API, so "what the user pastes" and "what scriptr would have sent" are byte-for-byte identical by construction.

## Goals

1. Let a user produce the exact full-chapter prompt scriptr would send to the Grok API for any chapter, and copy it to the clipboard as one pasteable block.
2. Keep the exported prompt identical to the API-mode prompt — no divergent wording, no format drift.
3. Surface meta about what the prompt contains (which chapter, how many prior recaps, whether last-chapter full text is included, which model) so the user can catch misconfigured inputs *before* pasting.
4. Preserve the privacy pillar: the export path adds zero outbound network calls and no new `connect-src` origins.
5. Ship without regressing any existing generation behavior. The one refactor to `app/api/generate/route.ts::handleFull` must produce byte-identical `.last-payload.json` output.

## Non-goals

- Section-regen prompt export (section regen requires already-generated prose to operate on — the user won't have that if they're using the web UI instead of the API).
- Continue-mode prompt export (same reason).
- A "chat-shaped" rewrite of the prompt that diverges from the API prompt (considered and rejected: the value of "exact same prompt" is that it's a known, testable artifact; a diverged format adds debugging surface without clear benefit).
- A live-updating prompt-preview panel inside the editor (deferred; the modal is sufficient for v1).
- A dedicated `/prompt` route or page.
- Reusing `.last-payload.json` for the export (the file records what *was sent*; a locally-copied-but-never-sent prompt must not pollute that audit trail).
- Token counts via a real tokenizer (rough character-based estimate only; accurate tokenization is out of scope).
- Export UI for imported chapters with empty recaps (documented as a minor cosmetic issue; fix deferred).

## Architecture

One new module, one new API route, one new UI component, one targeted refactor of the generate route.

```
Editor toolbar
  "Copy prompt" button (next to Generate)
    → opens CopyPromptDialog
       → GET /api/stories/[slug]/chapters/[id]/prompt
          → lib/prompt-assembly.ts::assembleChapterPrompt()   [NEW — shared helper]
          → lib/prompts.ts::buildChapterPrompt()              [existing, unchanged]
          → returns { system, user, meta }
       → modal renders concatenated preview + Copy button
          → writes `${system}\n\n${user}` to clipboard
          → toast "Prompt copied"

Refactor (same PR):
  app/api/generate/route.ts::handleFull()
    → calls assembleChapterPrompt() instead of inlining priorRecaps / lastChapterFullText assembly
    → behavior unchanged (proven by existing generate tests + byte-for-byte guardrail)
```

Files touched:

| Change | Path | Approx LOC |
|---|---|---|
| NEW | `lib/prompt-assembly.ts` | ~60 |
| NEW | `app/api/stories/[slug]/chapters/[id]/prompt/route.ts` | ~30 |
| NEW | `components/editor/CopyPromptDialog.tsx` | ~120 |
| MOD | `app/api/generate/route.ts` (`handleFull` only; lines ~240-275) | -25 / +3 |
| MOD | chapter editor component — new button + dialog state | +10 |
| MOD | `tests/privacy/no-external-egress.test.ts` — new route entry | +8 |
| NEW | `tests/lib/prompt-assembly.test.ts` | ~100 |
| NEW | `tests/api/stories/chapters/prompt.test.ts` | ~80 |
| NEW | `tests/components/editor/CopyPromptDialog.test.tsx` | ~100 |
| NEW | `e2e/copy-prompt.spec.ts` | ~50 |

Zero new runtime dependencies. Zero new CSP origins. Zero new egress surface.

## Data model

No changes. `Chapter`, `Story`, `Bible`, `Config` are all used as-is. No new fields, no migrations.

## The shared helper: `lib/prompt-assembly.ts`

Server-only module (imports `@/lib/storage/*`). Single export is the assembly function plus three typed error classes.

```ts
import type { PromptPair } from "@/lib/prompts";

export class StoryNotFoundError extends Error {}
export class BibleNotFoundError extends Error {}
export class ChapterNotFoundError extends Error {}

export type AssembledPromptMeta = {
  chapterIndex: number;            // 1-based position within the story
  priorRecapCount: number;         // how many prior chapters contributed recaps
  includesLastChapterFullText: boolean;
  model: string;                   // story.modelOverride ?? config.defaultModel
};

export type AssembledPrompt = PromptPair & { meta: AssembledPromptMeta };

/** Reads story / bible / chapter / config from disk, assembles priorRecaps
 *  and lastChapterFullText, calls buildChapterPrompt, returns the full prompt
 *  plus metadata describing what went in. Single source of truth for
 *  "what would scriptr send to Grok for this chapter's full-chapter prompt?" */
export async function assembleChapterPrompt(
  dataDir: string,
  storySlug: string,
  chapterId: string
): Promise<AssembledPrompt>;
```

Behavior:

- Loads story, bible, chapter, and config. Throws the corresponding `*NotFoundError` if any of the first three is missing.
- Computes `chapterIndex` via `listChapters(dataDir, slug).findIndex(c => c.id === chapterId)`. Throws `ChapterNotFoundError` if -1.
- Builds `priorRecaps` as chapters 0..chapterIndex-1 mapped to `{ chapterIndex: i+1, recap: c.recap }`. Identical to the current inlined logic in the generate route.
- Builds `lastChapterFullText` from `chapters[chapterIndex-1]` iff `config.includeLastChapterFullText && chapterIndex > 0`. Identical to the current inlined logic.
- Calls `buildChapterPrompt({ story, bible, priorRecaps, chapter, includeLastChapterFullText, lastChapterFullText, style: resolveStyleRules(config, bible) })`.
- Returns `{ system, user, meta }` where meta fields are populated along the way.

The generate route's `handleFull` is refactored to call this helper. `handleSection` and `handleContinue` are **not** touched — they build different prompts with different inputs, and this spec is full-chapter only.

**`handleFull` refactor shape.** `handleFull` currently does three sequential pre-checks (`if (!story) return json400("story not found")`, same for bible and chapter) before inlining the priorRecaps assembly. After the refactor, those pre-checks are **removed** in favor of a single `try { const prompt = await assembleChapterPrompt(...) } catch (e) { … }` block that maps the helper's typed errors back to `json400(...)` with the *same error strings and the same HTTP 400 status* that the pre-checks currently emit. This avoids double disk reads (the helper and the route would otherwise each load story/bible/chapter) and keeps the response body byte-identical — preserving the `.last-payload.json` guardrail's usefulness. Note: the new GET prompt route uses `fail(..., 404)` for these, which is the right choice for a read-only endpoint; the generate route's historical 400 is preserved here intentionally, not as an inconsistency.

**No API key dependency.** `assembleChapterPrompt` does not read, validate, or require `XAI_API_KEY`. The feature must work on a machine with zero Grok credentials configured — that's the whole point.

**Why a new module instead of adding to `lib/prompts.ts`:** `lib/prompts.ts` is pure (no Node-only deps) and imported anywhere; adding storage reads to it would break that. Keeping the pure layer pure.

## The API route: `GET /api/stories/[slug]/chapters/[id]/prompt`

File: `app/api/stories/[slug]/chapters/[id]/prompt/route.ts` (sibling to the existing chapter route).

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

Method: **GET**. Read-only, idempotent, no state mutation.

Response shape (success):

```json
{
  "ok": true,
  "data": {
    "system": "You are a novelist writing the next chapter of …",
    "user": "# Story bible\n…\n\n# Prior chapter recaps\n…\n\n# Current chapter: …",
    "meta": {
      "chapterIndex": 3,
      "priorRecapCount": 2,
      "includesLastChapterFullText": false,
      "model": "grok-4-fast-reasoning"
    }
  }
}
```

Error shapes:

- `404 {"ok": false, "error": "story not found"}`
- `404 {"ok": false, "error": "bible not found"}`
- `404 {"ok": false, "error": "chapter not found"}`

No `Cache-Control` header. Scriptr is single-user, the data is private, and the user may edit beats between paste attempts — always-fresh is correct.

## UI: `CopyPromptDialog`

`components/editor/CopyPromptDialog.tsx`. shadcn `Dialog` + `ScrollArea` + `Button`. Local state only; no zustand additions.

### Trigger

A new `Copy prompt` button in the chapter editor's existing action row, rendered next to the Generate button. Icon: `Clipboard` from lucide-react. Available always — no exclusivity constraint with in-flight generation.

### States

- **Loading.** Small spinner + "Building prompt…". Fires on dialog open.
- **Error.** Destructive alert showing `data.error` text; `Retry` button that re-fires the fetch.
- **Success.** Renders three regions:
  1. **Meta strip** at top:
     `Chapter 3 · 2 prior recaps · last-chapter full text: off · model: grok-4-fast-reasoning`
     Lets the user catch misconfigurations (empty recap, wrong model) before pasting.
  2. **Preview pane.** `ScrollArea`, monospace font, renders `${system}\n\n${user}` as plain text. No markdown rendering — the user must see exactly what they'll paste. Text is selectable.
  3. **Footer.** `Copy` (primary) + `Close` (ghost). Below the preview, a small line `~${text.length} chars · ~${Math.ceil(text.length/4)} tokens (rough)` to flag over-long prompts. The "rough" label is deliberate — this is not a tokenizer, just chars/4, and the UI must not imply otherwise.

### Copy behavior

Primary path: `navigator.clipboard.writeText(\`${system}\n\n${user}\`)` → toast "Prompt copied" (uses existing sonner integration).

Fallback path: if `writeText` rejects (permission denied, insecure context), the preview text is focused and a toast reads "Select and copy manually (Cmd/Ctrl+C)". No crash.

### No store changes

Dialog-local `useState({ status, data, error })`; a plain `async function handleOpen()` to fire the fetch. No new zustand slice, no new hook file, no SWR integration (one-shot fetches per open are correct since the user is likely to be editing between opens).

## Privacy

The privacy surface is extended minimally and with explicit proofs.

1. **No new network origins.** The route reads files, calls pure functions, returns a JSON envelope. CSP `connect-src 'self' https://api.x.ai` stays as-is.
2. **No new telemetry.** No Sentry/PostHog/etc imports. The existing `scriptr/no-telemetry` ESLint rule continues to block such imports.
3. **No `.last-payload.json` writes.** The export route does *not* touch that file. Its contract ("this is the last thing that left your machine") must not be diluted by locally-copied-but-unsent prompts.
4. **Egress test extended.** `tests/privacy/no-external-egress.test.ts` gets one new entry that invokes the new route's `GET` handler and asserts `fetch` was never called. If anyone wires a network call into `assembleChapterPrompt` or the new route, this test fails immediately.
5. **Logger.** No request/response payloads are logged from this path; redaction rules are not relevant.

## Testing

Four layers. All run under `npm test` except e2e which runs under `npm run e2e` with its isolated `/tmp/scriptr-e2e` data dir.

### 1. Helper unit tests — `tests/lib/prompt-assembly.test.ts` (new)

- Chapter 1 → `priorRecaps: []`, `meta.chapterIndex: 1`, `meta.priorRecapCount: 0`.
- Chapter N (N>1) → priorRecaps are chapters 1..N-1 with 1-based `chapterIndex` field.
- `config.includeLastChapterFullText: true` → prompt contains the prior chapter's prose, `meta.includesLastChapterFullText: true`.
- `meta.model` resolves as `story.modelOverride ?? config.defaultModel`.
- Throws `StoryNotFoundError`, `BibleNotFoundError`, `ChapterNotFoundError` appropriately.
- **Byte-for-byte guardrail.** Fixture: assemble a prompt via the helper, then call `buildChapterPrompt` directly with the same underlying inputs; assert the two `{system, user}` pairs are identical. Locks the helper to "extract without transform."

### 2. Refactor regression guard — existing generate tests

`tests/api/generate.test.ts` must continue to pass unchanged. Existing assertions on `.last-payload.json` contents catch any byte-level drift introduced by the `handleFull` refactor. Do not add new assertions; rely on the existing coverage to prove equivalence.

### 3. Route tests — `tests/api/stories/chapters/prompt.test.ts` (new)

- 200 with `{ok: true, data: {system, user, meta}}` on happy path.
- 404 `"chapter not found"` when chapter id unknown.
- 404 `"story not found"` when slug unknown.
- 404 `"bible not found"` when `bible.json` deleted.
- Response does not leak anything outside the documented shape (no bible dump, no config leak).

### 4. Privacy egress test — `tests/privacy/no-external-egress.test.ts` (mod)

One new entry that invokes the new `GET` handler with valid fixtures. Existing `expect(recorded).toEqual([])` assertion stays. Proves zero outbound calls.

### 5. Component test — `tests/components/editor/CopyPromptDialog.test.tsx` (new, jsdom)

- Mounts, fetch is called once, loading state renders.
- On resolve, preview renders `${system}\n\n${user}`; meta strip shows correct values.
- Copy button calls `navigator.clipboard.writeText` with exactly `${system}\n\n${user}` and fires toast.
- Clipboard rejection → fallback message, no crash.
- Fetch error → destructive alert + functional Retry button.

### 6. E2E — `e2e/copy-prompt.spec.ts` (new, Playwright)

- Seed: story + bible + 2 chapters via scriptr's API (existing e2e helpers).
- Open chapter 2 editor, click **Copy prompt**, assert dialog opens and preview contains `# Story bible`, `# Prior chapter recaps`, `# Current chapter: `.
- Click **Copy**, assert a toast appears. The assertion should accept **either** the success toast ("Prompt copied") or the fallback toast ("Select and copy manually…") — Chromium's clipboard behavior under Playwright is permission-dependent, and this feature treats both paths as acceptable outcomes.
- Do **not** assert clipboard contents in e2e — Playwright's clipboard API requires flaky permission grants, and the component test already covers the clipboard write path.

## Rollout

Single-release change, no migration. Every new field and file is additive. Existing stories, chapters, configs continue to work without modification. No feature flag (scriptr is single-user, local-first — flagging local UI features is over-engineering).

## Interaction with other features

- **Publishing Kit (import dialog).** This feature is the outbound half of the round-trip; the Publishing Kit's import dialog is the inbound half. No code coupling between them in v1. A future nice-to-have: a subtle "Paste prose back via Import →" link in the Copy prompt dialog's success footer. Out of scope for v1; file a follow-up when both have shipped.
- **Privacy panel** (`.last-payload.json` viewer). Complementary, not overlapping. Privacy panel shows what *was* sent. Copy prompt shows what *would be* sent. They answer different questions; no unification in v1.
- **Style rules.** `resolveStyleRules(config, bible)` is called by the helper exactly as by the generate route. Any style-rule change to one path flows to the other by construction.

## Open questions

None that block v1. Documented as known cosmetic issue: imported chapters with empty `recap` strings render as `Ch.N — ` in the prior-recaps block of the exported prompt. Same behavior as the existing API path — this feature inherits it rather than introducing it. Fix deferred; track as follow-up.
