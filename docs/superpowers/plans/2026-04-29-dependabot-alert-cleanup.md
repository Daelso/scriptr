# Dependabot Alert Cleanup Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all 26 open dependabot alerts (1 direct + 3 transitive packages) without regressing EPUB export, packaged-Electron startup, or auto-updates.

**Architecture:** Five sequential PRs in increasing blast-radius order so a regression in late phases doesn't force rollback of earlier wins. Phase 0 captures a verifiable baseline. Phase 1 closes 9 alerts via `npm overrides` (zero direct version bumps). Phase 2 bumps `electron-builder` (packaging tooling). Phase 3a bumps Electron 33→38, then 3b 38→39, splitting the major-version risk in two so we can bisect cleanly. Each phase requires a manual EPUB-export smoke test on the packaged Windows build because that's where the historical regressions hide.

**Tech Stack:** npm `overrides`, Electron 38/39, electron-builder 26, sharp 0.34, epub-gen-memory, Next.js 16.

**Alert Inventory (verify with `gh api repos/:owner/:repo/dependabot/alerts --jq '.[] | select(.state==\"open\")'` before starting):**

| Pkg | Type | Alerts | Current | Target | Phase |
|-----|------|--------|---------|--------|-------|
| `electron` | direct | 16 (3 high, 11 med, 2 low) | `^33.4.11` | `^39.8.6` | 3a→3b |
| `tar` | transitive (electron-builder→…) | 7 (all high) | `6.2.1` | `^7.5.11` | 1 |
| `postcss` | transitive (next bundled) | 1 (med) | `8.4.31` (one path) | `^8.5.10` | 1 |
| `@tootallnate/once` | transitive (electron-builder→…) | 1 (low) | `2.0.0` | `^3.0.1` | 1 |

**Out of scope:** Routine non-alert minor bumps (sharp, next, react, vitest, openai). Tackle separately — do not bundle into security PRs.

**Worktree note:** Each phase below should be executed in its own git worktree per [@AGENTS.md](AGENTS.md). Subagent prompts must include the full absolute worktree path.

---

## Chunk 1: Phase 0 — Baseline & Verification Harness

### Task 0.1: Snapshot the alert state and lockfile

**Files:**
- Create: `docs/superpowers/plans/2026-04-29-dependabot-cleanup-baseline.md` (working notes — do not commit unless still useful at end)

- [ ] **Step 1: Snapshot open alerts**

```bash
gh api repos/:owner/:repo/dependabot/alerts \
  --jq '.[] | select(.state=="open") | {number, severity: .security_advisory.severity, package: .dependency.package.name, patched: .security_vulnerability.first_patched_version.identifier}' \
  > /tmp/scriptr-alerts-before.json
wc -l /tmp/scriptr-alerts-before.json
```

Expected: 26 lines (one per open alert).

- [ ] **Step 2: Snapshot resolved transitive versions**

```bash
npm ls electron electron-builder tar postcss @tootallnate/once --all 2>&1 \
  | tee /tmp/scriptr-deps-before.txt
```

Expected output records `electron@33.4.11`, `electron-builder@25.1.8`, `tar@6.2.1`, `postcss@8.5.10`+`8.4.31`, `@tootallnate/once@2.0.0`. Keep this file — Phase 4 diffs against it.

- [ ] **Step 3: Run the full quality gate to record green baseline**

```bash
npm run lint && npm run typecheck && npm test
```

Expected: All pass. If any fail, STOP — fix on a separate branch first; you cannot tell whether a later failure is caused by a dep bump if the baseline is red.

### Task 0.2: Document the EPUB export smoke test

**Why this matters:** Per [CLAUDE.md](CLAUDE.md#L52) and memory, EPUB export is the most regression-prone path because it spans sharp (libvips DLLs on Windows), epub-gen-memory's `file://` cover path requirement, and any jsdom-pulling deps. The unit/e2e suites do *not* exercise the packaged-app code path.

**Files:**
- Create: `docs/superpowers/plans/2026-04-29-dependabot-smoke-checklist.md`

- [ ] **Step 1: Write the smoke checklist**

Content:

```markdown
# EPUB Export Smoke Checklist (run after each phase ships)

## Web build (`npm run dev`)
1. Create a story with 2 chapters, each with 2 sections.
2. Set a cover image via the cover uploader.
3. Configure a pen-name profile with author note + QR link.
4. Export EPUB3 → open in Apple Books or Calibre. Verify cover renders.
5. Export EPUB2 → open in Calibre. Verify cover + author-note QR image.
6. Confirm `data/stories/<slug>/exports/<file>.epub` is non-zero bytes (cover regression sentinel).

## Packaged Electron build (`npm run package:electron`)
1. Build on Windows (or in a Win VM): `npm run package:electron`.
2. Install/run the packaged exe. Open a story.
3. Repeat the EPUB3 + EPUB2 export above.
4. Confirm sharp doesn't throw `ERR_DLOPEN_FAILED` (libvips DLL regression sentinel).
5. Trigger an auto-update check (or stub one) and confirm the update controller logs to disk.

## Tripwires
- 0-byte EPUB → `epub-gen-memory` cover-path regression (memory: feedback_epub_cover_path).
- `Cannot find module '@asamuzakjp/css-color'` or similar ESM-in-require error → a dep started pulling jsdom (memory: feedback_jsdom_esm_chain_in_electron). `grep -r jsdom node_modules/.../package.json` to find the offender.
- `dlopen failed` for sharp on Windows → libvips DLL trace regression (memory: feedback_sharp_dll_tracing). Confirm `next.config.ts` `outputFileTracingIncludes` glob still matches.
```

- [ ] **Step 2: Commit Phase 0 artifacts (smoke checklist only — keep the alert snapshot in /tmp)**

```bash
git checkout -b chore/deps-phase-0-baseline
git add docs/superpowers/plans/2026-04-29-dependabot-cleanup-baseline.md \
        docs/superpowers/plans/2026-04-29-dependabot-smoke-checklist.md
git commit -m "docs(deps): baseline + smoke checklist for dependabot cleanup"
```

Open as PR #phase-0 — small, mergeable independently of subsequent phases.

---

## Chunk 2: Phase 1 — Transitive Overrides (closes 9 alerts)

### Task 1.1: Add npm overrides for tar, postcss, @tootallnate/once

**Files:**
- Modify: `package.json` (add `overrides` block after `devDependencies`)

**Why overrides instead of waiting for upstream:**
- `electron-builder@26.8.1` (latest) still declares `tar: ^6.1.12` — bumping the parent does NOT close the tar alerts.
- `next@16.2.4` ships its own bundled `postcss@8.4.31`; bumping next would also bring unrelated change.
- `@tootallnate/once` is two transitive levels deep under `node-gyp`, only used during native rebuild — safe to force.

- [ ] **Step 1: Add the overrides block**

Insert into `package.json` immediately after the `devDependencies` block:

```json
"overrides": {
  "tar": "^7.5.11",
  "postcss": "^8.5.10",
  "@tootallnate/once": "^3.0.1"
}
```

- [ ] **Step 2: Reinstall and verify the overrides resolved**

```bash
rm -rf node_modules package-lock.json
npm install
npm ls tar postcss @tootallnate/once --all 2>&1 | tee /tmp/scriptr-deps-phase1.txt
```

Expected: `tar@7.5.11+`, `postcss@8.5.10+` (no more 8.4.31 path), `@tootallnate/once@3.0.1+`. If any path still resolves to the old version, the override syntax is wrong — fix before continuing.

- [ ] **Step 3: Run the full quality gate**

```bash
npm run lint && npm run typecheck && npm test && npm run e2e
```

Expected: All pass. The tar 6→7 jump is the riskiest here; node-gyp uses tar to extract native module tarballs during `electron-builder install-app-deps`. If `npm run package:electron` fails downstream, the override is the suspect.

- [ ] **Step 4: Manual EPUB smoke test (web build only — Electron not yet rebuilt)**

Run sections "Web build" of `2026-04-29-dependabot-smoke-checklist.md`. Both EPUB2 and EPUB3 must produce non-zero bytes.

- [ ] **Step 5: Verify packaging still works**

```bash
npm run package:electron
```

This is where a tar 7 break would manifest (rebuild step fails). If it fails, narrow the override to only the affected paths or pin tar to the latest patch in the 7.x line.

- [ ] **Step 6: Run the packaged-app section of the smoke checklist**

Especially the Windows sharp + EPUB path. Without this you cannot tell whether overrides broke packaging until users hit it.

- [ ] **Step 7: Commit and open PR**

```bash
git checkout -b chore/deps-phase-1-transitive-overrides
git add package.json package-lock.json
git commit -m "$(cat <<'EOF'
chore(deps): override tar/postcss/@tootallnate/once to patched versions

Closes 9 dependabot alerts (tar x7 high, postcss x1 medium,
@tootallnate/once x1 low) by forcing patched versions through npm
`overrides`. Direct dep upgrades alone don't close these:
- electron-builder@26 still pulls tar@^6
- next@16 ships bundled postcss@8.4.31
- @tootallnate/once is 2 transitive levels under node-gyp

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push -u origin chore/deps-phase-1-transitive-overrides
gh pr create --title "chore(deps): override tar/postcss/@tootallnate/once" --body "..."
```

- [ ] **Step 8: After merge, verify alerts auto-close**

```bash
gh api repos/:owner/:repo/dependabot/alerts --jq '[.[] | select(.state=="open")] | length'
```

Expected: 17 (down from 26). If any of tar / postcss / @tootallnate/once alerts are still open after 24h, manually dismiss with `gh api -X PATCH /repos/:owner/:repo/dependabot/alerts/<n> -f state=dismissed -f dismissed_reason=fix_started`.

---

## Chunk 3: Phase 2 — electron-builder 25 → 26

### Task 2.1: Bump electron-builder to 26.x

**Files:**
- Modify: `package.json` (`devDependencies."electron-builder"`)
- Possibly modify: `electron-builder.yml` or `build` field in package.json (if config keys renamed)

**Background:** electron-builder 26 introduced changes around code-signing, asar packaging, and `@electron/rebuild` v4. Read the [electron-builder 26 release notes](https://www.electron.build/changelog) and [migration guide](https://www.electron.build/migration) before starting.

- [ ] **Step 1: Read the migration notes**

```bash
gh api repos/electron-userland/electron-builder/releases --jq '.[] | select(.tag_name|startswith("v26.0.0")) | .body' | head -100
```

Note any renamed config keys, removed CLI flags, or signing changes that affect us.

- [ ] **Step 2: Bump the dep**

```bash
npm install --save-dev electron-builder@^26.8.1
```

- [ ] **Step 3: Verify peer warnings**

```bash
npm ls 2>&1 | grep -E "WARN|ERR" | head -20
```

If electron-builder 26 expects a newer Electron, that's expected — Phase 3 fixes it. Note the warnings; do not act on Electron warnings here.

- [ ] **Step 4: Type/lint/test gate**

```bash
npm run lint && npm run typecheck && npm test
```

- [ ] **Step 5: Build packaged app on each platform you can reach**

```bash
npm run package:electron
```

On Linux first (cheapest), then Windows (this is where sharp DLL regressions show), then mac if available. On Windows, install the produced exe and verify the app launches.

- [ ] **Step 6: Run the packaged-app smoke checklist**

Pay attention to:
- App boots without missing-module errors
- Auto-updater initializes (check the file-backed log added in commit `e2e50fe1`)
- EPUB export still works inside the packaged app

- [ ] **Step 7: Commit and ship**

```bash
git checkout -b chore/deps-phase-2-electron-builder-26
git add package.json package-lock.json
git commit -m "$(cat <<'EOF'
chore(deps): bump electron-builder 25.1.8 → 26.8.x

Major version bump to keep packaging tooling current ahead of the
Electron 33 → 38/39 jump. No app code changes; verified packaged
build + EPUB export on each available platform.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Rollback plan:** If a packaging regression appears post-merge that wasn't caught locally, revert the PR. The override block from Phase 1 stays in place — it's independent of `electron-builder`'s declared `tar` version.

---

## Chunk 4: Phase 3a — Electron 33 → 38.8.6

### Task 3a.1: Bump Electron to 38.8.6 (penultimate major, not latest)

**Why 38 first, not 39:** 14 of the 16 Electron alerts are patched at 38.8.6. Going to 38 first lets us validate one major-version bump in isolation. If 38 ships cleanly we proceed to 39 in Phase 3b for the remaining 2 alerts (#17 high, #25 low, #23 low). If 38 destabilizes the desktop build, we have a smaller blast-radius bisect.

**Risk surface (per memory + commit history):**
1. `sharp + libvips DLLs on Windows` — `next.config.ts` `outputFileTracingIncludes` glob must continue to match.
2. `jsdom 26+ ESM chain` — Electron 38 ships a newer Node (Node 22.x). `require()` on ESM-only packages may behave differently. We already removed isomorphic-dompurify (commit `24f7c743`), but verify no new dep started pulling jsdom.
3. `epub-gen-memory` `file://` cover path — Node version bump shouldn't affect, but confirm covers still embed.
4. Auto-updater integrity — alert #1 was about ASAR integrity bypass, fixed in 35.7.5; we'll be far past that.
5. `@likecoin/epubcheck-ts` already silently broken under Next.js 16 — do not expect this to start working; only flag if it now *crashes loudly*.

**Files:**
- Modify: `package.json` (`devDependencies.electron`)
- Possibly modify: `electron/main.ts`, `electron/preload.ts`, `electron/server.ts` if any deprecated APIs are used (audit first).

- [ ] **Step 1: Audit electron source for deprecated APIs**

```bash
grep -rn "remote\|webContents.send\|ipcRenderer\|app.commandLine\|setLoginItemSettings\|setAsDefaultProtocolClient" electron/
```

Cross-reference any matches against the [Electron 34, 35, 36, 37, 38 breaking-change docs](https://www.electronjs.org/docs/latest/breaking-changes). Pay special attention to:
- `app.setAsDefaultProtocolClient` (alert #16 — registry key path injection fix, may have signature changes)
- `app.setLoginItemSettings` (alert #11)
- IPC reply patterns (alert #21 — service worker spoofing)
- Permission request handlers (alert #20 — origin handling)

Document any findings in the PR description even if no code change is needed.

- [ ] **Step 2: Bump Electron**

```bash
npm install --save-dev electron@~38.8.6
```

(`~` not `^` so we stay on the 38 line until Phase 3b makes the conscious 39 jump.)

- [ ] **Step 3: Type/lint/test gate**

```bash
npm run lint && npm run typecheck && npm test
```

- [ ] **Step 4: Dev-mode smoke**

```bash
npm run dev:electron
```

App must boot, load the editor, and let you create + save a story without console errors.

- [ ] **Step 5: Build a Windows package and run sharp's libvips path**

```bash
npm run package:electron
```

Install the produced exe on Windows and confirm:
- App boots
- Setting a cover image in a story works (sharp resize path)
- EPUB export runs without `ERR_DLOPEN_FAILED`

If sharp throws `ERR_DLOPEN_FAILED`, the `outputFileTracingIncludes` glob may need adjustment — the upstream sharp package layout may have shifted between Electron Node versions. Inspect `dist/.../node_modules/@img/sharp-*/lib/` in the packaged output and confirm `.dll` files are present.

- [ ] **Step 6: Full packaged smoke checklist**

Run the entire `2026-04-29-dependabot-smoke-checklist.md` end-to-end. Both EPUB2 and EPUB3, both web and packaged, both pen-name with and without author note.

- [ ] **Step 7: Verify auto-update still works**

The update path was hardened recently (`e2e50fe1` added file-backed logs). Confirm:
- `electron/update-controller.ts` still compiles and the file-backed logger still produces output
- A simulated update check exits cleanly (you do not need to actually update — `update-electron-app`'s feed-URL probe is enough)

- [ ] **Step 8: Commit and ship**

```bash
git checkout -b chore/deps-phase-3a-electron-38
git add package.json package-lock.json electron/
git commit -m "$(cat <<'EOF'
chore(deps): bump electron 33.4.11 → 38.8.6

Closes 14 of 16 dependabot alerts on electron (3 high, 9 medium, 2 low).
Remaining 2 alerts patched at 39.8.5+ — addressed in next phase.

Verified end-to-end: dev:electron boot, packaged Windows build,
sharp libvips path (ERR_DLOPEN_FAILED check), EPUB2 + EPUB3 export
in packaged app, auto-update controller smoke.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Soak time:** Merge to main, ship as v0.10.0-rc1 (or similar pre-release tag). Use the app yourself for at least 2–3 days before starting Phase 3b. Many Electron regressions only show on specific OS versions or specific code paths.

---

## Chunk 5: Phase 3b — Electron 38 → 39.8.x (and Phase 4 — close-out)

### Task 3b.1: Bump Electron to 39.8.x

Only proceed once Phase 3a has soaked without regression reports.

**Files:**
- Modify: `package.json` (`devDependencies.electron`)

- [ ] **Step 1: Re-audit electron source for 38→39 breaking changes**

```bash
grep -rn "offscreen\|sharedTexture\|clipboard.readImage" electron/
```

Alerts #25 and #23 are about `clipboard.readImage()` and offscreen shared-texture release callbacks. We don't use offscreen rendering, but confirm clipboard usage is benign.

- [ ] **Step 2: Bump and gate**

```bash
npm install --save-dev electron@^39.8.6
npm run lint && npm run typecheck && npm test
```

- [ ] **Step 3: Full smoke (dev + packaged)**

Same checklist as Phase 3a. Pay attention to anything that worked in 38 but breaks here — if it does, the bisect is small (one major version).

- [ ] **Step 4: Commit and ship**

```bash
git checkout -b chore/deps-phase-3b-electron-39
git add package.json package-lock.json
git commit -m "chore(deps): bump electron 38.8.6 → 39.8.x (closes final 2 alerts)"
```

### Task 4.1: Close-out verification

- [ ] **Step 1: Confirm zero open dependabot alerts**

```bash
gh api repos/:owner/:repo/dependabot/alerts --jq '[.[] | select(.state=="open")] | length'
```

Expected: 0. If any remain, investigate why — they may be alerts that surfaced after we started, requiring a follow-up PR.

- [ ] **Step 2: Diff the dependency snapshot**

```bash
npm ls electron electron-builder tar postcss @tootallnate/once --all 2>&1 \
  | tee /tmp/scriptr-deps-after.txt
diff /tmp/scriptr-deps-before.txt /tmp/scriptr-deps-after.txt
```

Sanity-check the result: every `tar@6.x` is now `7.x`, electron is `39.8.x`, `@tootallnate/once` is gone or `3.x`.

- [ ] **Step 3: Bump app version**

```bash
npm version minor  # 0.9.0 → 0.10.0
git push --follow-tags
```

This triggers the release workflow per recent `chore(release)` commits.

- [ ] **Step 4: Update memory artifacts**

Add a memory entry capturing what we learned (e.g., "Electron 33 → 39 bump was uneventful" or "DLL trace glob needed adjustment for sharp 0.34 in Electron 39"). Use the `feedback` type with the Why/How-to-apply structure.

---

## Notes on what NOT to do

- **Do not bundle phases.** Resist the temptation to do "small PR with overrides + electron bump." The whole point is bisectable history.
- **Do not bump Next.js, sharp, react, or openai opportunistically.** None of them have alerts. Save those for a separate "routine deps" PR after the security work ships.
- **Do not enable `@likecoin/epubcheck-ts` validation** as part of this work even if a newer version appears to fix the Next.js 16 crash — that's a separate user-facing concern and adds risk to a security PR.
- **Do not remove the `outputFileTracingIncludes` sharp DLL workaround** even if Electron 38/39 seems to "just work" without it — the original bug was Windows-specific and may not show in your dev environment.
- **Do not skip the manual packaged-app smoke test.** The unit/e2e suites do not catch packaged-app regressions. The historical EPUB-export bugs (sharp DLLs, jsdom ESM chain, 0-byte covers) all only surfaced in production-built artifacts.
