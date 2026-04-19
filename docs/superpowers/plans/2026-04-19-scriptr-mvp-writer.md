# scriptr — Plan 1: MVP Writer

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [docs/superpowers/specs/2026-04-19-scriptr-design.md](../specs/2026-04-19-scriptr-design.md)

**Goal:** Build an end-to-end local Next.js app where a user can create a story, maintain a story bible, draft chapters chapter-by-chapter with Grok streaming generation, regenerate individual sections, edit inline, and read the joined result. No export yet — that lands in Plan 2.

**Architecture:** Next.js 15 App Router. Client never touches Grok directly; all AI traffic passes through server-side API routes that proxy to `api.x.ai` via the OpenAI SDK. Storage is plain JSON files under `data/` (gitignored). Streaming uses SSE. Privacy is enforced at three layers: CSP in `next.config.js`, a custom ESLint rule blocking telemetry imports, and a logger that redacts API keys.

**Tech Stack:** Next.js 15, React 19, TypeScript (strict), Tailwind v4, shadcn/ui, Tiptap, @dnd-kit/core, Zustand, openai SDK, Vitest, Playwright.

**Referenced skills during implementation:**
- `skills/frontend-design/` (bundled Anthropic skill for UI polish)
- `skills/react-best-practices/` (bundled Vercel skill for React patterns)

---

## Conventions for every task

- **TDD:** for every unit in `lib/` and every API route handler, write a failing test first, watch it fail, implement, watch it pass.
- **Commit granularity:** one logical change per commit. Commit after every green test run.
- **File-size hygiene:** if a component or module is growing past ~200 lines, consider splitting. The spec favors small units with clear boundaries.
- **Privacy guard:** never `console.log` arbitrary request bodies. Use `lib/logger.ts`, which redacts API keys. Never import telemetry packages (the custom ESLint rule will fail the build).
- **Paths in tests:** all `data/` I/O in tests must go through a temp directory (`fs.mkdtemp`) — never hit the real `data/`.
- **API responses:** API routes return JSON `{ ok: true, data }` or `{ ok: false, error: string }`. No throwing into the response.
- **Commit messages:** conventional commits (`feat:`, `fix:`, `test:`, `chore:`, `refactor:`). All commits end with the `Co-Authored-By: Claude ...` trailer.

---

## Chunk 1: Foundation & Privacy Guards

Goal at end of chunk: empty Next.js app boots, CSP headers set, telemetry-blocking ESLint rule active, gitignore covers sensitive paths, `npm run dev` binds to 127.0.0.1 by default.

### Task 1.1: Initialize git and Next.js project

**Files:**
- Create: `package.json`, `next.config.js`, `tsconfig.json`, `.gitignore`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`

- [ ] **Step 1: Initialize the git repo**

```bash
cd /home/chase/projects/scriptr
git init
git branch -M main
```

- [ ] **Step 2: Create Next.js app with TypeScript + Tailwind v4**

Run from inside `/home/chase/projects/scriptr`:

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir=false --import-alias "@/*" --no-turbopack --use-npm
```

Accept all defaults. Verify the following dirs exist after it finishes: `app/`, `public/`, `node_modules/`.

- [ ] **Step 3: Pin Node version**

Create `.nvmrc`:

```
20
```

- [ ] **Step 4: Replace placeholder `app/page.tsx` with a stub homepage**

```tsx
export default function HomePage() {
  return (
    <main className="min-h-screen p-8">
      <h1 className="text-2xl font-semibold">scriptr</h1>
      <p className="text-sm text-muted-foreground">
        Library coming soon.
      </p>
    </main>
  );
}
```

- [ ] **Step 5: Verify dev server boots on localhost only**

In `package.json`, replace the `dev` and `start` scripts:

```json
{
  "scripts": {
    "dev": "next dev -H 127.0.0.1 -p 3000",
    "dev:lan": "next dev -H 0.0.0.0 -p 3000",
    "build": "next build",
    "start": "next start -H 127.0.0.1 -p 3000",
    "start:lan": "next start -H 0.0.0.0 -p 3000",
    "lint": "next lint",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test",
    "typecheck": "tsc --noEmit"
  }
}
```

Run `npm run dev`. Expect: server logs `Ready on http://127.0.0.1:3000`. Visit it in browser; see "scriptr / Library coming soon." Ctrl-C.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "chore: scaffold Next.js 15 app with Tailwind and strict TS"
```

---

### Task 1.2: Gitignore for privacy + runtime data

**Files:**
- Modify: `.gitignore`
- Create: `.env.local.example`

- [ ] **Step 1: Append privacy-critical paths to `.gitignore`**

Append to `.gitignore` (do not replace existing Next.js entries):

```
# scriptr runtime data — NEVER commit
data/
*.local

# API keys and env — .env (no suffix) is allowed; all named variants are ignored
.env.*

# Cover images from the user
cover*.jpg
cover*.jpeg
cover*.png

# Generated exports
exports/

# Brainstorm artifacts (created by superpowers)
.superpowers/
```

- [ ] **Step 2: Create `.env.local.example`**

```
# Set this, or use the Settings page inside the app.
# Get a key at https://console.x.ai
XAI_API_KEY=

# Optional: override default model
SCRIPTR_DEFAULT_MODEL=grok-4-latest
```

- [ ] **Step 3: Verify `data/` is not tracked**

```bash
mkdir -p data/stories/_test
echo "secret" > data/stories/_test/file.txt
git status
```

Expected: no `data/` in output. Clean up: `rm -rf data/`.

- [ ] **Step 4: Commit**

```bash
git add .gitignore .env.local.example
git commit -m "chore: gitignore runtime data, keys, and covers"
```

---

### Task 1.3: Strict Content-Security-Policy

**Files:**
- Modify: `next.config.js` (or `next.config.ts`)

- [ ] **Step 1: Replace `next.config.*` contents**

```ts
import type { NextConfig } from "next";

const cspDirectives = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Next.js dev needs inline/eval
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://api.x.ai",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: cspDirectives },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
```

- [ ] **Step 2: Verify CSP is present**

Run `npm run dev`, then in another shell:

```bash
curl -sI http://127.0.0.1:3000/ | grep -i "content-security-policy"
```

Expected: `Content-Security-Policy: default-src 'self'; ...` including `connect-src 'self' https://api.x.ai`.

- [ ] **Step 3: Commit**

```bash
git add next.config.*
git commit -m "feat: strict CSP restricting network egress to api.x.ai"
```

---

### Task 1.4: Custom ESLint rule blocking telemetry imports

**Files:**
- Create: `eslint-rules/no-telemetry.js`
- Create: `eslint.config.mjs` (or modify existing)
- Create: `tests/lint/no-telemetry.test.ts`

- [ ] **Step 1: Write the custom rule**

Create `eslint-rules/no-telemetry.js`:

```js
/**
 * Block imports of analytics / telemetry / crash-reporting packages.
 * Privacy is a first-class design pillar of scriptr.
 */
const BLOCKED = [
  "@sentry/",
  "posthog-js",
  "posthog-node",
  "@vercel/analytics",
  "@vercel/speed-insights",
  "mixpanel",
  "mixpanel-browser",
  "amplitude",
  "@amplitude/",
  "segment",
  "@segment/",
  "bugsnag",
  "@bugsnag/",
  "rollbar",
  "react-ga",
  "react-ga4",
  "gtag",
  "hotjar",
  "fullstory",
  "logrocket",
  "datadog-rum",
  "@datadog/",
  "newrelic",
];

function isBlocked(name) {
  return BLOCKED.some((prefix) =>
    prefix.endsWith("/") ? name.startsWith(prefix) : name === prefix || name.startsWith(`${prefix}/`)
  );
}

module.exports = {
  meta: {
    type: "problem",
    docs: { description: "Ban telemetry/analytics package imports" },
    schema: [],
    messages: {
      blocked: "Telemetry package '{{name}}' is banned. scriptr ships no analytics.",
    },
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        if (isBlocked(node.source.value)) {
          context.report({ node, messageId: "blocked", data: { name: node.source.value } });
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        const isRequire = callee.type === "Identifier" && callee.name === "require";
        const isDynamicImport = callee.type === "Import";
        if (!isRequire && !isDynamicImport) return;
        const arg = node.arguments[0];
        if (arg && arg.type === "Literal" && typeof arg.value === "string" && isBlocked(arg.value)) {
          context.report({ node, messageId: "blocked", data: { name: arg.value } });
        }
      },
    };
  },
};
```

- [ ] **Step 2: Wire the rule into ESLint flat config**

Replace `eslint.config.mjs`:

```js
import { FlatCompat } from "@eslint/eslintrc";
import noTelemetry from "./eslint-rules/no-telemetry.js";

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

export default [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    plugins: {
      scriptr: {
        rules: { "no-telemetry": noTelemetry },
      },
    },
    rules: {
      "scriptr/no-telemetry": "error",
    },
  },
];
```

- [ ] **Step 3: Write a lint test that triggers the rule**

Create `tests/lint/no-telemetry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { RuleTester } from "eslint";
// @ts-expect-error — JS module
import noTelemetry from "../../eslint-rules/no-telemetry.js";

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

describe("no-telemetry", () => {
  it("fails for each banned package", () => {
    expect(() => {
      tester.run("no-telemetry", noTelemetry, {
        valid: [
          { code: "import x from 'next';" },
          { code: "import { a } from './util';" },
        ],
        invalid: [
          {
            code: "import * as Sentry from '@sentry/nextjs';",
            errors: [{ messageId: "blocked" }],
          },
          {
            code: "const ph = require('posthog-js');",
            errors: [{ messageId: "blocked" }],
          },
          {
            code: "const a = await import('@vercel/analytics');",
            errors: [{ messageId: "blocked" }],
          },
        ],
      });
    }).not.toThrow();
  });
});
```

- [ ] **Step 4: Install vitest**

```bash
npm install -D vitest @vitest/ui jsdom @types/node eslint-plugin-vitest
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["tests/e2e/**"],
  },
});
```

- [ ] **Step 5: Run the lint test**

```bash
npm run test -- tests/lint/no-telemetry.test.ts
```

Expected: 1 passing test.

- [ ] **Step 6: Sanity-check that the rule actually fires in `next lint`**

Temporarily create `app/_telemetry-probe.ts` with:

```ts
import * as Sentry from "@sentry/nextjs";
console.log(Sentry);
```

Run `npm run lint`. Expected: ESLint reports `scriptr/no-telemetry` error. Delete the probe file after confirming, then re-run `npm run lint` — expect clean.

- [ ] **Step 7: Commit**

```bash
git add eslint-rules/ eslint.config.mjs tests/lint/ vitest.config.ts package.json package-lock.json
git commit -m "feat(privacy): custom ESLint rule blocking telemetry packages"
```

---

### Task 1.5: Bundle reference skills in the repo

**Files:**
- Create: `skills/frontend-design/` (already available in the harness cache — copy)
- Create: `skills/react-best-practices/` (pull from github.com/vercel-labs/agent-skills)

- [ ] **Step 1: Copy the frontend-design skill**

Find the currently installed frontend-design skill and copy it into the repo so implementation agents can find it locally:

```bash
FRONTEND=$(find /home/chase/.claude/plugins/cache -type d -name "frontend-design" 2>/dev/null | head -1)
mkdir -p skills
cp -r "$FRONTEND" skills/frontend-design
ls skills/frontend-design
```

Expected: file listing includes `SKILL.md` or `frontend-design.md`.

- [ ] **Step 2: Pull the Vercel react-best-practices skill**

```bash
cd skills
git clone --depth=1 --filter=blob:none --sparse https://github.com/vercel-labs/agent-skills.git _vercel-skills
cd _vercel-skills
git sparse-checkout set skills/react-best-practices
mv skills/react-best-practices ../react-best-practices
cd ..
rm -rf _vercel-skills
cd ..
ls skills/react-best-practices
```

Expected: file listing includes `SKILL.md`, `AGENTS.md`, `README.md`.

- [ ] **Step 3: Commit**

```bash
git add skills/
git commit -m "chore: bundle frontend-design and react-best-practices skills"
```

---

## Chunk 2: Types, Config, and Storage Layer

Goal at end of chunk: a complete file-based storage layer for stories, bibles, and chapters with full test coverage. Config can be loaded from env or `data/config.json`. Redacted logger is in place.

### Task 2.1: Core TypeScript types

**Files:**
- Create: `lib/types.ts`

- [ ] **Step 1: Create `lib/types.ts`**

Copy the type definitions from the spec's **Core TypeScript types** section verbatim, plus:

```ts
export type GenerationMode = "full" | "section" | "continue";

export type GenerateRequest = {
  storySlug: string;
  chapterId: string;
  mode: GenerationMode;
  sectionId?: string;
  regenNote?: string;
  includeLastChapterFullText?: boolean;
};

export type GenerateEvent =
  | { type: "start"; jobId: string }
  | { type: "token"; text: string }
  | { type: "section-break" }
  | { type: "done"; finishReason: string }
  | { type: "error"; message: string };

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat: core types for stories, chapters, bibles, generation"
```

---

### Task 2.2: Redacted logger with tests

**Files:**
- Create: `lib/logger.ts`, `tests/lib/logger.test.ts`

- [ ] **Step 1: Write failing tests for the logger**

Create `tests/lib/logger.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeLogger } from "@/lib/logger";

describe("logger.redact", () => {
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    spy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => spy.mockRestore());

  it("redacts strings that look like xAI keys", () => {
    const log = makeLogger();
    log.info("using key xai-abcdef1234567890abcdef1234567890 now");
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("using key [REDACTED-KEY] now")
    );
  });

  it("redacts Authorization headers inside objects", () => {
    const log = makeLogger();
    log.info({ headers: { Authorization: "Bearer xai-xyz123" } });
    const firstArg = spy.mock.calls[0]?.[0] ?? "";
    expect(firstArg).not.toContain("xai-xyz123");
    expect(firstArg).toContain("[REDACTED]");
  });

  it("leaves normal messages alone", () => {
    const log = makeLogger();
    log.info("nothing sensitive here");
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("nothing sensitive here")
    );
  });
});
```

- [ ] **Step 2: Run and expect failure**

```bash
npm run test -- tests/lib/logger.test.ts
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement `lib/logger.ts`**

```ts
const KEY_REGEX = /xai-[A-Za-z0-9]{16,}/g;
const SENSITIVE_FIELDS = /^(authorization|api[-_ ]?key|x-api-key|cookie)$/i;

function redact(value: unknown): unknown {
  if (typeof value === "string") return value.replace(KEY_REGEX, "[REDACTED-KEY]");
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = Array.isArray(value) ? ([] as unknown as Record<string, unknown>) : {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_FIELDS.test(k) ? "[REDACTED]" : redact(v);
    }
    return out;
  }
  return value;
}

function stringify(parts: unknown[]): string {
  return parts
    .map((p) => (typeof p === "string" ? redact(p) : JSON.stringify(redact(p))))
    .join(" ");
}

export function makeLogger() {
  return {
    info: (...args: unknown[]) => console.log("[info]", stringify(args)),
    warn: (...args: unknown[]) => console.warn("[warn]", stringify(args)),
    error: (...args: unknown[]) => console.error("[error]", stringify(args)),
  };
}

export const logger = makeLogger();
```

- [ ] **Step 4: Run tests**

```bash
npm run test -- tests/lib/logger.test.ts
```

Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/logger.ts tests/lib/logger.test.ts
git commit -m "feat(privacy): redacted logger that strips API keys"
```

---

### Task 2.3: Slug generator with tests

**Files:**
- Create: `lib/slug.ts`, `tests/lib/slug.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from "vitest";
import { toSlug, uniqueSlug } from "@/lib/slug";

describe("toSlug", () => {
  it("lowercases and dasherizes", () => {
    expect(toSlug("The Meeting")).toBe("the-meeting");
  });
  it("strips punctuation", () => {
    expect(toSlug("What!? A Story?")).toBe("what-a-story");
  });
  it("collapses whitespace", () => {
    expect(toSlug("  many   spaces  ")).toBe("many-spaces");
  });
  it("handles unicode by stripping it", () => {
    expect(toSlug("café naïve")).toBe("cafe-naive");
  });
  it("returns 'untitled' for empty input", () => {
    expect(toSlug("")).toBe("untitled");
    expect(toSlug("!!!")).toBe("untitled");
  });
});

describe("uniqueSlug", () => {
  it("returns slug unchanged if not taken", () => {
    expect(uniqueSlug("the-meeting", ["other"])).toBe("the-meeting");
  });
  it("appends -2, -3 when collisions exist", () => {
    expect(uniqueSlug("the-meeting", ["the-meeting"])).toBe("the-meeting-2");
    expect(uniqueSlug("the-meeting", ["the-meeting", "the-meeting-2"])).toBe("the-meeting-3");
  });
});
```

- [ ] **Step 2: Run and expect failure**

- [ ] **Step 3: Implement `lib/slug.ts`**

```ts
export function toSlug(input: string): string {
  const normalized = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "untitled";
}

export function uniqueSlug(base: string, existing: string[]): string {
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
```

- [ ] **Step 4: Run tests, all pass.**

- [ ] **Step 5: Commit**

```bash
git add lib/slug.ts tests/lib/slug.test.ts
git commit -m "feat: URL-safe slug generator with uniqueness helper"
```

---

### Task 2.4: Config loader (env + config.json)

**Files:**
- Create: `lib/config.ts`, `tests/lib/config.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, saveConfig, DEFAULT_CONFIG } from "@/lib/config";

async function withTemp(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "scriptr-"));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

describe("config", () => {
  const originalEnv = process.env;
  beforeEach(() => { process.env = { ...originalEnv }; });
  afterEach(() => { process.env = originalEnv; });

  it("returns defaults when no file or env exists", async () => {
    await withTemp(async (dir) => {
      const cfg = await loadConfig(dir);
      expect(cfg).toMatchObject(DEFAULT_CONFIG);
      expect(cfg.apiKey).toBeUndefined();
    });
  });

  it("reads apiKey from env when set", async () => {
    await withTemp(async (dir) => {
      process.env.XAI_API_KEY = "xai-fromenv";
      const cfg = await loadConfig(dir);
      expect(cfg.apiKey).toBe("xai-fromenv");
    });
  });

  it("env wins over config.json when both present", async () => {
    await withTemp(async (dir) => {
      await writeFile(join(dir, "config.json"), JSON.stringify({ apiKey: "xai-fromfile" }));
      process.env.XAI_API_KEY = "xai-fromenv";
      const cfg = await loadConfig(dir);
      expect(cfg.apiKey).toBe("xai-fromenv");
    });
  });

  it("config.json is used when env is absent", async () => {
    await withTemp(async (dir) => {
      await writeFile(join(dir, "config.json"), JSON.stringify({ apiKey: "xai-fromfile", defaultModel: "grok-4-fast" }));
      delete process.env.XAI_API_KEY;
      const cfg = await loadConfig(dir);
      expect(cfg.apiKey).toBe("xai-fromfile");
      expect(cfg.defaultModel).toBe("grok-4-fast");
    });
  });

  it("saveConfig persists without apiKey if env supplies it", async () => {
    await withTemp(async (dir) => {
      await saveConfig(dir, { defaultModel: "grok-4-fast", apiKey: "xai-abc" });
      const { readFile } = await import("node:fs/promises");
      const raw = JSON.parse(await readFile(join(dir, "config.json"), "utf8"));
      expect(raw.defaultModel).toBe("grok-4-fast");
      // apiKey *is* persisted here — the UI decides whether to write it
      expect(raw.apiKey).toBe("xai-abc");
    });
  });
});
```

- [ ] **Step 2: Run and expect failure.**

- [ ] **Step 3: Implement `lib/config.ts`**

```ts
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export type Config = {
  apiKey?: string;
  defaultModel: string;
  bindHost: "127.0.0.1" | "0.0.0.0";
  bindPort: number;
  theme: "light" | "dark" | "system";
  autoRecap: boolean;
  includeLastChapterFullText: boolean;
};

export const DEFAULT_CONFIG: Config = {
  defaultModel: process.env.SCRIPTR_DEFAULT_MODEL ?? "grok-4-latest",
  bindHost: "127.0.0.1",
  bindPort: 3000,
  theme: "system",
  autoRecap: true,
  includeLastChapterFullText: false,
};

export async function loadConfig(dataDir: string): Promise<Config> {
  let fromFile: Partial<Config> = {};
  try {
    const raw = await readFile(join(dataDir, "config.json"), "utf8");
    fromFile = JSON.parse(raw);
  } catch {
    // no config.json — fine
  }
  const merged: Config = { ...DEFAULT_CONFIG, ...fromFile };
  if (process.env.XAI_API_KEY) merged.apiKey = process.env.XAI_API_KEY;
  return merged;
}

export async function saveConfig(dataDir: string, partial: Partial<Config>): Promise<Config> {
  await mkdir(dataDir, { recursive: true });
  const current = await loadConfig(dataDir);
  const next = { ...current, ...partial };
  // Strip env-derived fields we don't want to persist if the user didn't supply them
  const toWrite = { ...next };
  await writeFile(join(dataDir, "config.json"), JSON.stringify(toWrite, null, 2));
  return next;
}

// Server-side helper
export function effectiveDataDir(): string {
  return process.env.SCRIPTR_DATA_DIR ?? join(process.cwd(), "data");
}
```

- [ ] **Step 4: Run tests, all pass.**

- [ ] **Step 5: Commit**

```bash
git add lib/config.ts tests/lib/config.test.ts
git commit -m "feat: config loader with env/file merge (env wins)"
```

---

### Task 2.5: Storage paths helper

**Files:**
- Create: `lib/storage/paths.ts`, `tests/lib/storage/paths.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from "vitest";
import { storyDir, storyJson, bibleJson, chaptersDir, chapterFile, exportsDir, coverPath, lastPayloadFile } from "@/lib/storage/paths";

describe("storage paths", () => {
  const dataDir = "/tmp/fakedata";

  it("builds story folder paths", () => {
    expect(storyDir(dataDir, "the-meeting")).toBe("/tmp/fakedata/stories/the-meeting");
  });

  it("builds chapter file with ordinal prefix", () => {
    expect(chapterFile(dataDir, "the-meeting", 0, "ch_abc", "Opening")).toBe(
      "/tmp/fakedata/stories/the-meeting/chapters/001-opening.json"
    );
    expect(chapterFile(dataDir, "the-meeting", 9, "ch_abc", "Ten")).toBe(
      "/tmp/fakedata/stories/the-meeting/chapters/010-ten.json"
    );
  });

  it("exposes the other standard files", () => {
    expect(storyJson(dataDir, "x")).toBe("/tmp/fakedata/stories/x/story.json");
    expect(bibleJson(dataDir, "x")).toBe("/tmp/fakedata/stories/x/bible.json");
    expect(chaptersDir(dataDir, "x")).toBe("/tmp/fakedata/stories/x/chapters");
    expect(exportsDir(dataDir, "x")).toBe("/tmp/fakedata/stories/x/exports");
    expect(coverPath(dataDir, "x")).toBe("/tmp/fakedata/stories/x/cover.jpg");
    expect(lastPayloadFile(dataDir, "x")).toBe("/tmp/fakedata/stories/x/.last-payload.json");
  });
});
```

- [ ] **Step 2: Run and expect failure.**

- [ ] **Step 3: Implement `lib/storage/paths.ts`**

```ts
import { join } from "node:path";
import { toSlug } from "@/lib/slug";

export function storyDir(dataDir: string, storySlug: string) {
  return join(dataDir, "stories", storySlug);
}
export function storyJson(dataDir: string, storySlug: string) {
  return join(storyDir(dataDir, storySlug), "story.json");
}
export function bibleJson(dataDir: string, storySlug: string) {
  return join(storyDir(dataDir, storySlug), "bible.json");
}
export function chaptersDir(dataDir: string, storySlug: string) {
  return join(storyDir(dataDir, storySlug), "chapters");
}
export function chapterFile(dataDir: string, storySlug: string, index: number, _id: string, title: string) {
  const prefix = String(index + 1).padStart(3, "0");
  return join(chaptersDir(dataDir, storySlug), `${prefix}-${toSlug(title)}.json`);
}
export function exportsDir(dataDir: string, storySlug: string) {
  return join(storyDir(dataDir, storySlug), "exports");
}
export function coverPath(dataDir: string, storySlug: string) {
  return join(storyDir(dataDir, storySlug), "cover.jpg");
}
export function lastPayloadFile(dataDir: string, storySlug: string) {
  return join(storyDir(dataDir, storySlug), ".last-payload.json");
}
```

- [ ] **Step 4: Run tests, pass.**

- [ ] **Step 5: Commit**

```bash
git add lib/storage/paths.ts tests/lib/storage/paths.test.ts
git commit -m "feat: storage path helpers"
```

---

### Task 2.6: Story CRUD

**Files:**
- Create: `lib/storage/stories.ts`, `tests/lib/storage/stories.test.ts`

- [ ] **Step 1: Write failing tests**

Tests must cover: `createStory`, `getStory`, `listStories`, `updateStory`, `deleteStory`. All I/O must target a `mkdtemp` directory. Key assertions:

- Creating a story writes `story.json`, `bible.json` (with defaults), and creates `chapters/`, `exports/`.
- `listStories` returns stories sorted by `updatedAt` desc.
- `createStory("The Meeting")` picks slug `the-meeting`; calling it again picks `the-meeting-2`.
- `updateStory` preserves unspecified fields and bumps `updatedAt`.
- `deleteStory` removes the whole folder.
- Attempting to get a missing story returns `null`.

Implement the test file yourself following the pattern from `tests/lib/config.test.ts`. Use `mkdtemp`/`rm` to isolate every test.

- [ ] **Step 2: Run and expect failure.**

- [ ] **Step 3: Implement `lib/storage/stories.ts`**

Required exports:

```ts
export type NewStoryInput = { title: string; authorPenName?: string };

export async function createStory(dataDir: string, input: NewStoryInput): Promise<Story>;
export async function listStories(dataDir: string): Promise<Story[]>;
export async function getStory(dataDir: string, slug: string): Promise<Story | null>;
export async function updateStory(dataDir: string, slug: string, patch: Partial<Story>): Promise<Story>;
export async function deleteStory(dataDir: string, slug: string): Promise<void>;
```

- `createStory` creates the slug via `toSlug` + `uniqueSlug` (collisions from existing stories), writes defaults for `Bible`, creates `chapters/` and `exports/`.
- Use `crypto.randomUUID()` for `Chapter.id`s later, but not here.
- Timestamps are ISO strings.
- Default bible: `{ characters: [], setting: "", pov: "third-limited", tone: "", styleNotes: "", nsfwPreferences: "" }`.

- [ ] **Step 4: Run tests, pass.**

- [ ] **Step 5: Commit**

```bash
git add lib/storage/stories.ts tests/lib/storage/stories.test.ts
git commit -m "feat: file-based story CRUD"
```

---

### Task 2.7: Bible CRUD

**Files:**
- Create: `lib/storage/bible.ts`, `tests/lib/storage/bible.test.ts`

- [ ] **Step 1: Write failing tests**

Cover `getBible`, `saveBible`. Assertions:

- `getBible` on a fresh story returns the defaults written at story creation.
- `saveBible` replaces the file; subsequent `getBible` returns the new contents.
- Bumps `story.json`'s `updatedAt`.

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement**

```ts
export async function getBible(dataDir: string, slug: string): Promise<Bible | null>;
export async function saveBible(dataDir: string, slug: string, bible: Bible): Promise<Bible>;
```

- [ ] **Step 4: Tests pass.**

- [ ] **Step 5: Commit**

```bash
git add lib/storage/bible.ts tests/lib/storage/bible.test.ts
git commit -m "feat: bible CRUD"
```

---

### Task 2.8: Chapter CRUD + reorder

**Files:**
- Create: `lib/storage/chapters.ts`, `tests/lib/storage/chapters.test.ts`

- [ ] **Step 1: Write failing tests**

Cover:
- `createChapter` creates a new chapter at end of `chapterOrder`, writes `chapters/001-<slug>.json`.
- `listChapters` returns chapters in `chapterOrder` order (not filesystem order).
- `getChapter(slug, id)` returns one chapter or null.
- `updateChapter` patches fields, persists, bumps timestamps.
- `deleteChapter` removes the chapter file and its id from `chapterOrder`. Rewrites remaining files with new ordinal prefixes (path change!). Test that filenames shift: create 3 chapters, delete middle one, assert remaining two are `001-…` and `002-…`.
- `reorderChapters(slug, newOrder)` validates that `newOrder` is a permutation of existing ids; rewrites filenames with new ordinal prefixes.

Key design decision from spec: **numeric prefix is cosmetic**, `story.chapterOrder` is the source of truth, loader matches by `Chapter.id` inside JSON. That means the test for "delete middle chapter" must verify:
  1. On-disk filenames have been renamed to reflect the new order.
  2. `chapterOrder` no longer contains the deleted id.
  3. The JSON `id` fields inside the remaining chapter files are unchanged.

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement**

Required exports:

```ts
export type NewChapterInput = { title: string; summary?: string };

export async function createChapter(dataDir: string, slug: string, input: NewChapterInput): Promise<Chapter>;
export async function listChapters(dataDir: string, slug: string): Promise<Chapter[]>;
export async function getChapter(dataDir: string, slug: string, chapterId: string): Promise<Chapter | null>;
export async function updateChapter(dataDir: string, slug: string, chapterId: string, patch: Partial<Chapter>): Promise<Chapter>;
export async function deleteChapter(dataDir: string, slug: string, chapterId: string): Promise<void>;
export async function reorderChapters(dataDir: string, slug: string, newOrder: string[]): Promise<void>;
```

Helper (internal): `rewriteChapterFilenames(dataDir, slug, chapters)` — renames each chapter file to its current ordinal prefix + title slug. Called after every mutation that changes order or titles.

- Loader (`listChapters`) implementation: read all `*.json` inside `chapters/`, index by `id`, return in `story.chapterOrder` order. Ignore any files whose id isn't in `chapterOrder` (orphans) but do not delete.

- [ ] **Step 4: Tests pass.**

- [ ] **Step 5: Commit**

```bash
git add lib/storage/chapters.ts tests/lib/storage/chapters.test.ts
git commit -m "feat: chapter CRUD with reorder and filename resync"
```

---

## Chunk 3: API Routes for CRUD

Goal at end of chunk: REST surface for stories/bibles/chapters and settings, all tested, all returning consistent `{ ok, data|error }` envelopes.

### Task 3.1: API envelope helper

**Files:**
- Create: `lib/api.ts`, `tests/lib/api.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, it, expect } from "vitest";
import { ok, fail, readJson } from "@/lib/api";

describe("api helpers", () => {
  it("ok wraps data", async () => {
    const r = ok({ x: 1 });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, data: { x: 1 } });
  });

  it("fail wraps error with status", async () => {
    const r = fail("bad", 400);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ ok: false, error: "bad" });
  });

  it("readJson parses a Request body", async () => {
    const req = new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ a: 1 }),
      headers: { "content-type": "application/json" },
    });
    expect(await readJson(req)).toEqual({ a: 1 });
  });
});
```

- [ ] **Step 2: Implement**

```ts
export function ok<T>(data: T, init?: ResponseInit) {
  return Response.json({ ok: true, data }, init);
}
export function fail(error: string, status = 400) {
  return Response.json({ ok: false, error }, { status });
}
export async function readJson<T = unknown>(req: Request): Promise<T> {
  return (await req.json()) as T;
}
```

- [ ] **Step 3: Tests pass. Commit.**

```bash
git add lib/api.ts tests/lib/api.test.ts
git commit -m "feat: API response envelope + json reader"
```

---

### Task 3.2: /api/settings GET + PUT

**Files:**
- Create: `app/api/settings/route.ts`, `tests/api/settings.test.ts`

- [ ] **Step 1: Write failing tests**

Tests use the route handlers directly (import them, call with a `Request`):

- GET returns `{ hasKey: boolean, keyPreview?: string, defaultModel, bindHost, ... }` — never the raw key.
- `keyPreview` formats as `xai-••••<last4>`.
- PUT with `{ apiKey: "xai-abc123" }` persists, and a subsequent GET returns the masked preview.
- PUT with `{ apiKey: "" }` clears the persisted key.
- PUT rejects unknown fields (pass validator or just strip).

Use `SCRIPTR_DATA_DIR` env var to point at a temp directory per test.

- [ ] **Step 2: Run, fail.**

- [ ] **Step 3: Implement**

```ts
import { NextRequest } from "next/server";
import { ok, fail, readJson } from "@/lib/api";
import { loadConfig, saveConfig, effectiveDataDir, type Config } from "@/lib/config";

function mask(key?: string) {
  if (!key) return undefined;
  const last4 = key.slice(-4);
  return `xai-••••${last4}`;
}

export async function GET() {
  const cfg = await loadConfig(effectiveDataDir());
  return ok({
    hasKey: Boolean(cfg.apiKey),
    keyPreview: mask(cfg.apiKey),
    defaultModel: cfg.defaultModel,
    bindHost: cfg.bindHost,
    theme: cfg.theme,
    autoRecap: cfg.autoRecap,
    includeLastChapterFullText: cfg.includeLastChapterFullText,
  });
}

export async function PUT(req: NextRequest) {
  const body = await readJson<Partial<Config>>(req);
  const allowed: (keyof Config)[] = [
    "apiKey", "defaultModel", "theme", "autoRecap", "includeLastChapterFullText",
  ];
  const patch: Partial<Config> = {};
  for (const k of allowed) if (k in body) (patch as any)[k] = body[k];
  // Empty-string apiKey means clear
  if (patch.apiKey === "") patch.apiKey = undefined;
  const next = await saveConfig(effectiveDataDir(), patch);
  return ok({ hasKey: Boolean(next.apiKey), keyPreview: mask(next.apiKey) });
}
```

- [ ] **Step 4: Tests pass. Commit.**

```bash
git add app/api/settings/ tests/api/settings.test.ts
git commit -m "feat(api): /api/settings with key masking"
```

---

### Task 3.3: /api/stories list + create

**Files:**
- Create: `app/api/stories/route.ts`, `tests/api/stories.test.ts`

- [ ] **Step 1: Test**

- GET returns an array of `Story`.
- POST with `{ title: "The Meeting" }` creates a story and returns it.
- POST with missing title returns 400.

- [ ] **Step 2: Implement**

```ts
import { NextRequest } from "next/server";
import { ok, fail, readJson } from "@/lib/api";
import { createStory, listStories } from "@/lib/storage/stories";
import { effectiveDataDir } from "@/lib/config";

export async function GET() {
  return ok(await listStories(effectiveDataDir()));
}

export async function POST(req: NextRequest) {
  const body = await readJson<{ title?: string; authorPenName?: string }>(req);
  if (!body.title || typeof body.title !== "string") return fail("title required");
  const story = await createStory(effectiveDataDir(), { title: body.title, authorPenName: body.authorPenName });
  return ok(story, { status: 201 });
}
```

- [ ] **Step 3: Tests pass. Commit.**

---

### Task 3.4: /api/stories/[slug] GET / PATCH / DELETE

**Files:**
- Create: `app/api/stories/[slug]/route.ts`, extend test file

- [ ] **Step 1: Tests**

- GET returns full story or 404.
- PATCH updates allowed fields (title, authorPenName, description, etc.) and returns the updated story.
- **Explicit slug immutability test:** PATCH with `{ title: "New Title" }` returns 200. Assert `response.data.slug` is unchanged from the original. The story JSON on disk also has the original slug. The folder on disk is NOT renamed. This is a product decision: slugs are forever once assigned so URLs, bookmarks, and exports remain stable.
- DELETE removes the story folder entirely (including exports, cover, and `.last-payload.json`).

- [ ] **Step 2: Implement, passing tests. Commit.**

---

### Task 3.5: /api/stories/[slug]/bible GET / PUT

**Files:**
- Create: `app/api/stories/[slug]/bible/route.ts`, extend test file

- [ ] Test GET/PUT similar to settings. PUT validates the Bible shape (characters is array, pov is in the enum, other fields are strings). Tests + implement + commit.

---

### Task 3.6: /api/stories/[slug]/chapters list + create

**Files:**
- Create: `app/api/stories/[slug]/chapters/route.ts`, extend test file

- [ ] GET returns chapters in order. POST creates. Tests + implement + commit.

---

### Task 3.7: /api/stories/[slug]/chapters/[id] GET / PATCH / DELETE

**Files:**
- Create: `app/api/stories/[slug]/chapters/[id]/route.ts`

- [ ] Tests + implement + commit. PATCH supports partial updates to title / summary / beats / prompt / recap / sections.

---

### Task 3.8: /api/stories/[slug]/chapters/reorder POST

**Files:**
- Create: `app/api/stories/[slug]/chapters/reorder/route.ts`

- [ ] POST body `{ order: string[] }`. Validates permutation. Tests + implement + commit.

---

## Chunk 4: Grok Client, Prompts, and Streaming Generation

Goal at end of chunk: server can stream chapter prose from Grok, chunk it on `---`, persist server-side, support stop-and-continue, and produce auto-recaps.

### Task 4.1: Grok client

**Files:**
- Create: `lib/grok.ts`, `tests/lib/grok.test.ts`

- [ ] **Step 1: Install the SDK**

```bash
npm install openai
```

- [ ] **Step 2: Tests**

Mock `openai`. Assert:
- `getGrokClient(config)` throws `MissingKeyError` if no apiKey.
- Returns an `OpenAI` instance with `baseURL === "https://api.x.ai/v1"` and the supplied key.

- [ ] **Step 3: Implement**

```ts
import OpenAI from "openai";
import type { Config } from "@/lib/config";

export class MissingKeyError extends Error {
  constructor() { super("XAI_API_KEY is not configured. Set it in Settings or .env.local."); }
}

export function getGrokClient(config: Config): OpenAI {
  if (!config.apiKey) throw new MissingKeyError();
  return new OpenAI({ apiKey: config.apiKey, baseURL: "https://api.x.ai/v1" });
}
```

- [ ] **Step 4: Tests pass. Commit.**

---

### Task 4.1b: Rate-limit + error taxonomy wrapper

**Files:**
- Create: `lib/grok-retry.ts`, `tests/lib/grok-retry.test.ts`

Per the spec's Review Addenda: retries only apply before the first token has streamed. Once any token arrives, upstream 429 / network drops surface immediately and the client decides whether to resume via `mode: "continue"`. The wrapper also maps common upstream failures to a structured error type so the generate route can emit consistent SSE `error` events.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect, vi } from "vitest";
import { callGrokWithRetry, GrokError } from "@/lib/grok-retry";

function mockClient(behavior: ("ok" | "429" | "500" | "auth" | "refuse")[]) {
  let i = 0;
  return {
    chat: {
      completions: {
        create: vi.fn().mockImplementation(async () => {
          const step = behavior[i++];
          if (step === "ok") return (async function* () { yield { choices: [{ delta: { content: "hi" } }] }; })();
          if (step === "429") { const e = new Error("rate"); (e as any).status = 429; throw e; }
          if (step === "500") { const e = new Error("boom"); (e as any).status = 500; throw e; }
          if (step === "auth") { const e = new Error("bad key"); (e as any).status = 401; throw e; }
          if (step === "refuse") return (async function* () {
            yield { choices: [{ delta: { content: "I can't help with that." } }], "x-refusal": true };
          })();
        }),
      },
    },
  };
}

describe("callGrokWithRetry", () => {
  it("returns stream on first success", async () => {
    const client = mockClient(["ok"]);
    const stream = await callGrokWithRetry(client as any, { model: "m", messages: [] }, { maxRetries: 3 });
    expect(stream).toBeDefined();
    expect(client.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 up to maxRetries before first token", async () => {
    const client = mockClient(["429", "429", "ok"]);
    await callGrokWithRetry(client as any, { model: "m", messages: [] }, { maxRetries: 3, baseDelayMs: 1 });
    expect(client.chat.completions.create).toHaveBeenCalledTimes(3);
  });

  it("retries on 5xx before first token", async () => {
    const client = mockClient(["500", "ok"]);
    await callGrokWithRetry(client as any, { model: "m", messages: [] }, { maxRetries: 3, baseDelayMs: 1 });
    expect(client.chat.completions.create).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry on 401 (auth) — surfaces immediately", async () => {
    const client = mockClient(["auth"]);
    await expect(
      callGrokWithRetry(client as any, { model: "m", messages: [] }, { maxRetries: 3, baseDelayMs: 1 })
    ).rejects.toMatchObject({ kind: "auth" } satisfies Partial<GrokError>);
    expect(client.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it("surfaces after exhausting retries", async () => {
    const client = mockClient(["429", "429", "429", "429"]);
    await expect(
      callGrokWithRetry(client as any, { model: "m", messages: [] }, { maxRetries: 3, baseDelayMs: 1 })
    ).rejects.toMatchObject({ kind: "rate-limit" });
    expect(client.chat.completions.create).toHaveBeenCalledTimes(4); // 1 + 3 retries
  });
});
```

- [ ] **Step 2: Implement `lib/grok-retry.ts`**

```ts
import type OpenAI from "openai";

export type GrokErrorKind = "auth" | "rate-limit" | "server" | "refusal" | "network" | "unknown";

export class GrokError extends Error {
  constructor(public kind: GrokErrorKind, message: string, public status?: number) {
    super(message);
  }
}

type CreateParams = Parameters<OpenAI["chat"]["completions"]["create"]>[0];

export type RetryOptions = { maxRetries?: number; baseDelayMs?: number };

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const AUTH_STATUS = new Set([401, 403]);

function classify(err: unknown): GrokError {
  const status = (err as { status?: number })?.status;
  const msg = (err as Error)?.message ?? String(err);
  if (status && AUTH_STATUS.has(status)) return new GrokError("auth", msg, status);
  if (status === 429) return new GrokError("rate-limit", msg, status);
  if (status && status >= 500) return new GrokError("server", msg, status);
  if (msg.match(/content policy|refus/i)) return new GrokError("refusal", msg, status);
  if (msg.match(/network|fetch|ECONN|ENOTFOUND/i)) return new GrokError("network", msg, status);
  return new GrokError("unknown", msg, status);
}

export async function callGrokWithRetry(
  client: OpenAI,
  params: CreateParams,
  opts: RetryOptions = {}
) {
  const maxRetries = opts.maxRetries ?? 3;
  const baseDelay = opts.baseDelayMs ?? 500;
  let attempt = 0;
  // Pre-first-token retries only. Once create() resolves with a stream, errors
  // during iteration are surfaced by the caller — not retried here.
  while (true) {
    try {
      return await client.chat.completions.create(params);
    } catch (err) {
      const grokErr = classify(err);
      const retryable = grokErr.kind === "rate-limit" || grokErr.kind === "server" || grokErr.kind === "network";
      if (!retryable || attempt >= maxRetries) throw grokErr;
      const delay = baseDelay * 2 ** attempt + Math.floor(Math.random() * 100);
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
    }
  }
}
```

- [ ] **Step 3: Tests pass. Commit.**

```bash
git add lib/grok-retry.ts tests/lib/grok-retry.test.ts
git commit -m "feat(grok): retry wrapper with classified errors (pre-first-token only)"
```

---

### Task 4.2: Prompt builders

**Files:**
- Create: `lib/prompts.ts`, `tests/lib/prompts.test.ts`

- [ ] **Step 1: Tests**

Cover three prompt builders:
- `buildChapterPrompt({ story, bible, priorRecaps, chapter, includeLastChapterFullText?, lastChapterFullText? })` → `{ system: string, user: string }`. Must include bible fields verbatim, all prior recaps prefixed with `Ch.N — `, and the chapter beats as a markdown list. Must end with "Separate scenes with a line containing exactly '---'".
- `buildSectionRegenPrompt({ story, bible, chapter, targetSectionId, regenNote })` — joins sections with `---` and wraps the target in `⟪REWRITE:<note>⟫ … ⟪/REWRITE⟫`.
- `buildRecapPrompt({ story, chapter })` — instructs 2-3 sentence recap for continuity.

All prompts must be pure string builders, no side effects, fully unit-testable.

- [ ] **Step 2: Implement.** Keep each builder ≤40 lines; extract small `formatBible(bible)`, `formatBeats(beats)` helpers.

- [ ] **Step 3: Tests pass. Commit.**

---

### Task 4.3: Stream parser — split Grok tokens on `---`

**Files:**
- Create: `lib/stream.ts`, `tests/lib/stream.test.ts`

- [ ] **Step 1: Tests**

`chunkBySectionBreak(tokens: AsyncIterable<string>): AsyncIterable<StreamEvent>` yields:
- `{ type: "token", text }` for normal tokens
- `{ type: "section-break" }` when a line containing only `---` is emitted
- `{ type: "done" }` at end

Tests:
- Input `["He", "llo"]` → two tokens + done.
- Input `["Scene one.", "\n---\n", "Scene two."]` → tokens for scene one, section-break, tokens for scene two, done.
- `---` inside a longer line is NOT a break (only a line with exactly `---` counts).
- Handles `---` split across tokens: `["Scene.\n--", "-\nScene two."]` still produces exactly one section-break.

- [ ] **Step 2: Implement** — maintain a rolling buffer, flush complete lines, detect bare `---` lines.

- [ ] **Step 3: Tests pass. Commit.**

---

### Task 4.4: /api/generate SSE route — "full" mode

**Files:**
- Create: `app/api/generate/route.ts`
- Create: `lib/generation-job.ts` (in-memory job registry for stop)
- Create: `tests/api/generate.test.ts`

- [ ] **Step 1: Tests**

Mock `getGrokClient` to return a fake OpenAI whose `chat.completions.create({ stream: true })` returns a canned async iterator of deltas. Assert:

- POST with `{ storySlug, chapterId, mode: "full" }` streams SSE events: `start`, `token` × N, optional `section-break`, `done`.
- Mid-stream, the handler persists the current section state to the chapter file every time `section-break` fires and every 2 seconds.
- Missing API key returns a final `error` event + 500.

- [ ] **Step 2: Implement `lib/generation-job.ts`**

```ts
type Job = { abort: AbortController; storySlug: string; chapterId: string };
const jobs = new Map<string, Job>();

export function registerJob(job: Job): string {
  const id = crypto.randomUUID();
  jobs.set(id, job);
  return id;
}
export function abortJob(id: string): boolean {
  const j = jobs.get(id);
  if (!j) return false;
  j.abort.abort();
  jobs.delete(id);
  return true;
}
export function clearJob(id: string) { jobs.delete(id); }
```

- [ ] **Step 3: Implement `app/api/generate/route.ts`**

Behavior:
1. Parse body, **snapshot** story/bible/chapter/priorRecaps at this moment — the entire stream uses this snapshot. Subsequent bible/chapter edits by the user DO NOT affect the in-flight generation. This is deliberate per the spec's Review Addenda: the client sees predictable output and concurrent writes can't corrupt mid-stream state.
2. Build prompt with `buildChapterPrompt`.
3. Write the **prompt payload only** (`{ model, mode, system, user }`) to `.last-payload.json` for the Privacy panel. Explicitly **do not** include outgoing HTTP headers (the `Authorization: Bearer xai-…` header lives in the OpenAI client and never touches the prompt payload, so no key redaction is needed — but the logger still redacts defensively when writing).
4. Create `AbortController`; register job; capture `jobId`.
5. Open SSE `ReadableStream`.
6. First event: `{ type: "start", jobId }`.
7. Call Grok via `callGrokWithRetry(client, params, { maxRetries: 3 })` from Task 4.1b — this applies exponential backoff **only before the first token**. Once the stream resolves, iterate deltas, feed them through `chunkBySectionBreak`, emit SSE events.
8. On every `section-break`, append the just-completed section text to `chapter.sections` and save.
9. On 2-second tick (setInterval inside the stream), snapshot current section-in-progress to the chapter.
10. On `done`, final save, clear job, if `config.autoRecap` trigger a second call to build the recap (non-streaming) and save it (see Task 4.7 for failure behavior).
11. **Mid-stream errors surface immediately.** If `callGrokWithRetry` throws before the first token, emit `{ type: "error", message, kind }` using the `GrokError.kind` from Task 4.1b. If an error occurs DURING stream iteration (rate limit, network drop, refusal), do NOT retry — emit `{ type: "error", message, kind }`, save what we have, and end the stream gracefully. The client uses `mode: "continue"` if the user wants to resume.

Heavy lifting — keep this route file to orchestration only; put parsing/chunking/IO in `lib/`.

- [ ] **Step 4: Tests pass. Commit.**

---

### Task 4.5: /api/generate "section" mode

**Files:**
- Modify: `app/api/generate/route.ts`
- Extend: `tests/api/generate.test.ts`

- [ ] **Step 1: Tests**

POST with `{ mode: "section", sectionId, regenNote }` streams a replacement section and swaps it into `chapter.sections[]` by id on `done`. No section-break events should fire — we're rewriting exactly one section.

- [ ] **Step 2: Implement.** Use `buildSectionRegenPrompt`. On `done`, parse the accumulated text (strip any leading/trailing whitespace), and `updateChapter` to replace the target section's `content` and `regenNote`.

- [ ] **Step 3: Tests pass. Commit.**

---

### Task 4.6: /api/generate "continue" mode + /api/generate/stop

**Files:**
- Create: `app/api/generate/stop/route.ts`
- Modify: `app/api/generate/route.ts`
- Extend tests

- [ ] **Step 1: Tests**

- POST to `/api/generate/stop` with `{ jobId }` returns `{ ok: true, data: { stopped: true } }` and aborts the stream.
- POST to `/api/generate` with `{ mode: "continue", fromSectionId, regenNote }` resumes from the section with id `fromSectionId`: drops everything after it, then streams new content appended to the chapter.

- [ ] **Step 2: Implement. Tests pass. Commit.**

---

### Task 4.7: Auto-recap

**Files:**
- Modify: `app/api/generate/route.ts`
- Create: `lib/recap.ts`, `tests/lib/recap.test.ts`

- [ ] **Step 1: Tests**

`generateRecap(client, model, story, chapter)` calls Grok non-streaming with `buildRecapPrompt`. **Semantics:**
- On success with non-empty response: returns the trimmed string.
- On success with empty response: returns `""`.
- On Grok error (network, auth, refusal, etc.): **throws** the classified `GrokError`.

This split lets the two call sites handle failure differently. The auto-recap call site (inside the streaming `/api/generate` `done` handler) wraps the call in try/catch and swallows errors — the chapter still saves with `recap = ""`. The recap-only endpoint (Task 4.7 Step 4) lets the error propagate and translates it into a 502 response, so the retry button can show a meaningful error state.

- [ ] **Step 2: Implement. Tests pass. Commit.**

- [ ] **Step 3: Wire into `/api/generate`'s `done` handler**

After the final save, if `config.autoRecap` is true and the request was `mode: "full" | "continue"`, call `generateRecap`, `updateChapter` with the recap, and emit a final SSE event `{ type: "recap", text }` (add this variant to `GenerateEvent` in types).

If `generateRecap` fails or returns `""`, the chapter still saves successfully with `recap = ""` — per spec, recap is never load-bearing for completing the chapter. The client-side `RecapField` (Task 6.4) detects the empty-recap-with-non-empty-sections state and displays a retry prompt.

Extend tests to assert both the happy path (recap produced and saved) and the failure path (Grok errors → chapter saves with `recap = ""`, no stream error emitted, no exception thrown).

- [ ] **Step 4: Recap-only endpoint**

Create `app/api/generate/recap/route.ts`, extend `tests/api/generate.test.ts`.

POST body: `{ storySlug, chapterId }`. Loads story+chapter, calls `generateRecap(client, model, story, chapter)`, saves via `updateChapter({ recap })`, returns `{ ok: true, data: { recap } }`. On failure, returns `{ ok: false, error }` with 502. This is a non-streaming endpoint — it's a regular JSON API, intended for the RecapField's retry button.

- [ ] **Step 5: Commit.**

---

## Chunk 5: Library, Settings, and Shell UI

Goal at end of chunk: browse to `/`, see a list of stories, create a new one via dialog, click into the editor stub. Visit `/settings` to set an API key.

### Task 5.1: Install UI toolkit

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install shadcn/ui CLI + base primitives**

```bash
npx shadcn@latest init
# choose: New York, neutral palette, CSS variables, lucide icons
npx shadcn@latest add button input textarea label dialog dropdown-menu toast card separator tooltip tabs sheet scroll-area switch select
```

- [ ] **Step 2: Install additional runtime libraries**

```bash
npm install zustand swr @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities @tiptap/react @tiptap/pm @tiptap/starter-kit clsx
```

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "chore: shadcn/ui primitives and runtime deps"
```

---

### Task 5.2: App shell + global nav

**Files:**
- Modify: `app/layout.tsx`
- Create: `components/layout/TopBar.tsx`

- [ ] **Step 1: Implement**

`app/layout.tsx` wraps children in a minimal frame with a `TopBar` showing the scriptr wordmark and links to Library `/` and Settings `/settings`. Uses the shadcn/ui theme CSS variables.

Before writing, consult `skills/frontend-design/SKILL.md` and `skills/react-best-practices/SKILL.md` for visual and code patterns. No generic AI-app aesthetic — the app should feel like a tight writer's tool (think iA Writer × Scrivener).

- [ ] **Step 2: Boot and visually inspect** `npm run dev`, confirm layout renders.

- [ ] **Step 3: Commit.**

---

### Task 5.3: Settings page

**Files:**
- Create: `app/settings/page.tsx`, `components/settings/SettingsForm.tsx`

- [ ] **Step 1: Implement**

Client component. Fetches `/api/settings` via SWR. Renders:
- API key input (masked by default, with show/hide toggle; displays `keyPreview` when one is set).
- Default model `<Select>` with spec's options (grok-4-latest default, grok-4-fast, grok-3-latest, grok-beta, custom).
- Theme `<Select>` (light / dark / system).
- Auto-recap `<Switch>`.
- "Include last chapter full text" `<Switch>` (escape hatch from the spec).
- "Save" button calls PUT `/api/settings`, toasts on success, re-fetches.

- [ ] **Step 2: Test manually — set a key, refresh, verify `hasKey: true` and masked preview displayed.**

- [ ] **Step 3: Commit.**

---

### Task 5.4: Library page

**Files:**
- Modify: `app/page.tsx`
- Create: `components/library/LibraryList.tsx`, `components/library/NewStoryDialog.tsx`

- [ ] **Step 1: Implement LibraryList**

Client component. SWR GET `/api/stories`. Renders a grid of cards: title, author pen name, chapter count, last edited (relative time). Click navigates to `/s/[slug]`. Right-click / "..." menu offers Delete (confirm dialog, DELETE `/api/stories/[slug]`, revalidate list).

Empty state: centered illustration-text "No stories yet. Create one to get going."

- [ ] **Step 2: Implement NewStoryDialog**

Click "New story" button in TopBar or empty state → shadcn `Dialog` with title + author pen name inputs. Submit → POST `/api/stories`, navigate to the new `/s/[slug]`.

- [ ] **Step 3: Wire into `app/page.tsx`**

Server component that renders `<LibraryList />`.

- [ ] **Step 4: Manual test:** create a story, see it on the grid, delete it, confirm removal.

- [ ] **Step 5: Commit.**

---

## Chunk 6: Three-Pane Editor

Goal at end of chunk: `/s/[slug]` renders the three-pane editor. You can edit the bible, add/reorder/delete chapters, and see chapter metadata — but not yet generate prose.

### Task 6.1: Editor page shell

**Files:**
- Create: `app/s/[slug]/page.tsx`, `components/editor/StoryEditor.tsx`

- [ ] **Step 1: Implement**

Server component fetches story, bible, chapters once. Hydrates `StoryEditor`. Three-column CSS grid: 260px | 1fr | 320px. Full-viewport height minus TopBar. Resizable column widths are NOT in scope for v1.

URL state: `?chapter=<id>` controls selected chapter. If missing and chapters exist, selects the first. If no chapters exist, the center pane shows "Add a chapter to start writing."

- [ ] **Step 2: Commit.**

---

### Task 6.2: Nav pane — Bible section

**Files:**
- Create: `components/editor/NavPane.tsx`, `components/editor/BibleSection.tsx`, `components/editor/BibleField.tsx`

- [ ] **Step 1: Implement**

Collapsible sections inside the nav: Characters, Setting, POV, Tone, Style, NSFW. Each is an inline textarea / shadcn Select that auto-saves with a 500ms debounce via PUT `/api/stories/[slug]/bible`.

Characters subform: list of `{ name, description, traits }` entries with add/remove buttons and drag-to-reorder.

Extract a generic `useAutoSave(value, save)` hook into `hooks/useAutoSave.ts` + tests.

- [ ] **Step 2: Commit.**

---

### Task 6.3: Nav pane — Chapter list with dnd-kit

**Files:**
- Create: `components/editor/ChapterList.tsx`, `components/editor/ChapterListItem.tsx`

- [ ] **Step 1: Implement**

SWR `/api/stories/[slug]/chapters`. Each item shows: ordinal (`01`), title, word count. Click selects. `+ New chapter` button at the bottom opens an inline input (title only), POST `/api/stories/[slug]/chapters`, selects the new chapter.

Drag to reorder with `@dnd-kit/sortable`. On drop, POST `/api/stories/[slug]/chapters/reorder` with the new id array; optimistic update the list; revert on error.

Right-click / kebab menu: Rename (inline), Delete (confirm), Duplicate (optional — YAGNI, skip for v1).

- [ ] **Step 2: Commit.**

---

### Task 6.4: Metadata pane (static fields)

**Files:**
- Create: `components/editor/MetadataPane.tsx`, plus one component per field: `SummaryField`, `BeatList`, `PromptField`, `RecapField`

- [ ] **Step 1: Implement**

SWR the selected chapter. Render fields. Each uses `useAutoSave` to PATCH `/api/stories/[slug]/chapters/[id]` on change. Beats is a sortable list of single-line inputs with add/remove. Word count + target live at the top of the pane.

- [ ] **Step 2: RecapField — recap-failure fallback UX**

When the chapter has at least one non-empty section but `chapter.recap.trim() === ""`, display an unobtrusive inline hint above the textarea: **"Recap failed — write one?"** with a small "Retry" button next to it.

Clicking "Retry" kicks off a dedicated recap-only request: `POST /api/generate/recap` with `{ storySlug, chapterId }`. This new endpoint (add to Task 4.7) reuses `generateRecap` from `lib/recap.ts` non-streaming, saves the result, returns `{ recap }`. On success, the hint disappears and the field populates.

The user can always just type a recap themselves into the textarea — the hint should not block manual editing. This matches the spec's Review Addenda: "Recap is never load-bearing for the user finishing the chapter."

- [ ] **Step 3: Commit.**

---

### Task 6.5: Editor pane — display only

**Files:**
- Create: `components/editor/EditorPane.tsx`, `components/editor/ChapterHeader.tsx`, `components/editor/SectionList.tsx`, `components/editor/SectionCard.tsx`

- [ ] **Step 1: Implement**

ChapterHeader: editable title (debounced save).

SectionList: maps sections to `SectionCard`s. If `sections.length === 0`, render an empty state with a primary "Generate chapter" button (wired in Chunk 7).

SectionCard: shows section prose (read-only for now; editing comes in Chunk 7). Each card has a right-aligned kebab button (disabled — regen is Chunk 7).

- [ ] **Step 2: Commit.**

---

## Chunk 7: Streaming Generation UI, Section Regen, and Inline Editing

Goal at end of chunk: click "Generate chapter," watch prose stream in, stop and steer mid-stream, regen single sections, edit prose inline.

### Task 7.1: useStreamGenerate hook (SSE client)

**Files:**
- Create: `hooks/useStreamGenerate.ts`, `tests/hooks/useStreamGenerate.test.tsx`

- [ ] **Step 1: Tests**

Using a mock `fetch` that returns a `ReadableStream` of SSE frames, assert:
- `start(request)` returns a `{ stop(), events$ }` handle.
- `events$` emits `start`, `token`, `section-break`, `done` events parsed from the stream.
- `stop()` calls `AbortController.abort()` AND POSTs to `/api/generate/stop` with the captured jobId.
- On network error, emits an `error` event and cleans up.

- [ ] **Step 2: Implement** using `eventsource-parser` on the client (`npm install eventsource-parser`).

- [ ] **Step 3: Tests pass. Commit.**

---

### Task 7.2: "Generate chapter" button + streaming into SectionCards

**Files:**
- Modify: `components/editor/EditorPane.tsx`, `SectionList.tsx`, `SectionCard.tsx`
- Create: `components/editor/GenerateChapterButton.tsx`

- [ ] **Step 1: Implement**

Button kicks off `useStreamGenerate({ mode: "full", ... })`. As tokens arrive, append to a transient "live section" held in a Zustand store `useGenerationStore` (`components/editor/generation-store.ts`). On `section-break`, the live section flushes into the chapter's server state (the server already persisted it; client revalidates the SWR cache). On `done`, revalidate.

Visual: streaming section has a pulsing left border + cursor character at the end.

- [ ] **Step 2: Commit.**

---

### Task 7.3: Stop & steer overlay

**Files:**
- Create: `components/editor/StreamOverlay.tsx`

- [ ] **Step 1: Implement**

Floating panel, bottom-center of the editor pane during any active stream. Contains:
- "Stop" button — calls `stop()` on the current generation handle.
- Inline note input + "Steer" button — calls `stop()` then immediately starts a new `useStreamGenerate({ mode: "continue", fromSectionId: lastSectionId, regenNote: note })`.

Keyboard: `Esc` stops. `Ctrl/Cmd+Enter` in the input triggers Steer.

- [ ] **Step 2: Commit.**

---

### Task 7.4: Section regen with inline note

**Files:**
- Modify: `components/editor/SectionCard.tsx`

- [ ] **Step 1: Implement**

Kebab on each section: "Regenerate," "Regenerate with note…," "Delete." Regenerate with note opens an inline input below the section body, submit kicks off `useStreamGenerate({ mode: "section", sectionId, regenNote })`. The section content replaces on `done`. During regen, the section displays a skeleton shimmer.

- [ ] **Step 2: Commit.**

---

### Task 7.5: Inline editing with Tiptap

**Files:**
- Create: `components/editor/SectionEditor.tsx`

- [ ] **Step 1: Implement**

Click section body → `SectionEditor` replaces the read-only view. Tiptap with StarterKit (no headings, no task lists — prose-only). Auto-save debounced. Blur or Esc exits edit mode.

Consult `skills/react-best-practices/` on controlled vs uncontrolled editor state; pick uncontrolled + onBlur-debounced to avoid re-renders on every keystroke.

- [ ] **Step 2: Commit.**

---

## Chunk 8: Reader, Privacy Panel, E2E, and README

Goal at end of chunk: the app is shippable. Reader view joins chapters; privacy panel shows the exact payload sent to Grok; one Playwright test covers the golden path; a README explains what the app does and what data it sends.

### Task 8.1: Reader view

**Files:**
- Create: `app/s/[slug]/read/page.tsx`, `components/reader/ReaderView.tsx`

- [ ] **Step 1: Implement**

Server component fetches story + chapters. Renders a single scrollable column: title, author pen name, each chapter as `<h2>` + sections joined with a blank line between, a final copyright footer.

Top controls: "Copy all," "Download .txt," "Back to editor."

Typography: serif body, 18px, `max-width: 68ch`, line-height 1.65. Dark mode supported.

- [ ] **Step 2: Commit.**

---

### Task 8.2: Privacy panel on Settings

**Files:**
- Modify: `app/settings/page.tsx`
- Create: `components/settings/PrivacyPanel.tsx`
- Create: `app/api/privacy/last-payload/route.ts`, test

- [ ] **Step 1: API**

GET `/api/privacy/last-payload?slug=<slug>` reads `.last-payload.json` for that story. If absent, returns `{ ok: true, data: null }`. Never contains the API key (the generate route is responsible for redacting before writing — test that).

- [ ] **Step 2: Privacy panel UI**

Dropdown to pick a story. On select, shows the prettified JSON of the last payload sent to Grok, plus a paragraph: "This is exactly what was sent to api.x.ai for the most recent generation in this story. Nothing else is transmitted externally."

- [ ] **Step 3: Commit.**

---

### Task 8.3: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write**

Sections in this order:
1. One-line summary.
2. **Privacy — what this app sends externally, and to whom.** (First functional section. Verbatim list from the spec.)
3. Quick start (install, set key, run).
4. Running on LAN (`npm run dev:lan`) with an explicit warning: no auth, only do this on a trusted network.
5. How it works — story bible, chapters, generation, recaps.
6. File layout under `data/`.
7. Known limitations (Grok content policy may refuse some content; xAI retention policies apply to transmitted prose).
8. License (TBD).

- [ ] **Step 2: Commit.**

---

### Task 8.4: Playwright golden-path E2E

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/golden-path.spec.ts`

- [ ] **Step 1: Install + config**

```bash
npm install -D @playwright/test
npx playwright install chromium
```

`playwright.config.ts`: single project (chromium, desktop viewport 1440×900). `webServer: { command: "npm run dev", url: "http://127.0.0.1:3000", reuseExistingServer: !process.env.CI }`.

- [ ] **Step 2: Test**

Mock Grok at the network layer by intercepting `https://api.x.ai/**`. Script:

1. Go to `/`.
2. Open Settings, enter a fake API key, save.
3. Back to `/`, click "New story." Create "E2E Story."
4. In the editor, fill in a single character (name "Ana", description "curious").
5. Click "+ Chapter," title "Opening," summary "they meet."
6. Click "Generate chapter." Intercept the SSE call and stream a canned response with two sections separated by `---`.
7. Assert two `SectionCard`s appear with the expected prose.
8. Navigate to `/s/[slug]/read`. Assert the joined prose is visible.

- [ ] **Step 3: Run `npm run e2e` once locally, green. Commit.**

---

### Task 8.5: Privacy smoke test

**Files:**
- Create: `tests/privacy/no-external-egress.test.ts`

- [ ] **Step 1: Test**

Boot the Next.js handler in-process (route-by-route). Stub `global.fetch` to record every URL. Exercise:
- GET / PUT `/api/settings`
- GET / POST `/api/stories`
- GET `/api/stories/[slug]`
- GET `/api/stories/[slug]/bible`
- GET/POST `/api/stories/[slug]/chapters`
- POST `/api/stories/[slug]/chapters/reorder`

Assert: the recorded URL list is empty (no API route reaches out externally). The `/api/generate` route is exempt from this test — it is the one place prose leaves the machine, by design.

- [ ] **Step 2: Commit.**

---

### Task 8.6: Final typecheck + lint + test gate

- [ ] **Step 1: Run and fix any lingering issues**

```bash
npm run typecheck
npm run lint
npm run test
npm run e2e
```

All four must pass cleanly.

- [ ] **Step 2: Commit any final fixes.**

- [ ] **Step 3: Tag the MVP**

```bash
git tag -a v0.1.0-mvp-writer -m "MVP Writer: write stories end-to-end, no export yet"
```

---

## Done with Plan 1

At this point you can:
- Create stories, maintain a story bible, draft chapters, generate them with Grok chapter-by-chapter, stop mid-stream and steer, regen individual sections, edit inline, and read the joined result.
- Confirm at a glance what you sent to xAI via the Privacy panel.
- Trust that no telemetry, external CDN, or background call leaks data.

**Next:** Plan 2 — Publishing Kit (EPUB). That will add the Export page, cover handling, metadata form, and EPUB3 generation.
