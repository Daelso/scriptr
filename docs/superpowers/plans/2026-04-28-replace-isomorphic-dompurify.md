# Replace isomorphic-dompurify Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove `isomorphic-dompurify` (and the `jsdom` ESM-only dep chain it drags in) from the production runtime so EPUB export works on packaged Electron builds (Electron 33 = Node 20.18) without `ERR_REQUIRE_ESM` from `@csstools/css-calc`.

**Architecture:** Split [lib/publish/sanitize-html.ts](../../../lib/publish/sanitize-html.ts) into two implementations behind the same `sanitizeWith(html, opts, uriRegex?)` call shape:
- **Server** (`lib/publish/sanitize-server.ts`) uses the `sanitize-html` npm package (htmlparser2-based, pure JS, no DOM emulation, no ESM-only transitives).
- **Client** (`lib/publish/sanitize-client.ts`) uses plain `dompurify` against the browser's native `window`.

The DOMPurify-shape allowlists in [lib/publish/author-note-shared.ts](../../../lib/publish/author-note-shared.ts) (`ALLOWED_TAGS`, `ALLOWED_ATTR`, `ALLOWED_URI_REGEXP`, `ALLOW_DATA_ATTR`, `ALLOW_ARIA_ATTR`) stay unchanged — the server adapter translates them to `sanitize-html`'s option shape internally so callers don't have to change. Both server and client paths preserve the existing URI-bearing-attribute hook semantics (trim → reject control/bidi → match `uriRegex` → run extra-checks).

**Tech Stack:** TypeScript, Next.js 16 App Router, `sanitize-html` (server), `dompurify` (client), `vitest`.

**Branch:** `fix/epub-drop-isomorphic-dompurify` off `main` (NOT off `feat/docker-hosting` — this is a separate concern that needs to ship independently).

---

## File Structure

| Action | Path | Responsibility |
| --- | --- | --- |
| Create | `lib/publish/sanitize-server.ts` | Server sanitizer wrapping the `sanitize-html` package; exports `sanitizeWith` |
| Create | `lib/publish/sanitize-client.ts` | Client sanitizer wrapping `dompurify` directly; exports `sanitizeWith` |
| Create | `tests/lib/publish/sanitize-server.test.ts` | Behavior parity + URI-hook tests for server impl (Node env) |
| Modify | `lib/publish/safe-html.tsx` | Switch import from `sanitize-html` → `sanitize-client` |
| Modify | `lib/publish/author-note.ts` | Switch import from `sanitize-html` → `sanitize-server` |
| Modify | `package.json` | Add `sanitize-html`, `dompurify`, `@types/sanitize-html`, `@types/dompurify`; drop `isomorphic-dompurify`; drop `overrides.jsdom` and `overrides.html-encoding-sniffer` |
| Delete | `lib/publish/sanitize-html.ts` | Old isomorphic wrapper, no longer used |

`tests/lib/publish-author-note.test.ts` and `tests/lib/publish-safe-html.test.tsx` are NOT modified — they pin behavior we're preserving and must continue passing as-is. The `// @vitest-environment jsdom` directive in `publish-author-note.test.ts` is left alone (the new server sanitizer doesn't need a DOM, but jsdom is harmless and `qrcode`'s `toDataURL` may incidentally rely on browser globals in some paths).

---

## Notes for the implementer

**Worktree discipline (per [AGENTS.md](../../../AGENTS.md)).** Run this work in `/home/chase/projects/scriptr/.worktrees/fix-epub-drop-isomorphic-dompurify`. Every shell command, `git add`, and test invocation must use that absolute path or be prefixed with `cd <worktree>`. After each task, run `git status` in the main checkout (`/home/chase/projects/scriptr`) to confirm no stray edits leaked there.

**`scriptr/no-telemetry` ESLint rule.** Both `sanitize-html` and `dompurify` are sanitizers, not telemetry/analytics, and are not on the rule's blocklist in [eslint-rules/no-telemetry.js](../../../eslint-rules/no-telemetry.js). They will lint clean.

**Privacy egress test.** [tests/privacy/no-external-egress.test.ts](../../../tests/privacy/no-external-egress.test.ts) asserts no `fetch` is made by non-generate routes. `sanitize-html` and `dompurify` do no network I/O. No changes to that test are required, but it must continue to pass after the cutover.

**TDD.** Use the @superpowers:test-driven-development discipline for the server sanitizer (Task 3). Tests first, watch them fail, then implement. The server sanitizer must reach behavioral parity with the current `isomorphic-dompurify` impl on every assertion in `tests/lib/publish-author-note.test.ts`.

**Copy regexes/constants verbatim, do NOT retype.** Tasks 3 and 4 inline the source for the new sanitizers. The `URI_ATTRS` set, `URI_CONTROL_OR_SPACE_RE`, `URI_BIDI_RE`, and `extraUriChecks` body are byte-for-byte copies of the corresponding pieces in [lib/publish/sanitize-html.ts](../../../lib/publish/sanitize-html.ts). When transcribing them into the new files, **open `lib/publish/sanitize-html.ts` in an editor and paste — do not retype**. The plan source above (Tasks 3 and 4) uses explicit `\u00XX` escapes; any drift in the control/bidi regex produces silent security regressions.

**Memory writes are outside the worktree.** Task 8 Step 1 writes to `~/.claude/projects/-home-chase-projects-scriptr/memory/`, which sits outside the repo entirely. Those writes will not appear in `git status` and will not be part of the PR. That is intentional.

---

## Task 0: Worktree + branch setup

**Files:** none

- [ ] **Step 1: Create the worktree off `main`**

```bash
cd /home/chase/projects/scriptr
git worktree add .worktrees/fix-epub-drop-isomorphic-dompurify -b fix/epub-drop-isomorphic-dompurify origin/main
```

Expected: new dir at `/home/chase/projects/scriptr/.worktrees/fix-epub-drop-isomorphic-dompurify` on a fresh branch.

- [ ] **Step 2: Verify clean tree**

```bash
cd /home/chase/projects/scriptr/.worktrees/fix-epub-drop-isomorphic-dompurify && git status
```

Expected: `nothing to commit, working tree clean` and branch `fix/epub-drop-isomorphic-dompurify`.

- [ ] **Step 3: Install deps in the worktree**

```bash
cd /home/chase/projects/scriptr/.worktrees/fix-epub-drop-isomorphic-dompurify && npm ci
```

Expected: install completes; `node_modules/` populated.

- [ ] **Step 4: Capture pre-cutover test baseline**

```bash
cd /home/chase/projects/scriptr/.worktrees/fix-epub-drop-isomorphic-dompurify
npx vitest run tests/lib/publish-author-note.test.ts tests/lib/publish-safe-html.test.tsx tests/privacy/no-external-egress.test.ts
```

Expected: all three pass on `main` before any code changes. Record the run as the pre-cutover baseline so a Task 5 / Task 7 failure can be cleanly attributed to the cutover, not pre-existing breakage. If any of these fail on `main` as-is, STOP and surface to the user — that's a separate bug.

---

## Task 1: Add new sanitizer deps

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add `sanitize-html` and `dompurify` (production), and their types (dev)**

```bash
cd /home/chase/projects/scriptr/.worktrees/fix-epub-drop-isomorphic-dompurify
npm install sanitize-html dompurify
npm install --save-dev @types/sanitize-html @types/dompurify
```

Expected: `package.json` gains four new entries; `package-lock.json` updates.

- [ ] **Step 2: Sanity-check installed versions**

```bash
cd /home/chase/projects/scriptr/.worktrees/fix-epub-drop-isomorphic-dompurify
node -e 'const a=require("sanitize-html/package.json"); const b=require("dompurify/package.json"); console.log(a.name, a.version); console.log(b.name, b.version);'
```

Expected: `sanitize-html` ≥ 2.13 and `dompurify` ≥ 3.x printed.

- [ ] **Step 3: Commit**

```bash
cd /home/chase/projects/scriptr/.worktrees/fix-epub-drop-isomorphic-dompurify
git add package.json package-lock.json
git commit -m "chore(deps): add sanitize-html and dompurify for new sanitizer impls"
```

---

## Task 2: Implement server sanitizer with TDD — failing tests first

**Files:**
- Create: `tests/lib/publish/sanitize-server.test.ts`

- [ ] **Step 1: Create the failing test file**

```typescript
// tests/lib/publish/sanitize-server.test.ts
// Server-side sanitizer unit tests. Runs in node env (no @vitest-environment
// directive) — the whole point is that this impl does not require a DOM.

import { describe, it, expect } from "vitest";
import { sanitizeWith } from "@/lib/publish/sanitize-server";

const TIGHT = {
  ALLOWED_TAGS: ["p", "a", "img", "strong", "em", "div", "h2", "br"],
  ALLOWED_ATTR: ["class", "href", "src", "alt", "width", "height"],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
};

describe("sanitize-server: tag allowlist", () => {
  it("strips disallowed tags but keeps text", () => {
    const out = sanitizeWith("<p>ok</p><script>alert(1)</script>", TIGHT);
    expect(out).not.toMatch(/<script\b/i);
    expect(out).toContain("<p>ok</p>");
  });

  it("strips <img> when not in allowlist", () => {
    const opts = { ...TIGHT, ALLOWED_TAGS: ["p"] };
    const out = sanitizeWith('<p>x</p><img src="https://x.test/x.png" />', opts);
    expect(out).not.toContain("<img");
  });
});

describe("sanitize-server: attribute allowlist", () => {
  it("drops attributes not in ALLOWED_ATTR", () => {
    const out = sanitizeWith('<a href="https://x.test" onclick="x">y</a>', TIGHT);
    expect(out).toContain('href="https://x.test"');
    expect(out).not.toContain("onclick");
  });

  it("strips data-* attributes (ALLOW_DATA_ATTR: false)", () => {
    const out = sanitizeWith('<a href="https://x.test" data-evil="1">y</a>', TIGHT);
    expect(out).toContain('href="https://x.test"');
    expect(out).not.toContain("data-evil");
  });

  it("strips aria-* attributes (ALLOW_ARIA_ATTR: false)", () => {
    const out = sanitizeWith('<a href="https://x.test" aria-evil="1">y</a>', TIGHT);
    expect(out).toContain('href="https://x.test"');
    expect(out).not.toContain("aria-evil");
  });
});

describe("sanitize-server: URI regex hook", () => {
  const URI_RE = /^(?:https?:|mailto:|data:image\/png;base64,)/i;

  it("allows https URIs that match the regex", () => {
    const out = sanitizeWith('<a href="https://x.test">y</a>', TIGHT, URI_RE);
    expect(out).toContain('href="https://x.test"');
  });

  it("strips javascript: URIs even when <a> is allowed", () => {
    const out = sanitizeWith('<a href="javascript:alert(1)">y</a>', TIGHT, URI_RE);
    expect(out).not.toMatch(/javascript:/i);
  });

  it("strips data:text/html URIs", () => {
    const out = sanitizeWith(
      '<a href="data:text/html,<script>x</script>">y</a>',
      TIGHT,
      URI_RE,
    );
    expect(out).not.toMatch(/data:text\/html/i);
  });

  it("strips data:image/svg+xml URIs (svg can carry script)", () => {
    const out = sanitizeWith(
      '<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" alt="x" />',
      TIGHT,
      URI_RE,
    );
    expect(out).not.toMatch(/data:image\/svg\+xml/i);
  });

  it("preserves data:image/png;base64 with a non-empty base64 payload", () => {
    const out = sanitizeWith(
      '<img src="data:image/png;base64,iVBORw0KGgo=" alt="qr" />',
      TIGHT,
      URI_RE,
    );
    expect(out).toContain('src="data:image/png;base64,iVBORw0KGgo="');
  });

  it("rejects empty data:image/png;base64 payload (extraUriChecks)", () => {
    const out = sanitizeWith(
      '<img src="data:image/png;base64," alt="x" />',
      TIGHT,
      URI_RE,
    );
    expect(out).not.toMatch(/data:image\/png;base64,/);
  });

  it("rejects http URI with no hostname (extraUriChecks)", () => {
    const out = sanitizeWith('<a href="http://">y</a>', TIGHT, URI_RE);
    expect(out).not.toMatch(/href="http:/);
  });

  it("rejects mailto without @ (extraUriChecks)", () => {
    const out = sanitizeWith('<a href="mailto:noaddress">y</a>', TIGHT, URI_RE);
    expect(out).not.toMatch(/mailto:/);
  });

  it("strips URI values containing whitespace or control chars", () => {
    const out = sanitizeWith('<a href="https://x .test">y</a>', TIGHT, URI_RE);
    expect(out).not.toMatch(/href=/);
  });

  it("strips URI values containing bidi controls", () => {
    const out = sanitizeWith(
      '<a href="https://‮x.test">y</a>',
      TIGHT,
      URI_RE,
    );
    expect(out).not.toMatch(/href=/);
  });
});

describe("sanitize-server: no uriRegex passed", () => {
  it("does not URI-filter when uriRegex is omitted (DOMPurify default scheme list applies)", () => {
    const out = sanitizeWith('<a href="https://x.test">y</a>', TIGHT);
    expect(out).toContain('href="https://x.test"');
  });
});
```

- [ ] **Step 2: Run tests, verify they fail with module-not-found**

```bash
cd /home/chase/projects/scriptr/.worktrees/fix-epub-drop-isomorphic-dompurify
npx vitest run tests/lib/publish/sanitize-server.test.ts
```

Expected: every test fails with `Cannot find module '@/lib/publish/sanitize-server'` (or equivalent). This proves the test file is wired correctly and the impl doesn't exist yet.

---

## Task 3: Implement server sanitizer

**Files:**
- Create: `lib/publish/sanitize-server.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// lib/publish/sanitize-server.ts
import sanitizeHtml from "sanitize-html";

/**
 * Server-side HTML sanitizer for the EPUB build path. Wraps the
 * `sanitize-html` package (htmlparser2, no DOM emulation, no ESM-only
 * transitives) behind the DOMPurify-shape options used elsewhere in the
 * codebase, so callers don't have to learn a second sanitizer config shape.
 *
 * This file MUST NOT import `isomorphic-dompurify`, `dompurify`, `jsdom`,
 * or any DOM emulation. The whole point is that `lib/publish/author-note.ts`
 * (loaded server-side from the EPUB export route) can be rendered inside a
 * packaged Electron build (Electron 33 = Node 20.18) without hitting the
 * `@csstools/css-calc` ERR_REQUIRE_ESM that jsdom 26+ pulls in.
 */

export type SanitizeOpts = {
  ALLOWED_TAGS: string[];
  ALLOWED_ATTR: string[];
  ALLOW_DATA_ATTR?: boolean;
  ALLOW_ARIA_ATTR?: boolean;
};

// Mirror of URI_ATTRS from the old DOMPurify hook. Scoped to attributes the
// current AUTHOR_NOTE_SANITIZE_OPTS allowlist can produce; if/when the
// allowlist widens, audit this set against the new tags' URI-bearing attrs.
const URI_ATTRS = new Set([
  "src",
  "href",
  "xlink:href",
  "srcset",
  "poster",
  "cite",
  "formaction",
  "action",
  "background",
  "longdesc",
  "usemap",
]);

const URI_CONTROL_OR_SPACE_RE = /[\u0000-\u001F\u007F\s]/u;
const URI_BIDI_RE = /[\u202A-\u202E\u2066-\u2069]/u;

function normalizeUriValue(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (URI_CONTROL_OR_SPACE_RE.test(trimmed) || URI_BIDI_RE.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function extraUriChecks(value: string): boolean {
  const lower = value.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://")) {
    try {
      const parsed = new URL(value);
      return (
        (parsed.protocol === "http:" || parsed.protocol === "https:")
        && parsed.hostname.length > 0
      );
    } catch {
      return false;
    }
  }
  if (lower.startsWith("mailto:")) {
    const addr = value.slice("mailto:".length);
    return addr.length > 0 && addr.includes("@");
  }
  if (lower.startsWith("data:image/png;base64,")) {
    const payload = value.slice("data:image/png;base64,".length);
    return payload.length > 0 && /^[A-Za-z0-9+/=]+$/.test(payload);
  }
  return true;
}

/**
 * Sanitize HTML with a DOMPurify-shape config and an optional URI allowlist
 * regex that is also enforced on URI-bearing attributes via a transform pass.
 * Mirrors the pre-existing `lib/publish/sanitize-html.ts` API exactly so
 * callers (currently `lib/publish/author-note.ts`) need no behavioral
 * changes.
 *
 * Note: `sanitize-html` does NOT auto-allow `data-*` / `aria-*` attributes,
 * so `ALLOW_DATA_ATTR: false` and `ALLOW_ARIA_ATTR: false` are the natural
 * default and need no special handling. They are accepted in the opts shape
 * for parity with the existing constants.
 */
export function sanitizeWith(
  html: string,
  opts: SanitizeOpts,
  uriRegex?: RegExp,
): string {
  return sanitizeHtml(html, {
    allowedTags: opts.ALLOWED_TAGS,
    allowedAttributes: { "*": opts.ALLOWED_ATTR },
    // Fall back to sanitize-html's default scheme list when no uriRegex is
    // supplied. When one IS supplied, we widen schemes to include `data:`
    // and rely on the transform pass below to do the precise filtering.
    allowedSchemes: uriRegex
      ? ["http", "https", "mailto", "data"]
      : ["http", "https", "ftp", "mailto"],
    allowedSchemesAppliedToAttributes: ["href", "src", "cite"],
    // Drop tags whose attributes don't survive the URI filter? No — we keep
    // the tag and just strip the bad attribute, matching DOMPurify's hook
    // semantics (`data.keepAttr = false`).
    transformTags: uriRegex
      ? {
          "*": (tagName: string, attribs: Record<string, string>) => {
            const out: Record<string, string> = {};
            for (const [name, value] of Object.entries(attribs)) {
              if (URI_ATTRS.has(name.toLowerCase())) {
                const normalized = normalizeUriValue(value);
                if (!normalized) continue;
                if (!uriRegex.test(normalized)) continue;
                if (!extraUriChecks(normalized)) continue;
                out[name] = normalized;
              } else {
                out[name] = value;
              }
            }
            return { tagName, attribs: out };
          },
        }
      : undefined,
  });
}
```

- [ ] **Step 2: Run server sanitizer tests, verify they pass**

```bash
cd /home/chase/projects/scriptr/.worktrees/fix-epub-drop-isomorphic-dompurify
npx vitest run tests/lib/publish/sanitize-server.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
cd /home/chase/projects/scriptr/.worktrees/fix-epub-drop-isomorphic-dompurify
git add lib/publish/sanitize-server.ts tests/lib/publish/sanitize-server.test.ts
git commit -m "feat(publish): add jsdom-free server sanitizer (sanitize-html)"
```

---

## Task 4: Implement client sanitizer

**Files:**
- Create: `lib/publish/sanitize-client.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// lib/publish/sanitize-client.ts
"use client";

import DOMPurify from "dompurify";
import type { Config as DOMPurifyConfig } from "dompurify";

/**
 * Client-side HTML sanitizer. Uses plain `dompurify` against the browser's
 * native `window` — no DOM emulation needed, since this only runs in the
 * browser. The server-side equivalent lives in `lib/publish/sanitize-server.ts`
 * and is what the EPUB build path uses.
 *
 * Splitting client and server like this lets us drop `isomorphic-dompurify`
 * (and the jsdom dep chain it pulls in on Node) entirely from the
 * production runtime — see docs/superpowers/plans/2026-04-28-replace-isomorphic-dompurify.md.
 */

const URI_ATTRS = new Set([
  "src",
  "href",
  "xlink:href",
  "srcset",
  "poster",
  "cite",
  "formaction",
  "action",
  "background",
  "longdesc",
  "usemap",
]);

const URI_CONTROL_OR_SPACE_RE = /[\u0000-\u001F\u007F\s]/u;
const URI_BIDI_RE = /[\u202A-\u202E\u2066-\u2069]/u;

function normalizeUriValue(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (URI_CONTROL_OR_SPACE_RE.test(trimmed) || URI_BIDI_RE.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function uriRegexAllows(uriRegex: RegExp, value: string): boolean {
  uriRegex.lastIndex = 0;
  return uriRegex.test(value);
}

function extraUriChecks(value: string): boolean {
  const lower = value.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://")) {
    try {
      const parsed = new URL(value);
      return (
        (parsed.protocol === "http:" || parsed.protocol === "https:")
        && parsed.hostname.length > 0
      );
    } catch {
      return false;
    }
  }
  if (lower.startsWith("mailto:")) {
    const addr = value.slice("mailto:".length);
    return addr.length > 0 && addr.includes("@");
  }
  if (lower.startsWith("data:image/png;base64,")) {
    const payload = value.slice("data:image/png;base64,".length);
    return payload.length > 0 && /^[A-Za-z0-9+/=]+$/.test(payload);
  }
  return true;
}

export function sanitizeWith(
  html: string,
  config: DOMPurifyConfig,
  uriRegex?: RegExp,
): string {
  if (!uriRegex) {
    return DOMPurify.sanitize(html, config) as string;
  }
  const hook = (
    _node: Element,
    data: { attrName: string; attrValue: string; keepAttr: boolean },
  ) => {
    try {
      const attr = data.attrName.toLowerCase();
      if (!URI_ATTRS.has(attr)) return;
      const normalized = normalizeUriValue(data.attrValue);
      if (!normalized) {
        data.keepAttr = false;
        return;
      }
      if (!uriRegexAllows(uriRegex, normalized) || !extraUriChecks(normalized)) {
        data.keepAttr = false;
        return;
      }
      data.attrValue = normalized;
    } catch {
      data.keepAttr = false;
    }
  };
  DOMPurify.addHook("uponSanitizeAttribute", hook);
  try {
    return DOMPurify.sanitize(html, config) as string;
  } finally {
    DOMPurify.removeHook("uponSanitizeAttribute", hook);
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/chase/projects/scriptr/.worktrees/fix-epub-drop-isomorphic-dompurify
git add lib/publish/sanitize-client.ts
git commit -m "feat(publish): add jsdom-free client sanitizer (plain dompurify)"
```

(Tests for the client sanitizer come from the existing [tests/lib/publish-safe-html.test.tsx](../../../tests/lib/publish-safe-html.test.tsx), which exercises `SafeHtml` end-to-end. We do NOT add a separate `sanitize-client.test.tsx` — the existing test is the contract.)

---

## Task 5: Cutover safe-html.tsx and author-note.ts

**Files:**
- Modify: `lib/publish/safe-html.tsx` (line 4 only)
- Modify: `lib/publish/author-note.ts` (line 4 only)

- [ ] **Step 1: Repoint `safe-html.tsx` to the client impl**

In [lib/publish/safe-html.tsx](../../../lib/publish/safe-html.tsx), change line 4:

```diff
-import { sanitizeWith } from "@/lib/publish/sanitize-html";
+import { sanitizeWith } from "@/lib/publish/sanitize-client";
```

- [ ] **Step 2: Repoint `author-note.ts` to the server impl**

In [lib/publish/author-note.ts](../../../lib/publish/author-note.ts), change line 4:

```diff
-import { sanitizeWith } from "@/lib/publish/sanitize-html";
+import { sanitizeWith } from "@/lib/publish/sanitize-server";
```

- [ ] **Step 3: Run the existing pinning tests, verify they still pass**

```bash
cd /home/chase/projects/scriptr/.worktrees/fix-epub-drop-isomorphic-dompurify
npx vitest run tests/lib/publish-safe-html.test.tsx tests/lib/publish-author-note.test.ts
```

Expected: all tests pass. **If any test fails, the parity translation in `sanitize-server.ts` is incomplete — return to Task 3 and add the missing case rather than weakening the test.**

- [ ] **Step 4: Commit**

```bash
cd /home/chase/projects/scriptr/.worktrees/fix-epub-drop-isomorphic-dompurify
git add lib/publish/safe-html.tsx lib/publish/author-note.ts
git commit -m "refactor(publish): repoint safe-html and author-note to split sanitizers"
```

---

## Task 6: Delete old `sanitize-html.ts` and remove isomorphic-dompurify

**Files:**
- Delete: `lib/publish/sanitize-html.ts`
- Modify: `package.json`

- [ ] **Step 1: Verify no remaining importers**

```bash
cd /home/chase/projects/scriptr/.worktrees/fix-epub-drop-isomorphic-dompurify
grep -rn "from ['\"]@/lib/publish/sanitize-html\|from ['\"]\\./sanitize-html\|from ['\"]\\.\\./sanitize-html" --include="*.ts" --include="*.tsx" --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.worktrees --exclude-dir=dist . 2>/dev/null
```

Expected: empty output. (Excludes are explicit so we don't get false positives from build artifacts under `.next/`, prebuilt `dist/`, vendored `node_modules/`, or any sibling worktree under `.worktrees/`.)

- [ ] **Step 2: Delete the old file**

```bash
cd /home/chase/projects/scriptr/.worktrees/fix-epub-drop-isomorphic-dompurify
git rm lib/publish/sanitize-html.ts
```

- [ ] **Step 3: Remove `isomorphic-dompurify` and the jsdom override**

```bash
cd /home/chase/projects/scriptr/.worktrees/fix-epub-drop-isomorphic-dompurify
npm uninstall isomorphic-dompurify
```

Then hand-edit `package.json` to delete the `overrides` block entirely:

```diff
-  "overrides": {
-    "jsdom": "27.0.0",
-    "html-encoding-sniffer": "4.0.0"
-  }
```

(Rationale: the override only existed to wedge a specific jsdom version under isomorphic-dompurify. With isomorphic-dompurify gone, the production runtime no longer touches jsdom. `jsdom` stays in `devDependencies` for vitest's jsdom env, but its exact version no longer matters for shipping.)

Re-run `npm install` to regenerate the lockfile without the overrides.

```bash
cd /home/chase/projects/scriptr/.worktrees/fix-epub-drop-isomorphic-dompurify
npm install
```

- [ ] **Step 4: Verify isomorphic-dompurify is gone from the tree**

```bash
cd /home/chase/projects/scriptr/.worktrees/fix-epub-drop-isomorphic-dompurify
ls node_modules/isomorphic-dompurify 2>&1
```

Expected: `ls: cannot access 'node_modules/isomorphic-dompurify': No such file or directory`.

- [ ] **Step 5: Commit**

```bash
cd /home/chase/projects/scriptr/.worktrees/fix-epub-drop-isomorphic-dompurify
git add lib/publish/sanitize-html.ts package.json package-lock.json
git commit -m "refactor(publish): drop isomorphic-dompurify and jsdom production runtime"
```

---

## Task 7: Full verification

**Files:** none (verification only — no edits)

Use @superpowers:verification-before-completion discipline: run each command and confirm output before marking the task complete.

- [ ] **Step 1: Lint**

```bash
cd /home/chase/projects/scriptr/.worktrees/fix-epub-drop-isomorphic-dompurify
npm run lint
```

Expected: zero errors. (The `scriptr/no-telemetry` rule does not flag `sanitize-html` or `dompurify`.)

- [ ] **Step 2: Typecheck**

```bash
cd /home/chase/projects/scriptr/.worktrees/fix-epub-drop-isomorphic-dompurify
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 3: Unit tests (full suite)**

```bash
cd /home/chase/projects/scriptr/.worktrees/fix-epub-drop-isomorphic-dompurify
npm test
```

Expected: all tests pass, including:
- `tests/lib/publish/sanitize-server.test.ts` (new)
- `tests/lib/publish-author-note.test.ts` (existing parity contract)
- `tests/lib/publish-safe-html.test.tsx` (existing parity contract)
- `tests/privacy/no-external-egress.test.ts` (still asserts no egress)

- [ ] **Step 4: Production build**

```bash
cd /home/chase/projects/scriptr/.worktrees/fix-epub-drop-isomorphic-dompurify
npm run build
```

Expected: build succeeds. Inspect output for any unexpected warning about externalized modules.

- [ ] **Step 5: Confirm jsdom is gone from the standalone runtime trace**

```bash
cd /home/chase/projects/scriptr/.worktrees/fix-epub-drop-isomorphic-dompurify
find .next/standalone/node_modules -maxdepth 2 -path '*/jsdom' -type d 2>&1
find .next/standalone/node_modules -maxdepth 3 -path '*/@csstools/css-calc' -type d 2>&1
find .next/standalone/node_modules -maxdepth 2 -path '*/isomorphic-dompurify' -type d 2>&1
```

Expected: empty output for all three (Next.js's NFT no longer traces these into the standalone bundle). Using `-path` rather than `-name` because `-name` matches any directory called `css-calc` anywhere; the failing dep is specifically `@csstools/css-calc` and we want a precise match.

- [ ] **Step 6: Confirm `sanitize-html` IS in the standalone runtime trace**

```bash
cd /home/chase/projects/scriptr/.worktrees/fix-epub-drop-isomorphic-dompurify
find .next/standalone/node_modules -maxdepth 2 -path '*/sanitize-html' -type d 2>&1
```

Expected: prints exactly one path ending in `node_modules/sanitize-html`.

- [ ] **Step 7: Audit `next.config.ts` for stale references**

```bash
cd /home/chase/projects/scriptr/.worktrees/fix-epub-drop-isomorphic-dompurify
grep -n "jsdom\|isomorphic-dompurify\|csstools" next.config.ts 2>&1
```

Expected: empty output. If anything matches (e.g. an `outputFileTracingIncludes` glob, `serverExternalPackages` entry, or webpack rule referencing the dropped packages), remove it — the existing [next.config.ts:54-56](../../../next.config.ts#L54-L56) sharp-DLL include is the only NFT override the project should have, and stale entries here are a known source of bugs in this project (per the `feedback_sharp_dll_tracing` memory).

- [ ] **Step 8: Smoke-test EPUB export end-to-end (web mode)**

```bash
cd /home/chase/projects/scriptr/.worktrees/fix-epub-drop-isomorphic-dompurify
npm run dev
```

In a browser at `http://127.0.0.1:3000`, open a story with at least one chapter, go to the export page, and trigger an EPUB3 export (with author-note enabled if a pen-name profile has one). Verify the file is produced and opens in an EPUB reader.

Expected: export succeeds, downloaded `.epub` is non-zero bytes, opens cleanly. Author-note end page renders sanitized HTML correctly (links, QR image if mailing-list URL was set).

- [ ] **Step 9: (Optional but recommended) Build the Electron desktop bundle and verify on Windows**

If a Windows VM/runner is available:

```bash
cd /home/chase/projects/scriptr/.worktrees/fix-epub-drop-isomorphic-dompurify
npm run package:electron
```

Install the produced installer on Windows, open a story, trigger an EPUB export, confirm no `ERR_REQUIRE_ESM` and no entry written to `%AppData%\scriptr\data\logs\api-errors.log`.

If a Windows runner is NOT readily available, **explicitly note in the PR description that Windows packaged-build verification is pending** rather than claiming success.

---

## Task 8: Update memory + open PR

**Files:**
- Memory: `~/.claude/projects/-home-chase-projects-scriptr/memory/`

- [ ] **Step 1: Update auto-memory**

Update `feedback_epub_cover_path.md` (or add a new memory file) noting the new failure mode this fix resolved: jsdom 26+ ESM-only deps + Electron 33 Node 20.18 = `ERR_REQUIRE_ESM`. Add an entry to `MEMORY.md` pointing to it. Keep it short — the goal is so future-you spots a similar dep-chain trap before it ships.

- [ ] **Step 2: Open the PR**

```bash
cd /home/chase/projects/scriptr/.worktrees/fix-epub-drop-isomorphic-dompurify
git push -u origin fix/epub-drop-isomorphic-dompurify
gh pr create --title "fix(publish): drop isomorphic-dompurify (jsdom ESM chain) from EPUB export" --body "$(cat <<'EOF'
## Summary
- Replace `isomorphic-dompurify` with two narrowly-scoped sanitizers: `sanitize-html` (server, htmlparser2-based) and plain `dompurify` (client, browser-native DOM).
- Removes the `jsdom → @asamuzakjp/css-color → @csstools/css-calc` ESM-only dep chain from the production runtime, fixing `ERR_REQUIRE_ESM` on packaged Electron builds (Electron 33 = Node 20.18, which can't `require()` ESM).
- Drops the `overrides` for `jsdom` / `html-encoding-sniffer` — no longer needed once jsdom is dev-only.

## Test plan
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm test` (incl. new `tests/lib/publish/sanitize-server.test.ts`)
- [ ] `npm run build` succeeds; standalone bundle no longer contains `jsdom` / `isomorphic-dompurify` / `@csstools/css-calc`
- [ ] EPUB3 export (web dev server) produces a valid file with author-note end page
- [ ] Packaged Electron build on Windows — exports an EPUB without `ERR_REQUIRE_ESM`

(Implementer: tick the boxes above as each verification step passes during Task 7. Don't pre-tick.)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

---

## Done criteria

All of the following must be true:

1. `lib/publish/sanitize-html.ts` no longer exists.
2. `isomorphic-dompurify` is not in `package.json` (any section).
3. The `overrides` block is removed from `package.json`.
4. `tests/lib/publish/sanitize-server.test.ts`, `tests/lib/publish-author-note.test.ts`, and `tests/lib/publish-safe-html.test.tsx` all pass.
5. The Next.js standalone bundle (`.next/standalone/node_modules/`) contains `sanitize-html` and `dompurify` but not `jsdom`, `isomorphic-dompurify`, or `@csstools/css-calc`.
6. EPUB export succeeds end-to-end on the web dev server.
7. Memory is updated to capture the dep-chain root cause for next time.
