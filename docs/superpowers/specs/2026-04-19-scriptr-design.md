# scriptr — Design Spec

**Date:** 2026-04-19
**Author:** Chase (with Claude)
**Status:** Draft

## Summary

`scriptr` is a local-first Next.js web app for writing AI-assisted erotica short stories chapter-by-chapter using the xAI Grok API. It turns a structured story bible + editable chapter outline into streaming Grok-generated prose, supports section-level regeneration and inline editing, and exports publishing-ready EPUB, DOCX (Smashwords-compatible), and PDF files with full metadata and cover art.

Privacy is a core design pillar: the app runs on localhost, stores all data as plain files on disk, uses no telemetry or external CDNs, and sends content only to Grok (the one unavoidable external call).

## Goals

1. Enable quick drafting of 3000–10000 word erotica short stories (typically 3–10 chapters).
2. Work around Grok's tendency to struggle with long-form output by generating one chapter at a time with editable context.
3. Give the user fine-grained control over continuity (editable per-chapter recap, persistent story bible) without burying them in knobs.
4. Produce output ready for direct upload to Amazon KDP and Smashwords.
5. Keep all sensitive content on the user's machine by default; make data egress transparent and intentional.

## Non-goals (out of scope for v1)

- Multi-user or auth (localhost, one user).
- Cloud sync, backup, or collaborative editing.
- Non-Grok model providers (OpenAI, Anthropic). The internal shape should be adapter-friendly, but only Grok is implemented.
- AI cover-image generation.
- TTS / audio readback.
- Version history or diffing across regenerations (only the latest content is kept).
- Analytics, telemetry, or reading metrics.
- Internationalization (English only).
- Mobile viewport support.

## User Workflow

1. From the **Library** home screen, user clicks "New story," picks a title.
2. Lands in the **Editor** (three-pane). Fills in the **Story Bible** in the left pane (characters, setting, POV, tone, style, NSFW preferences).
3. Adds chapters to the list — each gets a title and a short summary.
4. Opens a chapter. Optionally expands the right pane to add beats and a detailed prompt.
5. Clicks **Generate chapter.** Grok streams prose into the editor section-by-section. User can hit **Stop & steer** mid-stream to redirect.
6. After generation, the recap is auto-drafted in the right pane; user edits if needed. Carries forward as context for the next chapter.
7. Section falls flat? User clicks the per-section **regenerate** button, optionally with a note ("make this hotter," "less dialogue"). Only that section is rewritten.
8. User can also inline-edit any section directly.
9. Repeats for each chapter.
10. Goes to **Export.** Fills in publishing metadata (pen name, blurb, copyright, BISAC, keywords, ISBN), uploads cover. Builds EPUB, DOCX, and/or PDF. Files appear in `data/stories/<slug>/exports/`.

## Architecture

```
┌─── Browser (Next.js client) ──────────────────────┐
│  • Library view  • Editor (3-pane)  • Export view │
└───────────────┬───────────────────────────────────┘
                │ fetch / SSE
┌───────────────▼───────────────────────────────────┐
│  Next.js App Router — API routes (server-side)    │
│  • /api/stories  (CRUD)                           │
│  • /api/generate (streams from Grok, SSE)         │
│  • /api/export   (builds EPUB/DOCX/PDF)           │
│  • /api/settings (API key, model)                 │
└───────────────┬───────────────────────────────────┘
                │ fs + Grok API
┌───────────────▼───────────────┐  ┌───────────────┐
│  Local filesystem             │  │  xAI Grok API │
│  data/stories/<slug>/...      │  │ (OpenAI-compat)│
└───────────────────────────────┘  └───────────────┘
```

**Client never talks to Grok directly.** All API key usage happens in Next.js API routes (server-side). The client sends chapter prompts; the server adds the key and streams back tokens via SSE.

## Data Model & Storage

All runtime data lives under `data/` in the project root. `data/` is gitignored.

```
data/
├── config.json                        # { apiKey?, defaultModel, bindHost, ... }
└── stories/
    └── <slug>/                        # one folder per story
        ├── story.json                 # metadata: title, author, status, timestamps
        ├── bible.json                 # characters, setting, style, tone, POV, NSFW prefs
        ├── chapters/
        │   ├── 001-the-meeting.json
        │   └── 002-first-night.json
        ├── cover.jpg                  # optional cover art
        └── exports/                   # generated output (also gitignored)
            ├── the-meeting.epub
            ├── the-meeting.docx
            └── the-meeting.pdf
```

### Core TypeScript types

```ts
type Story = {
  slug: string;                  // URL-safe id
  title: string;
  authorPenName: string;
  subtitle?: string;
  description: string;           // back-cover blurb
  copyrightYear: number;
  language: string;              // "en"
  bisacCategory: string;
  keywords: string[];
  isbn?: string;
  createdAt: string;
  updatedAt: string;
  chapterOrder: string[];        // chapter ids in order
  modelOverride?: string;        // per-story Grok model, falls back to config
};

type Bible = {
  characters: Array<{
    name: string;
    description: string;
    traits?: string;
  }>;
  setting: string;
  pov: "first" | "second" | "third-limited" | "third-omniscient";
  tone: string;                  // e.g. "slow-burn romantic"
  styleNotes: string;            // freeform prose direction
  nsfwPreferences: string;       // specific kinks, must-haves, hard limits
};

type Chapter = {
  id: string;
  title: string;
  summary: string;               // always-visible one-sentence
  beats: string[];               // optional ordered beats
  prompt: string;                // optional freeform detailed prompt
  recap: string;                 // editable summary fed forward to next chapter
  sections: Section[];
  wordCount: number;
  targetWords?: number;          // optional, per-chapter target
};

type Section = {
  id: string;
  content: string;               // markdown
  regenNote?: string;            // last "make this X" instruction, remembered
};
```

### Context sent to Grok for chapter N

- Full `bible`
- `chapters[0..N-1].recap` (concatenated, short)
- `chapters[N]` summary, beats (if any), prompt (if any)
- Optional escape hatch: "include last chapter full text" toggle for continuity crises

This keeps context windows bounded even for longer stories.

## UI Components & Routes

### Routes (Next.js App Router)

| Path | View |
|------|------|
| `/` | Library — all stories, "New story" button |
| `/s/[slug]` | Editor — three-pane (default view) |
| `/s/[slug]/read` | Reader — clean joined view, copy button |
| `/s/[slug]/export` | Export — metadata form, cover upload, format buttons |
| `/settings` | API key, default model, preferences, privacy panel |

### Three-pane editor

| Pane | Contents | Width |
|------|----------|-------|
| Left (nav) | Story title header · Bible section (expandable: Characters, Setting, POV, Tone, Style, NSFW) · Chapters list (drag to reorder, click to open, "+ Chapter") · Export button pinned bottom | 260px |
| Center (editor) | Chapter title (editable) · Section list — each section is a card with prose, a regen button, inline "make it X" input, edit button · "+ Section" button · Big "Generate chapter" button if empty | flex |
| Right (metadata) | Summary (always-visible textarea) · Beats (add/remove/reorder list) · Detailed prompt (expandable textarea) · Recap (auto-drafted, editable) · Word count + target | 320px |

### Key interactive behaviors

- **Streaming generation:** SSE from `/api/generate`. Sections appear as Grok emits `---` delimiters. Floating **Stop & steer** button always visible during stream with an input field.
- **Section regen:** Per-section ⟳ button. Optional note. Only that section is re-requested from Grok.
- **Inline edit:** Click section body to edit directly (Tiptap editor). Ctrl+S or blur commits.
- **Auto-save:** Debounced 500ms writes to `chapters/<id>.json`.
- **Bible edits:** Edit in place in the left pane, auto-save. Any bible change is picked up at the next generation request.

### Component inventory

```
<LibraryPage />
<StoryEditor>
  <NavPane>
    <BibleSection />
    <ChapterList />              (dnd-kit for drag-reorder)
  </NavPane>
  <EditorPane>
    <ChapterHeader />
    <SectionList>
      <SectionCard />
    </SectionList>
    <GenerateChapterButton />
    <StreamOverlay />            (stop & steer while streaming)
  </EditorPane>
  <MetadataPane>
    <SummaryField />
    <BeatList />
    <PromptField />
    <RecapField />
  </MetadataPane>
</StoryEditor>
<ReaderPage />
<ExportPage>
  <MetadataForm />
  <CoverUploader />
  <FormatButtons />
</ExportPage>
<SettingsPage />
```

## Grok Integration & Streaming

### SDK

xAI is OpenAI-compatible. Use the official `openai` npm package pointed at `https://api.x.ai/v1`.

```ts
import OpenAI from "openai";
const grok = new OpenAI({
  apiKey: effectiveApiKey(),              // env > config.json
  baseURL: "https://api.x.ai/v1",
});
```

### Default model

`grok-4-latest`. Settings page dropdown lets user pick `grok-4-latest`, `grok-4-fast`, `grok-3-latest`, `grok-beta`, or type a custom model id. Per-story override stored in `story.json.modelOverride`.

### Prompt structure

```
SYSTEM:
You are a skilled erotica author writing chapter-by-chapter. Write in
<POV> POV, matching the tone: <tone>. Honor the style notes and NSFW
preferences below. Output prose only — no headings, no chapter labels,
no commentary. Separate scenes with a line containing exactly "---".
Aim for ~<targetWords> words.

<BIBLE>
Characters: ...
Setting: ...
Style notes: ...
NSFW preferences: ...

<PRIOR_RECAPS>
Ch.1 — <recap>
Ch.2 — <recap>
...

USER:
Write Chapter <N>: <title>

Summary: <summary>
Beats (hit these in order):
- <beat 1>
- <beat 2>
...
Additional direction: <prompt>
```

### Streaming flow

1. Client `POST /api/generate` with `{ storySlug, chapterId, mode: "full" | "section" | "continue", sectionId?, regenNote? }`.
2. Server loads story + bible + chapter + prior recaps, builds the prompt, calls `grok.chat.completions.create({ stream: true, ... })`.
3. Server forwards tokens to client as **SSE** (`text/event-stream`). Event types:
   - `{ type: "token", text }`
   - `{ type: "section-break" }` when `---` seen on its own line
   - `{ type: "done", finishReason }`
4. Client accumulates tokens into the current section. On `section-break`, caps this section and starts a new one. On `done`, persists sections to `chapters/<id>.json`.
5. **Stop & steer:** Client can `AbortController.abort()` or hit `POST /api/generate/stop?jobId=…`. Server cancels upstream, preserves partial content, returns `{ stopped: true }`. User types a note, client sends a new `/api/generate` request with `mode: "continue"`.
6. **Auto-recap:** After `done`, server fires a second non-streaming Grok call: "Summarize what happened in this chapter in 2-3 sentences for continuity tracking." Result stored in `chapter.recap`. User can edit.

### Section regen

Same flow but `mode: "section"`. System prompt becomes: "You are rewriting one section of an existing chapter. Here's the surrounding context. Rewrite only the section marked ⟪REWRITE⟫ according to this note: ⟪note⟫."

Only that section is replaced in the chapter file.

### Error handling

| Failure | Behavior |
|---------|----------|
| Invalid API key | Surface clearly in UI with link to Settings. No silent retry. |
| 429 rate limit | Exponential backoff up to 3 tries, then surface. |
| Network drop mid-stream | Keep partial content. Offer "Resume" button → sends `mode: "continue"`. |
| No bible or summary | Allow generation but show a non-blocking warning: "Grok has almost no context, output quality will suffer." |
| Grok refuses content | Content policy violation surfaced verbatim; suggest softening NSFW preferences or tone. |

## Publishing Kit

The Export page (`/s/[slug]/export`) collects metadata, uploads cover, and produces three formats.

### Metadata form

- Title (defaults from story)
- Author pen name
- Subtitle (optional)
- Description / blurb (back-cover, ~150–300 words)
- Copyright year
- Language (default `en`)
- BISAC category (dropdown, default `FIC027000 Fiction/Romance/Erotica`)
- Keywords (chip input, up to 7 for KDP)
- ISBN (optional)
- Cover image (drag-drop, min 1600×2560 recommended for KDP)

All saved to `story.json` on change. Re-export anytime without re-entering.

### EPUB3 (primary)

Library: **`epub-gen-memory`** (pure JS, no native deps).

Structure:
- `mimetype`, `META-INF/container.xml`, `OEBPS/content.opf`
- Cover page (`cover.xhtml` + `cover.jpg`)
- Title page (title, author, copyright, ISBN)
- Auto-generated NCX + nav TOC
- One XHTML per chapter, proper `<h1>` headings
- CSS stylesheet: serif body, generous line height, readable on e-ink and phone

Validated with `epubcheck-wasm` after build; warnings surfaced in UI.

### DOCX (Smashwords-compatible)

Library: **`docx`** npm package.

Smashwords Style Guide compliance:
- `Normal` style for body (no stray heading weights)
- First-line indent `0.3"` via paragraph style (not tabs/spaces)
- Single-spaced, 11pt Times New Roman
- Chapter breaks: manual page break + centered 14pt bold chapter title
- No fancy fonts, text boxes, or tables
- Title page + copyright page + TOC auto-built
- Proper `<w:br w:type="page"/>` between chapters

### PDF (preview/personal)

Library: **`@react-pdf/renderer`**.

6"×9" paperback trim size. Same title/copyright/TOC structure.

### Output paths

```
data/stories/<slug>/exports/<slug>.epub
data/stories/<slug>/exports/<slug>.docx
data/stories/<slug>/exports/<slug>.pdf
```

Export page buttons: Build EPUB, Build DOCX, Build PDF, Build all. Each shows progress, then Download / Copy-path / Reveal-in-folder affordances.

### Implementation sequencing

EPUB ships in MVP. DOCX and PDF land in a follow-up milestone. The metadata form ships in MVP so data is captured from day one.

## Privacy & Data Handling

**Principle:** Only prose ever leaves the machine, and only to Grok. Everything else stays local.

### What goes where

| Data | Destination | Why |
|------|-------------|-----|
| Story prose, bible, prompts | Local filesystem `data/` | Never uploaded except during generation |
| Generation requests | xAI Grok API | Required — the product's purpose |
| Chapter recaps | Local only | Generated by Grok but stored locally |
| Cover images, exports | Local only | Built on-device |
| API key | Local `.env.local` or `data/config.json` | Server-side only, never in client bundle |
| Analytics / telemetry | **None** | Explicitly not collected |

### Concrete enforcement

1. **No telemetry libraries.** Zero Sentry, PostHog, Vercel Analytics, Google Analytics, etc. Custom ESLint rule blocks these imports; build fails if one sneaks in.
2. **No external runtime CDNs.** Fonts, CSS, JS all bundled locally. `next.config.js` sets a Content-Security-Policy that restricts `script-src`, `font-src`, `connect-src` to `self` plus `https://api.x.ai`.
3. **No background network calls.** No update checks, version pings, status pollers. Network only on explicit user action.
4. **Default bind localhost.** `npm run dev` binds `127.0.0.1:3000`. Separate `npm run dev:lan` opts into `0.0.0.0` for conscious sharing.
5. **`data/` gitignored.** Also `.env.local`, `cover*.jpg`, `exports/`. A `.gitignore` template ships with the repo.
6. **API key never logged.** Custom logger redacts anything matching `xai-*` or a configured pattern list. Covered by test.
7. **Transparent "what gets sent" panel.** Settings → Privacy shows the exact payload sent to Grok for the most recent generation.
8. **Local crash logs only.** On server error, write to `data/logs/` (gitignored). Never phone home.
9. **Permanent deletes.** Delete-story removes the whole story folder including exports. No trash, no soft-delete.
10. **README privacy section.** First section: "What this app sends externally, and to whom."

### Trade-offs acknowledged

- No telemetry means no automatic bug reports; user reports issues manually.
- No external CDN means slightly bigger local bundle (acceptable for single-user local app).
- Content sent to Grok is subject to xAI's retention and training policies; the app's Privacy page documents this clearly with a link to xAI's terms.

## Tech Stack & Dependencies

### Core

- **Next.js 15** (App Router, React Server Components where helpful)
- **React 19**
- **TypeScript** strict mode
- **Tailwind CSS v4** + **shadcn/ui** for base components

### Editor & interactions

- **Tiptap** — chapter prose editing (markdown-ish, section-aware)
- **@dnd-kit/core** — drag-to-reorder chapters and beats
- **Zustand** — UI state (current chapter, stream status). Server state lives in files + SWR or React Query

### AI & generation

- **openai** npm package, base URL `https://api.x.ai/v1`
- **eventsource-parser** (server side) for parsing upstream SSE; native `ReadableStream` on client

### Export pipeline

- **epub-gen-memory** — EPUB3
- **docx** — Word documents
- **@react-pdf/renderer** — PDF
- **sharp** — cover image resize/format for KDP compliance
- **epubcheck-wasm** — local EPUB validation

### Dev / quality

- **Vitest** — unit tests
- **Playwright** — a few golden-path E2E tests
- **ESLint** + custom rule blocking telemetry imports
- **Prettier**

### Reference skills bundled in repo

- `skills/frontend-design/` (Anthropic's, already available here)
- `skills/react-best-practices/` (Vercel's, from github.com/vercel-labs/agent-skills)

Both are consulted during implementation (via writing-plans and subagent-driven-development).

## Project Structure

```
scriptr/
├── app/                              # Next.js App Router
│   ├── page.tsx                      # Library
│   ├── s/[slug]/
│   │   ├── page.tsx                  # Editor (3-pane)
│   │   ├── read/page.tsx             # Reader
│   │   └── export/page.tsx           # Export
│   ├── settings/page.tsx
│   └── api/
│       ├── stories/
│       ├── generate/
│       ├── export/
│       └── settings/
├── components/
│   ├── editor/
│   ├── library/
│   ├── export/
│   └── ui/                           # shadcn primitives
├── lib/
│   ├── grok.ts                       # Grok client + prompt builders
│   ├── storage.ts                    # fs read/write stories
│   ├── slug.ts
│   ├── stream.ts                     # SSE helpers
│   └── exports/
│       ├── epub.ts
│       ├── docx.ts
│       └── pdf.ts
├── data/                             # gitignored — runtime data
├── skills/                           # bundled agent skills
│   ├── frontend-design/
│   └── react-best-practices/
├── docs/superpowers/specs/
├── tests/                            # vitest + playwright
├── .env.local.example
├── .gitignore
├── next.config.js                    # CSP config
└── package.json
```

## Testing

- **Unit tests** (Vitest): prompt builders, recap merging, chapter ordering, slug generation, section chunking from a `---`-delimited token stream, telemetry-guard lint rule, API-key redaction.
- **API-route tests** (Vitest + fetch): `/api/stories` CRUD, `/api/generate` with a mocked upstream (no real Grok calls in CI), `/api/export` produces valid files.
- **Export validation:** EPUB output fed through `epubcheck-wasm`; DOCX round-tripped through `docx` reader to assert structure; PDF checked for page count and embedded title metadata.
- **Golden-path E2E** (Playwright, 2–3 tests): create story → add bible → generate chapter (mocked Grok) → export EPUB. Kept small to stay fast; real Grok stays out of CI.
- **Privacy smoke test:** hit all API routes in a harness; assert no outbound network calls besides `api.x.ai`. Fails if anything else appears.

## Open Questions

None blocking. Items to revisit during planning:
- Exact Tiptap extension set (headings off, strict prose mode).
- Cover image resize parameters (KDP mandates minimums; Smashwords recommends different ones).
- Whether to expose a "context preview" button next to Generate that shows the exact prompt before send (probably yes — fits the privacy-transparency theme).

## Review Addenda

Clarifications captured from the spec review pass; planning should treat these as authoritative refinements to the sections above.

- **`jobId` lifecycle.** `POST /api/generate` opens the SSE stream. The first event is `{ type: "start", jobId }` (uuid). The client uses `AbortController.abort()` as the primary cancel path; `POST /api/generate/stop` with `{ jobId }` exists only as a secondary cancel for environments where the fetch stream can't be cleanly aborted.
- **Persistence model.** Chapters persist **server-side** as the stream progresses: every `section-break` and every 2 seconds of token flow, the server writes the current section state to `chapters/<id>.json`. No client-driven save endpoint. The client only renders tokens.
- **Auto-recap failure.** If the recap call fails or returns empty, the chapter still saves with `recap = ""`. The UI shows a small "Recap failed — write one?" hint and a retry button. Recap is never load-bearing for the user finishing the chapter.
- **Section regen prompt contract.** The section regen prompt joins the chapter's sections with `---` delimiters, wraps the target section in `⟪REWRITE:<note>⟫ … ⟪/REWRITE⟫` markers, and instructs Grok to output only the replacement section's prose. The server parses the single section back and swaps it into `sections[]` by id.
- **Rate-limit handling.** Exponential backoff (up to 3 tries) applies **only before the first token** is streamed. A mid-stream 429 surfaces immediately; the user can resume via `mode: "continue"`.
- **Bible snapshotting.** The bible is snapshotted at request time. In-flight generations see the bible as it was when `/api/generate` was called; subsequent edits only affect future requests.
- **Privacy payload capture.** The most-recent-payload for the Privacy panel is written to `data/stories/<slug>/.last-payload.json` (gitignored) after each successful request. Never includes the API key.
- **Chapter file naming.** Numeric prefix (`001-the-meeting.json`) is **cosmetic only**, derived from `story.chapterOrder.indexOf(chapter.id)` at write time and regenerated on reorder. `story.chapterOrder: string[]` is the only source of truth for order. Files can be renamed safely — loader matches by `Chapter.id` inside the JSON, not filename.
- **Full `config.json` shape.**
  ```ts
  type Config = {
    apiKey?: string;              // overrides XAI_API_KEY if set
    defaultModel: string;         // e.g. "grok-4-latest"
    bindHost: "127.0.0.1" | "0.0.0.0";
    bindPort: number;
    theme: "light" | "dark" | "system";
    autoRecap: boolean;           // default true
    includeLastChapterFullText: boolean; // escape-hatch default off
  };
  ```

## Next Step

Invoke the `writing-plans` skill to convert this spec into a step-by-step implementation plan.
