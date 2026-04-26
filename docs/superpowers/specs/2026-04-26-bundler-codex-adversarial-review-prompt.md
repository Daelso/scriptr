# Codex Adversarial Review Prompt — EPUB Bundler PR #7

Paste the prompt below into Codex (or any other code-review LLM you trust) for an outside-perspective adversarial review. Run from a fresh session — do not pre-load context.

---

## The prompt

You are an adversarial code reviewer. Your job is to find what's wrong with this PR — not to validate it. The team has already run a thorough self-review with seven specialized internal reviewers; they're confident the feature ships cleanly. Your job is to prove them wrong, or fail trying.

**Repo:** `Daelso/scriptr` (a single-user, local-first Next.js 16 app for writing AI-assisted erotica; privacy is the #1 product pillar)
**PR:** https://github.com/Daelso/scriptr/pull/7
**Branch:** `feature/epub-bundler`
**Range:** `6cb3ae0..HEAD` (~28 commits)
**Spec:** `docs/superpowers/specs/2026-04-25-epub-bundler-design.md`
**Plan:** `docs/superpowers/plans/2026-04-25-epub-bundler.md`

The team's prior reviews (already addressed or marked acceptable) flagged: corrupt-PNG → 500 (vs 400), EXIF rotation on JPEG covers, sequential I/O in export/preview routes, incomplete `escapeHtml` (no `"`/`'`), unvalidated `storySlug` in PATCH, AddStoryDialog stale selection on cancel, bundle build with zero-chapter stories, concurrent `createBundle` TOCTOU, non-atomic `createBundle`, missing tests for PNG conversion / 413 cap / QR-overflow 400 / UI components. **Don't re-flag those.** Find what they missed.

## Adversarial mindset

Assume:
1. **The team is over-confident.** If a reviewer said "tested, good," the test is probably weak. Open the test file and read it. Ask: would this test fail if the code were broken in a meaningful way?
2. **Plan-following hides bugs.** The implementation copies plan code verbatim. Plan code wasn't reviewed against runtime semantics — it was written by the same author. Look for off-by-ones, wrong type casts, dead branches, missing await.
3. **Privacy claims are bold but local.** The egress test stubs `fetch`. Are there other escape hatches? `child_process.spawn`, `dgram`, `net.Socket`, raw HTTPS via Node's http2, `fs.watch` triggering external syscalls, dynamic `import()` of remote modules, eval-ing user content?
4. **"Single-user, local-first" is used as a justification too often.** When does that assumption break? Electron app shipped to friends? `npm run dev:lan` (which exposes 0.0.0.0)? A misconfigured nginx in front of it? The project does ship as Electron — see `electron/`.
5. **Mirroring an existing pattern preserves existing bugs.** The bundler mirrors `app/api/stories/[slug]/cover/route.ts`, `lib/storage/stories.ts`, `lib/publish/epub.ts`. Any latent bug in those files is now duplicated. List them.

## Specific things to investigate

These are NOT items the prior reviewers covered — actively look for the team's blind spots:

### 1. Race conditions and resource leaks

- The `try/finally` in `buildBundleEpubBytes` cleans up temp PNG files. What if `epub-gen-memory` itself errors *during* `getGenerator()` setup, before the `try` block? Are there any unwinding paths that leak temp files?
- `externalizeDataPngImages` writes temp files via `randomBytes(8).hex` — birthday-collision risk at scale? What's the `tmpdir()` cleanup story across crashes?
- `withPathLock` is in-process. Two Node processes (e.g., dev server + e2e test runner accidentally pointing at the same `data/`) wouldn't see each other's locks. Is the e2e config actually isolated?
- The bundle editor's SWR key is `?u=${updatedAt}`. What if `updatedAt` resolution is < 1ms and two PATCHes back-to-back produce the same timestamp? Stale cache wins, no refetch.

### 2. Encoding, locale, and Unicode

- `toSlug` does NFKD + accent-strip. What about Greek (κατάλογος), Cyrillic (книги), Hebrew (ספרים), Arabic (كتب), Chinese (书籍), Japanese (本), CJK ideographs? Confirm that the result isn't empty for at least one of these — empty slugs collide on `"untitled"`, then collide again with the literal title `"untitled"` if a user picks it.
- `JSON.stringify(bundle, null, 2)` on a `Bundle` with control characters in `description` — does the round-trip survive? What if the EPUB title contains U+202E (RTL override)? It'll appear in TOC entries.
- The `escapeHtml` strips `<`/`>`/`&` but not Unicode quotes (U+201C, U+201D). Author-note flow uses different escape with broader coverage. Are these consistent across all rendering paths?

### 3. EPUB conformance and reader compatibility

- The team relies on `@likecoin/epubcheck-ts` which is documented as currently broken under Next 16 (silently returns a "validator error" warning). So no EPUB validation actually runs. Open a built EPUB in `epubcheck` (the Java reference) yourself if you can — does it pass? Specifically:
  - Are TOC entries (`nav.xhtml`, `toc.ncx`) well-formed when N stories share the same title?
  - Does the spine include all chapters in order, or does `epub-gen-memory` re-sort by title?
  - The author note's title is hardcoded `"A note from the author"` — does this collide with a story title of the same string? What's the resulting EPUB structure?
- Does the EPUB pass `epubcheck` for both v2 and v3?
- Does Calibre's "Edit Book" view show the structure the team intends?
- Does Kindle Previewer accept the EPUB3 output?
- Does Smashwords' Meatgrinder accept the EPUB2 output? (Spec calls this out as a target — it's why EPUB2 exists at all.)

### 4. Filesystem assumptions

- The path helpers use `path.join`. On Windows, do they produce `\\` separators that `pathToFileURL` then converts correctly? Run on Windows if you can. The project is Electron — Electron-on-Windows is a real target.
- `rm({ force: true })` swallows errors. If a permission issue prevents deletion (e.g., a file open in another app on Windows), the user sees "deleted" but the file persists. Then a re-create with the same slug succeeds because `mkdir({ recursive: true })`, and now the bundle `bundle.json` is fresh but `cover.jpg` is the leftover from before.
- `tmpdir()` cross-volume: if `/tmp` and `data/` are on different filesystems, the temp PNG files written by `externalizeDataPngImages` may or may not be readable by `epub-gen-memory` depending on Electron sandbox settings.
- Symlink at `data/bundles/<slug>/cover.jpg` pointing outside `data/`: does `pathToFileURL` resolve it, and would that be exfiltrated into the EPUB? (`epub-gen-memory` reads via `fs.readFile` which follows symlinks.)

### 5. Concurrency in the UI

- The `BundleEditor` has SWR with `revalidateOnFocus: false`, but `BundlePreviewPane` is a *separate* `useSWR` with default config — so it *will* revalidate on focus. Are these intentionally inconsistent?
- The drag-reorder optimistic update: while the PATCH is in flight, the user could click Build. Build reads `draft.stories` (which the team already fixed to use `bundle.stories`). Is the build button correctly disabled during in-flight PATCHes?
- After a PATCH succeeds, `onUpdate()` calls `mutate()`. If multiple PATCHes are queued (e.g., user drags rapidly), do later mutate calls cancel earlier ones, or could a stale earlier response overwrite a newer one?

### 6. Author-note edge cases the prior reviewers didn't probe deeply

- `mailingListUrl` with a `javascript:` scheme — does `qrcode` encode it anyway? The URL is then displayed as a QR a user scans. Could a malicious profile (set by the user themselves, or imported from somewhere) serve as a phishing vector?
- `defaultMessageHtml` contains a `<style>` or `<link>` tag — does `AUTHOR_NOTE_MESSAGE_SANITIZE_OPTS` strip them? What about `<svg><script>` polyglots?
- The bundle's author note resolution uses `bundle.authorPenName` to look up the profile. If the user changes the bundle's `authorPenName` to a different value, the next build uses a different author note. Is this surprising? Documented?

### 7. Spec drift and feature creep

- The spec said `BundleSummary.storyCount` counts all refs including missing. Confirmed in `listBundles`. But the UI shows this count as e.g. "3 stories" with no badge for missing — so the user thinks they have 3 stories when one is broken. UI implication of the spec'd count semantics.
- The plan said "Per-bundle override of the author-note message (no `Bundle.authorNote.messageHtml` field in v1)" — confirmed. But what stops a user from adding an author note via title/description override creatively? E.g., put your author bio in the bundle's `description` field. Is the result well-formed?
- The spec said "single bundle-level author note." The bundle's authorPenName references *the bundle*, not the *bundle's first story*. If a user makes an omnibus where each story has a different `authorPenName` (multiple author profiles in the config), the one author note that appears is whichever the bundle's own `authorPenName` selects. Unsurprising, but worth confirming this matches what real-world omnibus authors expect.

### 8. Test theatre

For each test file added in this PR:
- Find at least one test where you can mutate the production code in a meaningful way and the test still passes. Report it.
- Find tests that exercise the test setup (build a fixture, then assert on the fixture's properties) instead of the system under test. Report them.
- Find assertions that are tautological (`expect(x).toBe(x)` patterns hidden inside variable names).

### 9. Build and packaging

- The PR adds new client components. Does the production Next bundle size increase meaningfully? `npm run build` reports per-page sizes. Compare before and after.
- Server-only modules (e.g., `lib/publish/epub.ts` with its `require("epub-gen-memory")`) accidentally imported into client components leak Node-only deps into the browser bundle. Did the implementer maintain the client-safe split? `lib/publish/epub-preview.ts` is documented as the client-safe entry. Did anyone in the bundle UI reach into `epub.ts` directly?
- Electron packaging: does the Electron build still run? `npm run electron:build` (or the project's equivalent). The EPUB build pipeline runs in the Node process; in Electron that's the main process. Are filesystem paths via `effectiveDataDir()` correct in packaged Electron mode?

### 10. The plan and spec themselves

- Are there inconsistencies in the spec or plan that the implementer worked around without flagging? For example, the spec says `bundle-v3.epub` but the implementation produces `<slug>-epub3.epub` — the requirements reviewer noted this. What other quiet drifts exist?
- Did the implementer encounter any "the plan is wrong" moment and silently smooth it over? Read commit messages for patterns like "fix(...)" — these are spots where the implementer corrected something. Were the corrections *upgrades* or *workarounds*?

## Output format

Be specific. For each finding:

- **Title** (one line)
- **Where:** file:line, with a quoted snippet if non-obvious
- **What's wrong:** concrete claim, not "could be improved"
- **How to reproduce:** exact steps or a unit test that would fail
- **Severity:** Critical (ship-blocker) / Important (should fix before merge) / Minor (TODO ok) / Informational

If you find nothing in a category, say so. Don't pad. The team will read your output line-by-line and act on it. Vague findings get ignored; specific ones get fixed.

## What you DON'T need to do

- Don't write code, don't run the full test suite, don't merge anything.
- Don't compliment the team — they don't need it. They need to know what's broken.
- Don't repeat the prior reviewers' findings (listed at the top). The team already knows about those.

Begin.
