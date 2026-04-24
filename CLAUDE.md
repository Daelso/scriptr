# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

Development
- `npm run dev` — Next.js dev server on `127.0.0.1:3000` (localhost-only by default).
- `npm run dev:lan` — binds `0.0.0.0:3000`. There is **no auth** — use only on trusted networks.
- `npm run build` / `npm run start` — production build and server.

Quality
- `npm run lint` — ESLint. Includes the custom `scriptr/no-telemetry` rule (see Privacy below).
- `npm run typecheck` — `tsc --noEmit`.
- `npm test` — Vitest (`tests/**/*.test.ts[x]`). Default env is `node`; component/hook tests opt into jsdom per-file with `// @vitest-environment jsdom` at the top.
- `npm run test:watch` — Vitest watch mode.
- Run a single test file: `npx vitest run tests/lib/slug.test.ts`. Filter by name: `npx vitest run -t "creates story"`.
- `npm run e2e` — Playwright. Spins up its own dev server on **port 3001** with `SCRIPTR_DATA_DIR=/tmp/scriptr-e2e`, so e2e **never** touches the real `data/`. Config is in [playwright.config.ts](playwright.config.ts).

## Architecture

Scriptr is a **single-user, local-first Next.js 16 app** (App Router, React 19, Tailwind 4, shadcn/ui, Zustand, SWR). The object model lives entirely on disk; the app is effectively a thin UI over a filesystem.

### Data directory (the source of truth)
- Location: `process.env.SCRIPTR_DATA_DIR` if set, otherwise `./data/` (gitignored). Resolved by `effectiveDataDir()` in [lib/config.ts](lib/config.ts).
- Layout: `data/config.json` + `data/stories/<slug>/{story.json, bible.json, chapters/NNN-<slug>.json, .last-payload.json, cover.jpg, exports/}`.
- All paths are centralized in [lib/storage/paths.ts](lib/storage/paths.ts). New storage code must go through these helpers — never hand-concatenate paths in routes.
- Storage helpers ([lib/storage/stories.ts](lib/storage/stories.ts), [lib/storage/bible.ts](lib/storage/bible.ts), [lib/storage/chapters.ts](lib/storage/chapters.ts)) are pure disk I/O. They never touch the network. Route handlers call them; they do not re-implement JSON read/write.

### Generation flow (the only path that leaves the machine)
Client hook [hooks/useStreamGenerate.ts](hooks/useStreamGenerate.ts) → `POST /api/generate` (SSE) in [app/api/generate/route.ts](app/api/generate/route.ts) → [lib/grok.ts](lib/grok.ts) (OpenAI SDK pointed at `https://api.x.ai/v1`) → `callGrokWithRetry` in [lib/grok-retry.ts](lib/grok-retry.ts) → events parsed against `GenerateEvent` in [lib/types.ts](lib/types.ts) → prose persisted via the chapters storage helper; payload mirrored to `.last-payload.json` for the Privacy panel.
- Three modes share the route: `full`, `section` (regenerate one section), `continue` (resume after stop). See `handleFull` / `handleSection` / `handleContinue` in the route handler.
- Stop/steer: in-flight jobs are tracked by UUID in [lib/generation-job.ts](lib/generation-job.ts); `POST /api/generate/stop` aborts the controller.
- Prompts are composed in [lib/prompts.ts](lib/prompts.ts) from Story + Bible + Chapter + prior-chapter recap. Style rules merge bible overrides with `config.styleDefaults` via [lib/style.ts](lib/style.ts).
- Recap: after a `done` event, a separate non-streaming request ([lib/recap.ts](lib/recap.ts)) writes a one-paragraph summary back to the chapter so the next chapter has context.

### Client state
- Zustand store [components/editor/generation-store.ts](components/editor/generation-store.ts) bridges the SSE hook to UI. **Invariant**: only one generation runs at a time; chapter-mode (`liveText`) and section-mode (`regeneratingSectionId`) state are exclusive.
- SWR for story/chapter/bible reads. Auto-save via [hooks/useAutoSave.ts](hooks/useAutoSave.ts).
- Pages: editor at [app/s/[slug]/page.tsx](app/s/[slug]/page.tsx), reader at [app/s/[slug]/read/](app/s/[slug]/read/), settings at [app/settings/](app/settings/).

### Privacy enforcement (non-negotiable)
Privacy is a product pillar (see the top of [README.md](README.md)). Several mechanisms enforce it — do not bypass or loosen them without explicit user direction:
1. **Custom ESLint rule** [eslint-rules/no-telemetry.js](eslint-rules/no-telemetry.js), wired as `scriptr/no-telemetry: error` in [eslint.config.mjs](eslint.config.mjs), blocks imports of Sentry, PostHog, Vercel Analytics, Datadog, Amplitude, LogRocket, Plausible trackers, etc. Adding a telemetry package fails lint.
2. **Load-bearing egress test** [tests/privacy/no-external-egress.test.ts](tests/privacy/no-external-egress.test.ts) stubs `global.fetch` and exercises every non-generate route, asserting `recorded === []`. Only `/api/generate`, `/api/generate/recap`, `/api/generate/stop`, and `/api/privacy/last-payload` are exempt. **When adding a new API route, extend this test.**
3. **CSP headers** in [next.config.ts](next.config.ts) restrict `connect-src` to `'self' https://api.x.ai`. Don't add origins without a user-facing justification.
4. **Logger redaction** [lib/logger.ts](lib/logger.ts) strips `xai-*` keys and sensitive headers. Use `logger` from that module, not `console.*`, for anything that might touch request/response data.
5. **`.last-payload.json`** stores only `{ model, mode, system, user }` — never headers or keys. Write it via `lastPayloadFile()` from `lib/storage/paths.ts`.

### API routes
All under [app/api/](app/api/). Each route is a small adapter: parse with `readJson` from [lib/api.ts](lib/api.ts), call storage or grok, return an `ApiResult<T>` envelope. Handlers are directly callable in tests — the API and egress tests invoke them without starting a server (see the pattern in [tests/privacy/no-external-egress.test.ts](tests/privacy/no-external-egress.test.ts)).

### Import (NovelAI exports)
`.story` and `.txt` exports are parsed in [lib/novelai/](lib/novelai/) (decode → clean → split → map) and committed via `/api/import/novelai/parse` and `/api/import/novelai/commit`. `////` is the story-split delimiter (multi-story exports land as separate stories); rule/heading splits require 1+ occurrence. See [lib/novelai/split.ts](lib/novelai/split.ts).

### Publish (EPUB export)
EPUB generation lives in [lib/publish/](lib/publish/) and is exposed via `/api/stories/[slug]/export/epub`. We ship both EPUB3 (KDP/modern readers) and EPUB2 (Smashwords-only). Gotchas: `epub-gen-memory` takes cover options as a **positional vararg**, and disk paths for `cover` MUST be `file://` URLs (use `pathToFileURL`) — bare absolute paths silently produce 0-byte covers. `@likecoin/epubcheck-ts` validation is wired up but currently crashes under Next.js 16, so validation is silently non-functional.

### Planning docs
Feature work is designed in [docs/superpowers/specs/](docs/superpowers/specs/) and executed from [docs/superpowers/plans/](docs/superpowers/plans/). Shipped milestones: `v0.1.0-mvp-writer`, `v0.2.0-publishing-kit` (EPUB2/EPUB3 via [lib/publish/epub.ts](lib/publish/epub.ts)). Since then: style rules, section-editor sticky focus, copy-prompt-for-webui, NovelAI story import. Check `git tag -l` and the newest file in specs/ before assuming what's "active."
