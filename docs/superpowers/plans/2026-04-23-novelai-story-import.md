# NovelAI `.story` Import Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add wholesale import of NovelAI `.story` files into Scriptr — either creating a new story (title + description + tags + Bible + chapters) or appending chapters to an existing story. Also recognize a user-authored `////` split marker in both the new importer and the existing paste importer.

**Architecture:** Three clean layers: (1) a framework-free `lib/novelai/` module with `decode`, `split`, `map` — each a pure function with string/object I/O, independently testable; (2) two thin Next.js API routes (`parse`, `commit`) that glue the lib to disk; (3) two dialogs (`NewStoryFromNovelAIDialog`, `AddChaptersFromNovelAIDialog`) that share a preview/edit UX pattern but have different entry points and commit payloads.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, `@msgpack/msgpack` (new dep), Vitest (unit + api + jsdom component), Playwright (e2e).

**Spec:** [docs/superpowers/specs/2026-04-23-novelai-story-import-design.md](../specs/2026-04-23-novelai-story-import-design.md)

**Operating conventions (from AGENTS.md):**
- This is Next.js 16. Route handlers use `ctx: { params: Promise<{...}> }` — always `await ctx.params`.
- Storage writes go through helpers in [lib/storage/](../../../lib/storage/) — never hand-roll paths or JSON.
- Logger ([lib/logger.ts](../../../lib/logger.ts)) preferred over `console.*` for anything touching request/response data.
- Privacy is non-negotiable: any new API route must be exercised in [tests/privacy/no-external-egress.test.ts](../../../tests/privacy/no-external-egress.test.ts).
- TDD discipline: write the failing test first, verify it fails for the intended reason, then implement.

---

## Chunk 1: Core library (`lib/novelai/`)

This chunk produces the three pure-function modules that do the actual work. No Next.js, no UI — just data in, data out. If `decode` is wrong, we find out here; if `split` / `map` are wrong, we find out here. Chunks 2 and 3 compose these.

### Task 1.1: Add the `@msgpack/msgpack` dependency

**Files:**
- Modify: `/home/chase/projects/scriptr/package.json`

- [ ] **Step 1: Install the dependency**

Run:
```bash
cd /home/chase/projects/scriptr && npm install --save @msgpack/msgpack@^3.0.0
```

Expected: `package.json` and `package-lock.json` update. No error. The package is pure JS with no native deps.

- [ ] **Step 2: Verify the install**

Run:
```bash
cd /home/chase/projects/scriptr && node -e "const { decodeMulti } = require('@msgpack/msgpack'); console.log(typeof decodeMulti);"
```

Expected: prints `function`.

- [ ] **Step 3: Commit**

```bash
cd /home/chase/projects/scriptr && git add package.json package-lock.json && git commit -m "chore: add @msgpack/msgpack for NovelAI .story parsing"
```

---

### Task 1.2: Create the types module

This file holds the shared types used across the other `lib/novelai/` modules and by the API routes. Writing it first means every later task has a stable interface to reference.

**Files:**
- Create: `/home/chase/projects/scriptr/lib/novelai/types.ts`

- [ ] **Step 1: Write the types file**

Write this content to `/home/chase/projects/scriptr/lib/novelai/types.ts`:

```ts
import type { Bible } from "@/lib/types";

/**
 * Output of decode(): everything we extracted from a .story file before any
 * transformation into Scriptr shapes.
 */
export type ParsedStory = {
  title: string;
  description: string;
  tags: string[];
  textPreview: string;
  contextBlocks: string[];
  lorebookEntries: LorebookEntry[];
  prose: string; // long-string prose joined in first-encounter order, separated by "\n\n"
};

export type LorebookEntry = {
  displayName: string;
  text: string;
  keys: string[];
  category?: string;
};

/**
 * Output of split(): prose cut into per-chapter chunks.
 */
export type ProposedChapter = {
  title: string; // may be empty if split source had no title hint
  body: string;
};

export type SplitSource =
  | "marker" // //// markers (highest confidence)
  | "heading" // Chapter N / Chapter N: Title
  | "scenebreak-fallback" // horizontal rules used as chapter breaks
  | "none"; // single chapter, no split

export type SplitResult = {
  chapters: ProposedChapter[];
  splitSource: SplitSource;
};

/**
 * Output of map(): Scriptr-shaped story + bible data ready for the UI to
 * preview and commit. Uses the actual Bible shape from lib/types.ts, not
 * a per-importer shape.
 */
export type ProposedWrite = {
  story: {
    title: string;
    description: string;
    keywords: string[];
  };
  bible: Bible;
};
```

- [ ] **Step 2: Typecheck**

Run:
```bash
cd /home/chase/projects/scriptr && npm run typecheck
```

Expected: exits 0, no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/chase/projects/scriptr && git add lib/novelai/types.ts && git commit -m "feat(novelai): add shared types for .story import pipeline"
```

---

### Task 1.3: Build a synthetic test fixture

**Why first, not later:** The decode module reads a binary format. Every decode test needs a fixture. Writing the fixture first means (a) it's available to every TDD loop after this, and (b) we never pull real user prose into the repo.

**Important context — real .story file shape (from investigation):** NovelAI's `content.document` is a base64+msgpack CRDT op log, not a tidy `{sectionId: {type,text,meta,source}}` map. The decoded tree contains msgpack maps whose **keys are arbitrary types** including floats (section ids), strings (long prose text stored as dict keys), and even lists. Values are a mix of ext-tagged references, small metadata objects, and more prose strings. An earlier draft of this plan tried to pick a "sections map by typed schema entries" — that approach fails on real files.

The approach the decoder takes (Task 1.6) is a **depth-first walk that collects every string ≥`MIN_PROSE_LEN` chars** (both as values and as dict keys), deduplicated while preserving order of first encounter. This is the approach explicitly called out as "Approach 1" in the spec's brainstorming session and was empirically verified to produce clean prose from the real sample file the user shared. It sacrifices perfect source=1/prompt filtering for robustness — see "Prompt leakage and the filter list" note in Task 1.6.

The fixture mirrors this reality by using a `Map` with integer + float keys (exercising the non-object-key code path in `@msgpack/msgpack`, which would otherwise silently decode to a plain JS object). The fixture also includes a short "premise" string (matching metadata.description) and a lorebook-entry text that should be filtered out by the decoder's filter list.

**Files:**
- Create: `/home/chase/projects/scriptr/lib/novelai/__fixtures__/build-sample.mjs`
- Create: `/home/chase/projects/scriptr/lib/novelai/__fixtures__/sample.story` (generated output)

- [ ] **Step 1: Write the fixture builder**

Write this content to `/home/chase/projects/scriptr/lib/novelai/__fixtures__/build-sample.mjs`:

```js
// Generates a synthetic NovelAI .story file for tests. Mirrors the CRDT
// document shape observed in real NovelAI exports (storyContainerVersion=1):
//
//   outer JSON:
//     { storyContainerVersion: 1, metadata: {...}, content: {...} }
//
//   content.document is base64(msgpack(streamed-objects)). Real files emit
//   a few opaque ext markers followed by Map objects whose keys include a
//   mix of floats (section ids), strings (long prose also appears as keys),
//   and numbers (keyTable indices). The decoder walks the whole tree and
//   harvests long strings; it does NOT require a specific schema.
//
// This fixture emits the simplest possible doc that still exercises:
//   - `Map` with integer keys (so the decoder's Map-handling path runs)
//   - A prose string long enough to be harvested (two, actually)
//   - A short "premise" string that matches metadata.description — the
//     decoder must filter it out via its premise/context/lorebook filter.
//
// Run: node lib/novelai/__fixtures__/build-sample.mjs
// Output: lib/novelai/__fixtures__/sample.story
//
// NOTE: prose below is synthetic placeholder content. DO NOT replace it
// with real NovelAI session output.

import { encode as msgpackEncode } from "@msgpack/msgpack";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const outDir = dirname(fileURLToPath(import.meta.url));

// --- Synthetic prose (source=2 equivalent) --------------------------------
const proseChapter1 =
  "The garden at dusk had a color no camera could catch — a green that thought of itself as silver, leaves hushed against the old stone wall.\n\n" +
  "She set her mug down on the iron bench and exhaled. For the first time in days she could hear herself think.";

const proseChapter2 =
  "Chapter 2: Morning\n\n" +
  "Light came through the curtains the color of weak tea. He'd forgotten to pull them all the way closed last night and now the whole room felt rinsed.\n\n" +
  "She was already up. He could hear the kettle from the kitchen.";

// Short split marker that appears between the two prose blocks
const markerBlock = "////";

// Short premise that duplicates metadata.description — decoder must filter
const premiseEcho = "A short two-chapter synthetic fixture for tests.";

// --- Build the msgpack op-log ---------------------------------------------
// Shape: [fixext marker, fixext marker, Map{ float-id -> prose-text, ... },
//         Map{ int-key -> prose-text }, Map{ key-table }]
// The exact structure doesn't matter — only that the decoder's tree-walk
// finds long strings inside it.

// fixext 1: byte 0xd4, then 1-byte type code, then 1-byte data
function fixext1(code, byteVal) {
  return new Uint8Array([0xd4, code & 0xff, byteVal & 0xff]);
}

const extA = fixext1(20, 0x00); // observed in real files
const extB = fixext1(114, 0x40); // observed in real files

// Map with float keys (section ids) → prose. msgpack Map encoding.
const sectionsA = new Map();
sectionsA.set(1497243114306281.0, proseChapter1);
sectionsA.set(1497243114306282.0, premiseEcho); // this one should be filtered
sectionsA.set(1497243114306283.0, markerBlock);

// Map with integer keys → more prose (simulates continuation ops)
const sectionsB = new Map();
sectionsB.set(1, proseChapter2);
sectionsB.set(2, "short bit"); // below MIN_PROSE_LEN — should be ignored

// Key table (an array of strings, as seen in real files)
const keyTable = ["type", "text", "meta", "source"];

const extAEnc = extA;
const extBEnc = extB;
const sectionsAEnc = msgpackEncode(sectionsA);
const sectionsBEnc = msgpackEncode(sectionsB);
const keyTableEnc = msgpackEncode(keyTable);

const totalLen =
  extAEnc.length +
  extBEnc.length +
  sectionsAEnc.length +
  sectionsBEnc.length +
  keyTableEnc.length;
const streamBytes = new Uint8Array(totalLen);
{
  let off = 0;
  streamBytes.set(extAEnc, off); off += extAEnc.length;
  streamBytes.set(extBEnc, off); off += extBEnc.length;
  streamBytes.set(sectionsAEnc, off); off += sectionsAEnc.length;
  streamBytes.set(sectionsBEnc, off); off += sectionsBEnc.length;
  streamBytes.set(keyTableEnc, off);
}

const documentB64 = Buffer.from(streamBytes).toString("base64");

// --- Outer envelope --------------------------------------------------------
const envelope = {
  storyContainerVersion: 1,
  metadata: {
    storyMetadataVersion: 1,
    id: "fixture-0000-0000-0000-000000000001",
    title: "Garden at Dusk",
    description: "A short two-chapter synthetic fixture for tests.",
    textPreview: "The garden at dusk had a color no camera could catch",
    isTA: false,
    favorite: false,
    tags: ["fixture", "test"],
    createdAt: 0,
    lastUpdatedAt: 0,
    isModified: false,
    hasDocument: true,
  },
  content: {
    storyContentVersion: 1,
    settings: {},
    document: documentB64,
    context: [
      { text: "Mira: mid-30s, quiet, notices small things. Narrator POV." },
      { text: "Style: spare, image-forward, no melodrama." },
    ],
    lorebook: {
      lorebookVersion: 5,
      entries: [
        {
          displayName: "Mira",
          text: "Mira is a gardener in her mid-30s. She keeps a small herb patch and a collection of old tea mugs.",
          keys: ["Mira"],
          category: "character",
        },
        {
          displayName: "The Walled Garden",
          text: "An old walled garden, south-facing, overgrown in places. A stone bench sits near the east wall.",
          keys: ["garden", "walled garden"],
          category: "location",
        },
      ],
      settings: { orderByKeyLocations: false },
      categories: [],
      order: [],
    },
    storyContextConfig: {},
    ephemeralContext: [],
    contextDefaults: {},
    settingsDirty: false,
    didGenerate: true,
    phraseBiasGroups: [],
    bannedSequenceGroups: [],
    messageSettings: {},
    sideChats: [],
    userScripts: [],
    scriptStorage: {},
  },
};

writeFileSync(join(outDir, "sample.story"), JSON.stringify(envelope, null, 2));
console.log("wrote", join(outDir, "sample.story"));
```

- [ ] **Step 2: Run the builder**

Run:
```bash
cd /home/chase/projects/scriptr && node lib/novelai/__fixtures__/build-sample.mjs
```

Expected: prints `wrote /home/chase/projects/scriptr/lib/novelai/__fixtures__/sample.story`. File exists.

- [ ] **Step 3: Self-verify the fixture round-trips through msgpack**

Run:
```bash
cd /home/chase/projects/scriptr && node -e "
const { decodeMulti } = require('@msgpack/msgpack');
const fs = require('node:fs');
const env = JSON.parse(fs.readFileSync('lib/novelai/__fixtures__/sample.story', 'utf-8'));
const bytes = Buffer.from(env.content.document, 'base64');
const objs = [...decodeMulti(bytes)];
console.log('decoded', objs.length, 'top-level objects');
for (let i = 0; i < objs.length; i++) {
  const o = objs[i];
  const t = o instanceof Map ? 'Map' : Array.isArray(o) ? 'Array' : typeof o;
  console.log(' ', i, t, o instanceof Map ? '(size=' + o.size + ')' : '');
}
"
```

Expected output:
```
decoded 5 top-level objects
  0 object
  1 object
  2 Map (size=3)
  3 Map (size=2)
  4 Array
```

(Objects 0 and 1 are the fixext markers decoded as opaque ext objects; objects 2 and 3 are the Maps; object 4 is the key-table array.)

If the output differs, the fixture builder has a bug — fix before continuing.

- [ ] **Step 4: Commit**

```bash
cd /home/chase/projects/scriptr && git add lib/novelai/__fixtures__/build-sample.mjs lib/novelai/__fixtures__/sample.story && git commit -m "test(novelai): synthetic .story fixture for import tests"
```

---

### Task 1.4: decode.ts — JSON outer envelope + size guard

The decoder is built in three TDD loops: outer JSON handling, msgpack body, and prose extraction. This first loop covers the outer envelope: parse JSON, validate version, enforce size limit. We stop before touching msgpack so the error cases are covered cleanly.

**Files:**
- Create: `/home/chase/projects/scriptr/lib/novelai/decode.ts`
- Create: `/home/chase/projects/scriptr/tests/lib/novelai/decode.test.ts`

- [ ] **Step 1: Write the failing test**

Write to `/home/chase/projects/scriptr/tests/lib/novelai/decode.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { decodeNovelAIStory, NovelAIDecodeError } from "@/lib/novelai/decode";

const FIXTURE_PATH = join(
  __dirname,
  "..",
  "..",
  "..",
  "lib",
  "novelai",
  "__fixtures__",
  "sample.story"
);

describe("decodeNovelAIStory — outer envelope", () => {
  it("rejects non-JSON input", async () => {
    const buf = Buffer.from("this is not json at all");
    await expect(decodeNovelAIStory(buf)).rejects.toBeInstanceOf(NovelAIDecodeError);
    await expect(decodeNovelAIStory(buf)).rejects.toMatchObject({
      userMessage: "File is not a valid NovelAI .story file.",
    });
  });

  it("rejects input over the 10MB size limit", async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1);
    await expect(decodeNovelAIStory(big)).rejects.toMatchObject({
      userMessage: "File too large (limit 10MB).",
    });
  });

  it("rejects wrong storyContainerVersion", async () => {
    const buf = Buffer.from(
      JSON.stringify({ storyContainerVersion: 99, metadata: {}, content: {} })
    );
    await expect(decodeNovelAIStory(buf)).rejects.toMatchObject({
      userMessage:
        "Unsupported NovelAI format version: got 99, expected 1.",
    });
  });

  it("reads metadata from the fixture", async () => {
    const buf = await readFile(FIXTURE_PATH);
    const parsed = await decodeNovelAIStory(buf);
    expect(parsed.title).toBe("Garden at Dusk");
    expect(parsed.description).toBe(
      "A short two-chapter synthetic fixture for tests."
    );
    expect(parsed.tags).toEqual(["fixture", "test"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/lib/novelai/decode.test.ts
```

Expected: FAIL — module `@/lib/novelai/decode` not found.

- [ ] **Step 3: Implement the outer-envelope part**

Write to `/home/chase/projects/scriptr/lib/novelai/decode.ts`:

```ts
import type { ParsedStory, LorebookEntry } from "@/lib/novelai/types";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export class NovelAIDecodeError extends Error {
  userMessage: string;
  constructor(userMessage: string) {
    super(userMessage);
    this.name = "NovelAIDecodeError";
    this.userMessage = userMessage;
  }
}

type RawEnvelope = {
  storyContainerVersion?: unknown;
  metadata?: {
    title?: unknown;
    description?: unknown;
    textPreview?: unknown;
    tags?: unknown;
  };
  content?: {
    document?: unknown;
    context?: unknown;
    lorebook?: unknown;
  };
};

export async function decodeNovelAIStory(buf: Buffer): Promise<ParsedStory> {
  if (buf.byteLength > MAX_BYTES) {
    throw new NovelAIDecodeError("File too large (limit 10MB).");
  }

  let env: RawEnvelope;
  try {
    env = JSON.parse(buf.toString("utf-8")) as RawEnvelope;
  } catch {
    throw new NovelAIDecodeError("File is not a valid NovelAI .story file.");
  }

  if (env.storyContainerVersion !== 1) {
    const got =
      typeof env.storyContainerVersion === "number" ||
      typeof env.storyContainerVersion === "string"
        ? env.storyContainerVersion
        : "unknown";
    throw new NovelAIDecodeError(
      `Unsupported NovelAI format version: got ${got}, expected 1.`
    );
  }

  const md = env.metadata ?? {};
  const title = typeof md.title === "string" ? md.title : "";
  const description = typeof md.description === "string" ? md.description : "";
  const textPreview = typeof md.textPreview === "string" ? md.textPreview : "";
  const tags = Array.isArray(md.tags)
    ? md.tags.filter((t): t is string => typeof t === "string")
    : [];

  // TODO (next task): decode content.document (msgpack), extract prose.
  // TODO (next task): extract context[], lorebook[].
  return {
    title,
    description,
    tags,
    textPreview,
    contextBlocks: [],
    lorebookEntries: [],
    prose: "",
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/lib/novelai/decode.test.ts
```

Expected: PASS — all four tests green.

- [ ] **Step 5: Commit**

```bash
cd /home/chase/projects/scriptr && git add lib/novelai/decode.ts tests/lib/novelai/decode.test.ts && git commit -m "feat(novelai): decode .story outer envelope (metadata, version, size guard)"
```

---

### Task 1.5: decode.ts — context + lorebook extraction

These live in the outer JSON envelope (no msgpack), so they're easy. Do them before the msgpack prose extraction so the fixture path stays partially covered even while the CRDT work is in progress.

**Files:**
- Modify: `/home/chase/projects/scriptr/lib/novelai/decode.ts`
- Modify: `/home/chase/projects/scriptr/tests/lib/novelai/decode.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `/home/chase/projects/scriptr/tests/lib/novelai/decode.test.ts`:

```ts
describe("decodeNovelAIStory — context and lorebook", () => {
  it("extracts context blocks from the fixture", async () => {
    const buf = await readFile(FIXTURE_PATH);
    const parsed = await decodeNovelAIStory(buf);
    expect(parsed.contextBlocks).toHaveLength(2);
    expect(parsed.contextBlocks[0]).toContain("Mira: mid-30s");
    expect(parsed.contextBlocks[1]).toContain("spare, image-forward");
  });

  it("extracts lorebook entries from the fixture", async () => {
    const buf = await readFile(FIXTURE_PATH);
    const parsed = await decodeNovelAIStory(buf);
    expect(parsed.lorebookEntries).toHaveLength(2);
    expect(parsed.lorebookEntries[0]).toMatchObject({
      displayName: "Mira",
      category: "character",
    });
    expect(parsed.lorebookEntries[0].text).toContain("gardener");
    expect(parsed.lorebookEntries[0].keys).toEqual(["Mira"]);

    expect(parsed.lorebookEntries[1]).toMatchObject({
      displayName: "The Walled Garden",
      category: "location",
    });
    expect(parsed.lorebookEntries[1].keys).toEqual(["garden", "walled garden"]);
  });

  it("handles missing context/lorebook gracefully", async () => {
    const minimal = Buffer.from(
      JSON.stringify({
        storyContainerVersion: 1,
        metadata: { title: "X" },
        content: {},
      })
    );
    const parsed = await decodeNovelAIStory(minimal);
    expect(parsed.contextBlocks).toEqual([]);
    expect(parsed.lorebookEntries).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/lib/novelai/decode.test.ts
```

Expected: the three new tests FAIL (existing four still pass).

- [ ] **Step 3: Implement context and lorebook extraction**

Replace the stub in `/home/chase/projects/scriptr/lib/novelai/decode.ts` with extraction of context blocks and lorebook entries. Replace the return statement (and the `// TODO` lines above it) in `decodeNovelAIStory` with:

```ts
  const contextBlocks = extractContextBlocks(env.content?.context);
  const lorebookEntries = extractLorebookEntries(env.content?.lorebook);

  // TODO (next task): decode content.document (msgpack), extract prose.
  return {
    title,
    description,
    tags,
    textPreview,
    contextBlocks,
    lorebookEntries,
    prose: "",
  };
}

function extractContextBlocks(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string") {
      const t = (item as { text: string }).text.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

function extractLorebookEntries(raw: unknown): LorebookEntry[] {
  if (!raw || typeof raw !== "object") return [];
  const entries = (raw as { entries?: unknown }).entries;
  const categories = (raw as { categories?: unknown }).categories;

  // Build a categoryId → categoryName lookup from lorebook.categories if present.
  // Real NovelAI files typically keep category *names* on each entry already,
  // but some older formats use category ids. We defensively handle both.
  const catNames: Map<string, string> = new Map();
  if (Array.isArray(categories)) {
    for (const c of categories) {
      if (c && typeof c === "object") {
        const cat = c as { id?: unknown; name?: unknown };
        if (typeof cat.id === "string" && typeof cat.name === "string") {
          catNames.set(cat.id, cat.name);
        }
      }
    }
  }

  if (!Array.isArray(entries)) return [];
  const out: LorebookEntry[] = [];
  for (const e of entries) {
    if (!e || typeof e !== "object") continue;
    const entry = e as {
      displayName?: unknown;
      text?: unknown;
      keys?: unknown;
      category?: unknown;
    };
    const displayName =
      typeof entry.displayName === "string" ? entry.displayName : "";
    const text = typeof entry.text === "string" ? entry.text : "";
    const keys = Array.isArray(entry.keys)
      ? entry.keys.filter((k): k is string => typeof k === "string")
      : [];
    let category: string | undefined;
    if (typeof entry.category === "string") {
      category = catNames.get(entry.category) ?? entry.category;
    }
    // Drop entries with no name/keys AND no text — nothing to import.
    if (!displayName && keys.length === 0 && !text) continue;
    out.push({ displayName, text, keys, category });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/lib/novelai/decode.test.ts
```

Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
cd /home/chase/projects/scriptr && git add lib/novelai/decode.ts tests/lib/novelai/decode.test.ts && git commit -m "feat(novelai): decode context blocks and lorebook entries"
```

---

### Task 1.6: decode.ts — msgpack tree-walk prose extraction

The schema-robust step. We decode the base64+msgpack blob into a stream of top-level objects, walk the whole tree (including `Map` objects' keys and values), collect every string whose length ≥ `MIN_PROSE_LEN` in order of first appearance, then filter out strings that duplicate metadata/context/lorebook content (those leak into the CRDT as dict keys on real files — the same text appears both as plain JSON outside the document and as a long dict key inside it).

**Why this design, not a typed-schema walk:** The real NovelAI CRDT document is an op log with msgpack `Map` objects whose keys include arbitrary floats, strings (long prose as keys!), and lists. Trying to name the "sections map" or assume a `{type,text,meta,source}` row shape fails on real files. The tree-walk is the approved "Approach 1" from the brainstorming session and was empirically verified to produce clean prose on the real sample file the user provided.

**Prompt leakage and the filter list:** This approach accepts some prompt leakage (user-typed directives that happen to be ≥`MIN_PROSE_LEN` chars). The filter list catches the obvious duplicates (premise echo, context blocks, lorebook entries). Anything still leaking through is the user's to remove in the import dialog (chapters have editable bodies and per-row delete). This trade-off is documented in the spec under Approach 1.

**Files:**
- Modify: `/home/chase/projects/scriptr/lib/novelai/decode.ts`
- Modify: `/home/chase/projects/scriptr/tests/lib/novelai/decode.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `/home/chase/projects/scriptr/tests/lib/novelai/decode.test.ts`:

```ts
describe("decodeNovelAIStory — prose extraction", () => {
  it("extracts long prose segments from the fixture", async () => {
    const buf = await readFile(FIXTURE_PATH);
    const parsed = await decodeNovelAIStory(buf);
    expect(parsed.prose).toContain("The garden at dusk");
    expect(parsed.prose).toContain("Chapter 2: Morning");
  });

  it("filters out strings that duplicate metadata.description", async () => {
    const buf = await readFile(FIXTURE_PATH);
    const parsed = await decodeNovelAIStory(buf);
    // The fixture stuffs "A short two-chapter synthetic fixture for tests."
    // into the CRDT as a long dict key. Decoder must drop it because it
    // exactly matches metadata.description.
    expect(parsed.prose).not.toContain(
      "A short two-chapter synthetic fixture for tests."
    );
  });

  it("preserves paragraph breaks within prose segments", async () => {
    const buf = await readFile(FIXTURE_PATH);
    const parsed = await decodeNovelAIStory(buf);
    // Chapter 1 in the fixture has an internal paragraph break ("\n\n").
    expect(parsed.prose).toMatch(/silver[^]*\n\n[^]*She set her mug/);
  });

  it("throws a user-friendly error when base64/msgpack decode fails", async () => {
    const corrupt = Buffer.from(
      JSON.stringify({
        storyContainerVersion: 1,
        metadata: { title: "X" },
        content: { document: "not-actually-valid-base64-msgpack-bytes" },
      })
    );
    await expect(decodeNovelAIStory(corrupt)).rejects.toMatchObject({
      userMessage: "Could not read the document inside this .story file.",
    });
  });

  it("throws 'no AI prose' when the document has no long strings", async () => {
    const { encode } = await import("@msgpack/msgpack");
    // A valid msgpack document with no strings ≥ MIN_PROSE_LEN.
    const m = new Map();
    m.set(1, "short"); // below threshold
    m.set(2, 42);
    const doc = Buffer.from(encode(m)).toString("base64");
    const env = Buffer.from(
      JSON.stringify({
        storyContainerVersion: 1,
        metadata: { title: "X" },
        content: { document: doc },
      })
    );
    await expect(decodeNovelAIStory(env)).rejects.toMatchObject({
      userMessage:
        "No AI-generated prose found — did you import before running any AI turns?",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/lib/novelai/decode.test.ts
```

Expected: the five new tests FAIL (the first three because `prose` is an empty string, the msgpack-error test and the no-prose test because we don't currently decode the document).

- [ ] **Step 3: Implement tree-walk prose extraction**

At the top of `/home/chase/projects/scriptr/lib/novelai/decode.ts`, add:

```ts
import { decodeMulti } from "@msgpack/msgpack";
```

And add a constant near the top of the file (below the imports and above `NovelAIDecodeError`):

```ts
const MIN_PROSE_LEN = 60;
```

Then replace the return block in `decodeNovelAIStory` (the one currently containing `prose: ""` with the stale TODO above it) with:

```ts
  const filterSet = buildFilterSet(description, textPreview, contextBlocks, lorebookEntries);
  const prose = extractProse(env.content?.document, filterSet);
  if (!prose) {
    throw new NovelAIDecodeError(
      "No AI-generated prose found — did you import before running any AI turns?"
    );
  }

  return {
    title,
    description,
    tags,
    textPreview,
    contextBlocks,
    lorebookEntries,
    prose,
  };
}

function buildFilterSet(
  description: string,
  textPreview: string,
  contextBlocks: string[],
  lorebookEntries: LorebookEntry[]
): Set<string> {
  const set = new Set<string>();
  const add = (s: string | undefined) => {
    if (!s) return;
    const t = s.trim();
    if (t) set.add(t);
  };
  add(description);
  add(textPreview);
  for (const c of contextBlocks) add(c);
  for (const e of lorebookEntries) add(e.text);
  return set;
}

function extractProse(doc: unknown, filter: Set<string>): string {
  if (typeof doc !== "string" || doc.length === 0) return "";

  let bytes: Uint8Array;
  try {
    // Buffer.from with "base64" silently ignores invalid bytes — to reliably
    // reject garbage we check shape afterwards via the msgpack decoder.
    bytes = Uint8Array.from(Buffer.from(doc, "base64"));
  } catch {
    throw new NovelAIDecodeError(
      "Could not read the document inside this .story file."
    );
  }
  if (bytes.byteLength === 0) {
    throw new NovelAIDecodeError(
      "Could not read the document inside this .story file."
    );
  }

  let objects: unknown[];
  try {
    objects = [...decodeMulti(bytes)];
  } catch {
    throw new NovelAIDecodeError(
      "Could not read the document inside this .story file."
    );
  }

  // Walk every top-level object depth-first, collecting every string of
  // length >= MIN_PROSE_LEN (whether it appears as a value or as a dict
  // key). Dedup while preserving order of first encounter.
  const seen = new Set<string>();
  const segments: string[] = [];

  const visit = (node: unknown): void => {
    if (typeof node === "string") {
      const trimmed = node.trim();
      if (
        trimmed.length >= MIN_PROSE_LEN &&
        !seen.has(trimmed) &&
        !filter.has(trimmed)
      ) {
        seen.add(trimmed);
        segments.push(trimmed);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const v of node) visit(v);
      return;
    }
    if (node instanceof Map) {
      for (const [k, v] of node) {
        visit(k);
        visit(v);
      }
      return;
    }
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        visit(k);
        visit(v);
      }
    }
    // primitives (number, boolean, null, undefined, ext-tagged opaque objects) — skip
  };

  for (const obj of objects) visit(obj);

  return segments.join("\n\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/lib/novelai/decode.test.ts
```

Expected: PASS — all tests green (the original 7 plus the 5 new ones = 12).

- [ ] **Step 5: Typecheck the whole project**

Run:
```bash
cd /home/chase/projects/scriptr && npm run typecheck
```

Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
cd /home/chase/projects/scriptr && git add lib/novelai/decode.ts tests/lib/novelai/decode.test.ts && git commit -m "feat(novelai): tree-walk prose extraction with dedup and filter list"
```

- [ ] **Step 7: (Optional but strongly recommended) Validate against a real .story file**

If you have access to a real NovelAI `.story` export, copy it to a scratch path (do NOT commit it), then run:

```bash
cd /home/chase/projects/scriptr && node -e "
(async () => {
  const { decodeNovelAIStory } = await import('./lib/novelai/decode.ts');
})();
" 2>&1 || echo "(tsx/ts-node may be needed for direct import; alternatively write a short .js wrapper)"
```

For a quick check without TS tooling, you can write a short `scripts/scratch-decode.mjs` that calls the compiled output of `tsc` against the real file and prints `parsed.prose.slice(0, 400)`. If prose is empty or contains obvious metadata duplicates, the filter set or the tree-walk needs adjustment — **do not proceed to Task 1.7 until real-file decoding looks sane**. Discard the scratch file afterwards (`git status` should be clean).

---

### Task 1.7: split.ts — `////` marker splitting

The simplest case first. Single-function module, single split rule.

**Files:**
- Create: `/home/chase/projects/scriptr/lib/novelai/split.ts`
- Create: `/home/chase/projects/scriptr/tests/lib/novelai/split.test.ts`

- [ ] **Step 1: Write the failing test**

Write to `/home/chase/projects/scriptr/tests/lib/novelai/split.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { splitProse } from "@/lib/novelai/split";

describe("splitProse — //// marker", () => {
  it("returns one chapter when no markers are present", () => {
    const r = splitProse("Just one block of prose.\n\nTwo paragraphs.");
    expect(r.splitSource).toBe("none");
    expect(r.chapters).toHaveLength(1);
    expect(r.chapters[0].body).toContain("Just one block");
    expect(r.chapters[0].body).toContain("Two paragraphs");
  });

  it("splits on a //// line", () => {
    const prose = "first chapter body\n\n////\n\nsecond chapter body";
    const r = splitProse(prose);
    expect(r.splitSource).toBe("marker");
    expect(r.chapters).toHaveLength(2);
    expect(r.chapters[0].body).toBe("first chapter body");
    expect(r.chapters[1].body).toBe("second chapter body");
  });

  it("consumes the marker line (does not keep it in output)", () => {
    const r = splitProse("a\n\n////\n\nb");
    expect(r.chapters[0].body).not.toContain("////");
    expect(r.chapters[1].body).not.toContain("////");
  });

  it("splits on multiple //// markers", () => {
    const r = splitProse("one\n\n////\n\ntwo\n\n////\n\nthree");
    expect(r.chapters).toHaveLength(3);
    expect(r.chapters.map((c) => c.body)).toEqual(["one", "two", "three"]);
  });

  it("accepts 5+ slashes too (// /////)", () => {
    const r = splitProse("a\n\n//////\n\nb");
    expect(r.chapters).toHaveLength(2);
  });

  it("drops empty chapters from leading/trailing markers", () => {
    const r = splitProse("////\n\na\n\n////\n\nb\n\n////");
    expect(r.chapters.map((c) => c.body)).toEqual(["a", "b"]);
  });

  it("falls back to single chapter if all chunks end up empty", () => {
    const r = splitProse("////\n\n////\n\n////");
    // We should never return zero chapters; empty-fallback triggers.
    expect(r.chapters).toHaveLength(1);
    expect(r.chapters[0].body).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/lib/novelai/split.test.ts
```

Expected: FAIL — module `@/lib/novelai/split` not found.

- [ ] **Step 3: Implement marker-based splitting**

Write to `/home/chase/projects/scriptr/lib/novelai/split.ts`:

```ts
import type {
  ProposedChapter,
  SplitResult,
  SplitSource,
} from "@/lib/novelai/types";

const MARKER_LINE = /^\s*\/{4,}\s*$/;

export function splitProse(prose: string): SplitResult {
  const lines = prose.split(/\r?\n/);
  const hasMarker = lines.some((l) => MARKER_LINE.test(l));
  if (hasMarker) {
    return splitByMarker(lines);
  }
  // TODO (next tasks): chapter-heading detection, horizontal-rule fallback.
  return finalize([{ title: "", body: prose.trim() }], "none");
}

function splitByMarker(lines: string[]): SplitResult {
  const chunks: string[][] = [[]];
  for (const line of lines) {
    if (MARKER_LINE.test(line)) {
      chunks.push([]);
    } else {
      chunks[chunks.length - 1].push(line);
    }
  }
  const chapters: ProposedChapter[] = chunks
    .map((c) => c.join("\n").trim())
    .filter((b) => b.length > 0)
    .map((body) => ({ title: "", body }));
  return finalize(chapters, "marker");
}

function finalize(
  chapters: ProposedChapter[],
  splitSource: SplitSource
): SplitResult {
  if (chapters.length === 0) {
    return { chapters: [{ title: "", body: "" }], splitSource: "none" };
  }
  return { chapters, splitSource };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/lib/novelai/split.test.ts
```

Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
cd /home/chase/projects/scriptr && git add lib/novelai/split.ts tests/lib/novelai/split.test.ts && git commit -m "feat(novelai): splitProse — //// marker-based chapter splitting"
```

---

### Task 1.8: split.ts — chapter-heading detection with title inference

Second priority: detect `Chapter N` / `Chapter N: Title` headings and use them as split points + title hints.

**Files:**
- Modify: `/home/chase/projects/scriptr/lib/novelai/split.ts`
- Modify: `/home/chase/projects/scriptr/tests/lib/novelai/split.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `/home/chase/projects/scriptr/tests/lib/novelai/split.test.ts`:

```ts
describe("splitProse — chapter headings", () => {
  it("splits on 'Chapter N' headings", () => {
    const r = splitProse("Chapter 1\n\nfirst\n\nChapter 2\n\nsecond");
    expect(r.splitSource).toBe("heading");
    expect(r.chapters).toHaveLength(2);
    expect(r.chapters[0].title).toBe("");
    expect(r.chapters[0].body).toBe("first");
    expect(r.chapters[1].title).toBe("");
    expect(r.chapters[1].body).toBe("second");
  });

  it("captures the title after 'Chapter N:'", () => {
    const prose = "Chapter 1: The Beginning\n\nopening text\n\nChapter 2: Middle\n\nmore text";
    const r = splitProse(prose);
    expect(r.chapters[0].title).toBe("The Beginning");
    expect(r.chapters[1].title).toBe("Middle");
  });

  it("recognizes roman numerals", () => {
    const r = splitProse("Chapter I\n\nfirst\n\nChapter II\n\nsecond");
    expect(r.chapters).toHaveLength(2);
  });

  it("is case-insensitive on 'Chapter'", () => {
    const r = splitProse("CHAPTER 1\n\nfoo\n\nchapter 2\n\nbar");
    expect(r.chapters).toHaveLength(2);
  });

  it("marker beats heading when both are present (marker has priority)", () => {
    const prose = "Chapter 1\n\nfirst\n\n////\n\nChapter 2\n\nsecond";
    const r = splitProse(prose);
    expect(r.splitSource).toBe("marker");
    expect(r.chapters).toHaveLength(2);
    // Chapter 1/2 lines stay in the bodies because marker-splitting runs first
    // and does not consume heading lines.
    expect(r.chapters[0].body).toContain("Chapter 1");
    expect(r.chapters[1].body).toContain("Chapter 2");
  });

  it("infers title from first sentence when no heading captured", () => {
    // No chapter heading, single chapter — no inference happens in this
    // implementation; title stays empty. Title inference only applies when
    // the split source provides a hint.
    const r = splitProse("Plain body with no heading at all.");
    expect(r.chapters[0].title).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/lib/novelai/split.test.ts
```

Expected: the first four new tests FAIL (existing ones + the last two pass).

- [ ] **Step 3: Implement chapter-heading detection**

In `/home/chase/projects/scriptr/lib/novelai/split.ts`, replace the `TODO` block and the fallthrough `return finalize([{ title: "", body: prose.trim() }], "none");` with heading detection. Replace the body of `splitProse` with:

```ts
export function splitProse(prose: string): SplitResult {
  const lines = prose.split(/\r?\n/);
  const hasMarker = lines.some((l) => MARKER_LINE.test(l));
  if (hasMarker) {
    return splitByMarker(lines);
  }

  const headingSplit = splitByChapterHeading(lines);
  if (headingSplit) return headingSplit;

  // TODO (next task): horizontal-rule fallback.
  return finalize([{ title: "", body: prose.trim() }], "none");
}
```

And add below `splitByMarker`:

```ts
// Matches lines like:
//   Chapter 1
//   Chapter 12: The Middle
//   Chapter IV - Moonrise
//   chapter iii — Title
const CHAPTER_HEADING =
  /^\s*chapter\s+([ivxlcdm]+|\d+)(?:\s*[:\-—]\s*(.+?))?\s*$/i;

function splitByChapterHeading(lines: string[]): SplitResult | null {
  // First pass: find all heading line indices and their captured titles.
  const headings: { index: number; title: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(CHAPTER_HEADING);
    if (m) headings.push({ index: i, title: (m[2] ?? "").trim() });
  }
  if (headings.length < 2) return null;

  const chapters: ProposedChapter[] = [];
  for (let h = 0; h < headings.length; h++) {
    const start = headings[h].index + 1;
    const end =
      h + 1 < headings.length ? headings[h + 1].index : lines.length;
    const body = lines.slice(start, end).join("\n").trim();
    chapters.push({ title: headings[h].title, body });
  }

  return finalize(
    chapters.filter((c) => c.body.length > 0 || c.title.length > 0),
    "heading"
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/lib/novelai/split.test.ts
```

Expected: PASS — all 13 tests green.

- [ ] **Step 5: Commit**

```bash
cd /home/chase/projects/scriptr && git add lib/novelai/split.ts tests/lib/novelai/split.test.ts && git commit -m "feat(novelai): splitProse — detect Chapter N headings, capture titles"
```

---

### Task 1.9: split.ts — horizontal-rule fallback + final polish

Last split rule. Only kicks in when neither `////` nor chapter headings are present, and there are at least 3 horizontal-rule lines (so we're confident they're structural, not random scene breaks).

**Files:**
- Modify: `/home/chase/projects/scriptr/lib/novelai/split.ts`
- Modify: `/home/chase/projects/scriptr/tests/lib/novelai/split.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `/home/chase/projects/scriptr/tests/lib/novelai/split.test.ts`:

```ts
describe("splitProse — horizontal-rule fallback", () => {
  it("ignores 1-2 horizontal rules (likely scene breaks, not chapter breaks)", () => {
    const prose = "a\n\n* * *\n\nb";
    const r = splitProse(prose);
    expect(r.splitSource).toBe("none");
    expect(r.chapters).toHaveLength(1);
    expect(r.chapters[0].body).toContain("* * *");
  });

  it("splits on 3+ horizontal rules as chapter breaks", () => {
    const prose = "a\n\n***\n\nb\n\n***\n\nc\n\n***\n\nd";
    const r = splitProse(prose);
    expect(r.splitSource).toBe("scenebreak-fallback");
    expect(r.chapters).toHaveLength(4);
    expect(r.chapters.map((c) => c.body)).toEqual(["a", "b", "c", "d"]);
  });

  it("also accepts --- as rule lines", () => {
    const prose = "a\n\n---\n\nb\n\n---\n\nc\n\n---\n\nd";
    const r = splitProse(prose);
    expect(r.splitSource).toBe("scenebreak-fallback");
    expect(r.chapters).toHaveLength(4);
  });

  it("also accepts ___ as rule lines", () => {
    const prose = "a\n\n___\n\nb\n\n___\n\nc\n\n___\n\nd";
    const r = splitProse(prose);
    expect(r.splitSource).toBe("scenebreak-fallback");
    expect(r.chapters).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/lib/novelai/split.test.ts
```

Expected: the first test passes (current "none" default already produces one chapter), the other two fail.

- [ ] **Step 3: Implement horizontal-rule fallback**

In `/home/chase/projects/scriptr/lib/novelai/split.ts`, replace the last TODO block in `splitProse` with:

```ts
  const ruleSplit = splitByHorizontalRules(lines);
  if (ruleSplit) return ruleSplit;

  return finalize([{ title: "", body: prose.trim() }], "none");
}
```

And add at the bottom of the file:

```ts
const RULE_LINE = /^\s*(?:\*\s*\*\s*\*|\*{3,}|-{3,}|_{3,})\s*$/;

function splitByHorizontalRules(lines: string[]): SplitResult | null {
  const ruleIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (RULE_LINE.test(lines[i])) ruleIndices.push(i);
  }
  if (ruleIndices.length < 3) return null;

  const chunks: string[][] = [[]];
  for (let i = 0; i < lines.length; i++) {
    if (ruleIndices.includes(i)) {
      chunks.push([]);
    } else {
      chunks[chunks.length - 1].push(lines[i]);
    }
  }
  const chapters: ProposedChapter[] = chunks
    .map((c) => c.join("\n").trim())
    .filter((b) => b.length > 0)
    .map((body) => ({ title: "", body }));
  return finalize(chapters, "scenebreak-fallback");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/lib/novelai/split.test.ts
```

Expected: PASS — all 16 tests green.

- [ ] **Step 5: Commit**

```bash
cd /home/chase/projects/scriptr && git add lib/novelai/split.ts tests/lib/novelai/split.test.ts && git commit -m "feat(novelai): splitProse — horizontal-rule fallback (3+ rules only)"
```

---

### Task 1.10: map.ts — Story and Bible shaping

Input: `ParsedStory`. Output: `ProposedWrite` with `{story, bible}`. Mapping rules per the spec's "Story + Bible mapping" section.

**Files:**
- Create: `/home/chase/projects/scriptr/lib/novelai/map.ts`
- Create: `/home/chase/projects/scriptr/tests/lib/novelai/map.test.ts`

- [ ] **Step 1: Write the failing test**

Write to `/home/chase/projects/scriptr/tests/lib/novelai/map.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mapToProposedWrite } from "@/lib/novelai/map";
import type { ParsedStory } from "@/lib/novelai/types";

function make(partial: Partial<ParsedStory>): ParsedStory {
  return {
    title: partial.title ?? "T",
    description: partial.description ?? "",
    tags: partial.tags ?? [],
    textPreview: partial.textPreview ?? "",
    contextBlocks: partial.contextBlocks ?? [],
    lorebookEntries: partial.lorebookEntries ?? [],
    prose: partial.prose ?? "",
  };
}

describe("mapToProposedWrite — story-level fields", () => {
  it("prefers description over textPreview for story.description", () => {
    const w = mapToProposedWrite(
      make({ description: "real desc", textPreview: "preview" })
    );
    expect(w.story.description).toBe("real desc");
  });

  it("falls back to textPreview when description is empty", () => {
    const w = mapToProposedWrite(
      make({ description: "", textPreview: "preview text" })
    );
    expect(w.story.description).toBe("preview text");
  });

  it("passes title and tags through", () => {
    const w = mapToProposedWrite(
      make({ title: "My Book", tags: ["a", "b"] })
    );
    expect(w.story.title).toBe("My Book");
    expect(w.story.keywords).toEqual(["a", "b"]);
  });
});

describe("mapToProposedWrite — lorebook classification", () => {
  it("category person/character/people → characters", () => {
    const w = mapToProposedWrite(
      make({
        lorebookEntries: [
          { displayName: "Alice", text: "a woman", keys: [], category: "character" },
          { displayName: "Bob", text: "a man", keys: [], category: "Person" },
          { displayName: "Club", text: "the club", keys: [], category: "People" },
        ],
      })
    );
    expect(w.bible.characters.map((c) => c.name)).toEqual(["Alice", "Bob", "Club"]);
  });

  it("category place/location/setting → setting string", () => {
    const w = mapToProposedWrite(
      make({
        lorebookEntries: [
          { displayName: "Town", text: "a small town", keys: [], category: "location" },
          { displayName: "Castle", text: "stone walls", keys: [], category: "Place" },
        ],
      })
    );
    expect(w.bible.setting).toContain("## Town");
    expect(w.bible.setting).toContain("a small town");
    expect(w.bible.setting).toContain("## Castle");
    expect(w.bible.characters).toHaveLength(0);
  });

  it("no category + pronouns in text → character", () => {
    const w = mapToProposedWrite(
      make({
        lorebookEntries: [
          { displayName: "Mira", text: "She notices the garden and its plants.", keys: [] },
        ],
      })
    );
    expect(w.bible.characters.map((c) => c.name)).toEqual(["Mira"]);
  });

  it("no category + location cues → place", () => {
    const w = mapToProposedWrite(
      make({
        lorebookEntries: [
          { displayName: "Garden", text: "The garden is a city green space.", keys: [] },
        ],
      })
    );
    expect(w.bible.setting).toContain("## Garden");
  });

  it("no category + ambiguous text → character (default)", () => {
    const w = mapToProposedWrite(
      make({
        lorebookEntries: [
          { displayName: "Widget", text: "Just a noun.", keys: [] },
        ],
      })
    );
    expect(w.bible.characters.map((c) => c.name)).toEqual(["Widget"]);
  });

  it("uses first key when displayName is empty", () => {
    const w = mapToProposedWrite(
      make({
        lorebookEntries: [
          { displayName: "", text: "a person", keys: ["fallback-name", "other"] },
        ],
      })
    );
    expect(w.bible.characters[0].name).toBe("fallback-name");
  });

  it("empty lorebook → empty characters and setting", () => {
    const w = mapToProposedWrite(make({ lorebookEntries: [] }));
    expect(w.bible.characters).toEqual([]);
    expect(w.bible.setting).toBe("");
  });
});

describe("mapToProposedWrite — context blocks", () => {
  it("joins context with separator into styleNotes", () => {
    const w = mapToProposedWrite(
      make({ contextBlocks: ["Memory line", "Author's note line"] })
    );
    expect(w.bible.styleNotes).toBe("Memory line\n\n---\n\nAuthor's note line");
  });

  it("empty context → empty styleNotes", () => {
    const w = mapToProposedWrite(make({ contextBlocks: [] }));
    expect(w.bible.styleNotes).toBe("");
  });
});

describe("mapToProposedWrite — defaults", () => {
  it("sets pov/tone/nsfwPreferences to safe defaults", () => {
    const w = mapToProposedWrite(make({}));
    expect(w.bible.pov).toBe("third-limited");
    expect(w.bible.tone).toBe("");
    expect(w.bible.nsfwPreferences).toBe("");
    expect(w.bible.styleOverrides).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/lib/novelai/map.test.ts
```

Expected: FAIL — module `@/lib/novelai/map` not found.

- [ ] **Step 3: Implement the mapper**

Write to `/home/chase/projects/scriptr/lib/novelai/map.ts`:

```ts
import type { Bible, Character } from "@/lib/types";
import type { LorebookEntry, ParsedStory, ProposedWrite } from "@/lib/novelai/types";

type Classification = "character" | "place" | "ambiguous";

const PERSON_CATEGORY = /person|character|people/i;
const PLACE_CATEGORY = /place|location|setting/i;
const PRONOUN_CUE = /\b(?:he|she|they|his|her|their)\b/i;
const PLACE_CUE =
  /\bis\s+an?\s+[^.]*\b(city|town|village|room|house|building|campus|dorm|forest|garden|castle|mountain|river|street|neighborhood|district|planet|realm)\b/i;

function classify(entry: LorebookEntry): Classification {
  if (entry.category) {
    if (PERSON_CATEGORY.test(entry.category)) return "character";
    if (PLACE_CATEGORY.test(entry.category)) return "place";
  }
  // Use first sentence of text for heuristics. Strip to reduce noise.
  const firstSentence = entry.text.split(/(?<=\.)\s+/)[0] ?? "";
  if (PLACE_CUE.test(firstSentence)) return "place";
  if (PRONOUN_CUE.test(firstSentence)) return "character";
  return "ambiguous";
}

function nameFor(entry: LorebookEntry): string {
  if (entry.displayName) return entry.displayName;
  if (entry.keys.length > 0) return entry.keys[0];
  return "";
}

export function mapToProposedWrite(parsed: ParsedStory): ProposedWrite {
  const description = parsed.description || parsed.textPreview;
  const keywords = parsed.tags;

  const characters: Character[] = [];
  const placeBlocks: string[] = [];

  for (const entry of parsed.lorebookEntries) {
    const name = nameFor(entry);
    if (!name && !entry.text) continue;
    const kind = classify(entry);
    if (kind === "place") {
      const header = name ? `## ${name}` : "## (unnamed)";
      placeBlocks.push(`${header}\n${entry.text}`.trim());
    } else {
      // character or ambiguous (default to character)
      characters.push({
        name,
        description: entry.text,
      });
    }
  }

  const bible: Bible = {
    characters,
    setting: placeBlocks.join("\n\n"),
    pov: "third-limited",
    tone: "",
    styleNotes: parsed.contextBlocks.join("\n\n---\n\n"),
    nsfwPreferences: "",
  };

  return {
    story: {
      title: parsed.title,
      description,
      keywords,
    },
    bible,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/lib/novelai/map.test.ts
```

Expected: PASS — all 12 tests green.

- [ ] **Step 5: Commit**

```bash
cd /home/chase/projects/scriptr && git add lib/novelai/map.ts tests/lib/novelai/map.test.ts && git commit -m "feat(novelai): map parsed .story to Scriptr story + bible shape"
```

---

### Task 1.11: Extend `splitChapterChunks` in `lib/publish/cleanup.ts` to recognize `////`

Per the spec, `////` should be a portable split marker — the paste importer already recognizes `=== CHAPTER ===`, and we want `////` to work there too.

**Files:**
- Modify: `/home/chase/projects/scriptr/lib/publish/cleanup.ts`
- Modify: `/home/chase/projects/scriptr/tests/lib/publish-cleanup.test.ts` (existing file — the `splitChapterChunks` test block starts around line 344)

- [ ] **Step 1: Confirm the existing test file path**

Run:
```bash
cd /home/chase/projects/scriptr && grep -l "splitChapterChunks" tests/lib/*.test.ts
```

Expected output: `tests/lib/publish-cleanup.test.ts` (single line).

If a different or additional file is returned, **append** the new `describe` block to that file — do not create `tests/lib/publish/cleanup.test.ts`.

- [ ] **Step 2: Append the failing test to the existing file**

Open `/home/chase/projects/scriptr/tests/lib/publish-cleanup.test.ts` and append (at the end, after the closing brace of the existing `describe("splitChapterChunks", ...)` block):

```ts
describe("splitChapterChunks — //// marker", () => {
  it("splits on //// alongside === CHAPTER ===", () => {
    const raw = "first\n\n////\n\nsecond";
    const parts = splitChapterChunks(raw);
    expect(parts).toHaveLength(2);
    expect(parts[0].trim()).toBe("first");
    expect(parts[1].trim()).toBe("second");
  });

  it("splits on either //// or === CHAPTER === in the same document", () => {
    const raw = "a\n\n////\n\nb\n\n=== CHAPTER ===\n\nc";
    const parts = splitChapterChunks(raw);
    expect(parts).toHaveLength(3);
    expect(parts.map((p) => p.trim())).toEqual(["a", "b", "c"]);
  });
});
```

`splitChapterChunks` is already imported at the top of the file (line 4) — no new imports needed.

- [ ] **Step 3: Run test to verify it fails**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/lib/publish-cleanup.test.ts
```

Expected: the two new tests FAIL; existing tests continue to pass.

- [ ] **Step 4: Extend the regex**

Open `/home/chase/projects/scriptr/lib/publish/cleanup.ts`. Find the block around line 149-153:

```ts
// Matches whole-line `=== CHAPTER ===` with case-insensitive / relaxed whitespace.
const CHAPTER_MARKER = /^[ \t]*={3,}[ \t]*chapter[ \t]*={3,}[ \t]*$/gim;

export function splitChapterChunks(raw: string): string[] {
  return raw.split(CHAPTER_MARKER);
}
```

Replace with:

```ts
// Matches whole-line chapter markers. Two accepted forms:
//   === CHAPTER === (classic paste-importer marker)
//   ////            (4+ slashes; shared with the NovelAI .story importer)
const CHAPTER_MARKER =
  /^[ \t]*(?:={3,}[ \t]*chapter[ \t]*={3,}|\/{4,})[ \t]*$/gim;

export function splitChapterChunks(raw: string): string[] {
  return raw.split(CHAPTER_MARKER);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/lib/publish-cleanup.test.ts
```

Expected: PASS — new tests and all existing tests green.

- [ ] **Step 6: Sanity-check the whole test suite**

Run:
```bash
cd /home/chase/projects/scriptr && npm test
```

Expected: all tests pass. No unexpected regressions in other cleanup/prompts/paste-importer tests.

- [ ] **Step 7: Commit**

```bash
cd /home/chase/projects/scriptr && git add lib/publish/cleanup.ts tests/lib/publish-cleanup.test.ts && git commit -m "feat(publish): splitChapterChunks recognizes //// alongside === CHAPTER ==="
```

---

### Task 1.12: Chunk-1 integration smoke test

End-to-end within the lib: fixture bytes → `decode` → `split` → `mapToProposedWrite` → sane output. Acts as a regression fence for the entire pipeline.

**Files:**
- Create: `/home/chase/projects/scriptr/tests/lib/novelai/pipeline.test.ts`

- [ ] **Step 1: Write the failing test**

Write to `/home/chase/projects/scriptr/tests/lib/novelai/pipeline.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { decodeNovelAIStory } from "@/lib/novelai/decode";
import { splitProse } from "@/lib/novelai/split";
import { mapToProposedWrite } from "@/lib/novelai/map";

const FIXTURE = join(
  __dirname,
  "..",
  "..",
  "..",
  "lib",
  "novelai",
  "__fixtures__",
  "sample.story"
);

describe("novelai pipeline smoke", () => {
  it("decodes → splits → maps the fixture into sensible output", async () => {
    const buf = await readFile(FIXTURE);
    const parsed = await decodeNovelAIStory(buf);

    // Prose must not contain the premise echo that the decoder was asked to filter.
    expect(parsed.prose).not.toContain(
      "A short two-chapter synthetic fixture for tests."
    );

    const split = splitProse(parsed.prose);
    expect(split.splitSource).toBe("marker"); // fixture contains ////
    expect(split.chapters.length).toBeGreaterThanOrEqual(2);
    // Neither chapter body should contain metadata-leaked content.
    for (const ch of split.chapters) {
      expect(ch.body).not.toContain(
        "A short two-chapter synthetic fixture for tests."
      );
    }

    const write = mapToProposedWrite(parsed);
    expect(write.story.title).toBe("Garden at Dusk");
    expect(write.story.description).toContain("synthetic fixture");
    expect(write.story.keywords).toEqual(["fixture", "test"]);
    expect(write.bible.characters.map((c) => c.name)).toContain("Mira");
    expect(write.bible.setting).toContain("## The Walled Garden");
    expect(write.bible.styleNotes).toContain("Mira: mid-30s");
  });
});
```

- [ ] **Step 2: Run the test**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/lib/novelai/pipeline.test.ts
```

Expected: PASS — all three modules compose cleanly on the fixture.

- [ ] **Step 3: Final chunk-1 sanity run**

Run:
```bash
cd /home/chase/projects/scriptr && npm run lint && npm run typecheck && npm test
```

Expected: all three green.

- [ ] **Step 4: Commit**

```bash
cd /home/chase/projects/scriptr && git add tests/lib/novelai/pipeline.test.ts && git commit -m "test(novelai): end-to-end pipeline smoke on fixture"
```

---

**End of Chunk 1.** At this point we have:
- `lib/novelai/{types,decode,split,map}.ts` — four small focused modules, each with its own test file.
- A committed synthetic fixture + its builder script.
- The paste importer's `splitChapterChunks` now accepts `////` too.
- All tests pass (`npm test`), typecheck passes, lint passes.

Chunks 2 and 3 build on this foundation. Chunk 2 wires the library into API routes; Chunk 3 builds the UI.

---

## Chunk 2: API routes + privacy test extension

Two routes: `POST /api/import/novelai/parse` (parses bytes, returns preview) and `POST /api/import/novelai/commit` (writes to disk, either new story or append to existing). Both are exercised in [tests/privacy/no-external-egress.test.ts](../../../tests/privacy/no-external-egress.test.ts) to enforce the privacy invariant.

### Task 2.1: parse route — scaffolding + version/size errors

**Files:**
- Create: `/home/chase/projects/scriptr/app/api/import/novelai/parse/route.ts`
- Create: `/home/chase/projects/scriptr/tests/api/import-novelai.parse.test.ts`

- [ ] **Step 1: Write the failing test**

Write to `/home/chase/projects/scriptr/tests/api/import-novelai.parse.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";

const FIXTURE = join(
  __dirname,
  "..",
  "..",
  "lib",
  "novelai",
  "__fixtures__",
  "sample.story"
);

function makeReq(
  url: string,
  file: Buffer | null,
  filename = "sample.story"
): NextRequest {
  const fd = new FormData();
  if (file) {
    fd.append(
      "file",
      new Blob([file], { type: "application/octet-stream" }),
      filename
    );
  }
  return new Request(url, { method: "POST", body: fd }) as unknown as NextRequest;
}

describe("POST /api/import/novelai/parse — errors", () => {
  let tmp: string;
  const originalEnv = process.env;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "scriptr-parse-"));
    process.env = { ...originalEnv, SCRIPTR_DATA_DIR: tmp };
  });
  afterEach(async () => {
    process.env = originalEnv;
    await rm(tmp, { recursive: true, force: true });
  });

  it("returns 400 when no file is attached", async () => {
    const { POST } = await import("@/app/api/import/novelai/parse/route");
    const res = await POST(makeReq("http://localhost/api/import/novelai/parse", null));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("No file uploaded.");
  });

  it("returns 400 with user-facing error on non-JSON garbage", async () => {
    const { POST } = await import("@/app/api/import/novelai/parse/route");
    const req = makeReq(
      "http://localhost/api/import/novelai/parse",
      Buffer.from("this is not json at all")
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("File is not a valid NovelAI .story file.");
  });

  it("returns 400 for unsupported version", async () => {
    const { POST } = await import("@/app/api/import/novelai/parse/route");
    const req = makeReq(
      "http://localhost/api/import/novelai/parse",
      Buffer.from(
        JSON.stringify({ storyContainerVersion: 99, metadata: {}, content: {} })
      )
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Unsupported NovelAI format version");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/api/import-novelai.parse.test.ts
```

Expected: FAIL — route module not found.

- [ ] **Step 3: Implement the route**

Create directories as needed, then write `/home/chase/projects/scriptr/app/api/import/novelai/parse/route.ts`:

```ts
import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api";
import { decodeNovelAIStory, NovelAIDecodeError } from "@/lib/novelai/decode";
import { splitProse } from "@/lib/novelai/split";
import { mapToProposedWrite } from "@/lib/novelai/map";

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("No file uploaded.", 400);
  }

  const fileEntry = form.get("file");
  if (!(fileEntry instanceof File) && !(fileEntry instanceof Blob)) {
    return fail("No file uploaded.", 400);
  }

  const buf = Buffer.from(await fileEntry.arrayBuffer());
  if (buf.byteLength === 0) {
    return fail("No file uploaded.", 400);
  }

  let parsed;
  try {
    parsed = await decodeNovelAIStory(buf);
  } catch (err) {
    if (err instanceof NovelAIDecodeError) return fail(err.userMessage, 400);
    return fail("Could not read the document inside this .story file.", 400);
  }

  const split = splitProse(parsed.prose);
  const proposed = mapToProposedWrite(parsed);

  return ok({ parsed, split, proposed });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/api/import-novelai.parse.test.ts
```

Expected: PASS — all three tests green.

- [ ] **Step 5: Commit**

```bash
cd /home/chase/projects/scriptr && git add app/api/import/novelai/parse/route.ts tests/api/import-novelai.parse.test.ts && git commit -m "feat(api): POST /api/import/novelai/parse — multipart + error envelopes"
```

---

### Task 2.2: parse route — happy path on the fixture

**Files:**
- Modify: `/home/chase/projects/scriptr/tests/api/import-novelai.parse.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `/home/chase/projects/scriptr/tests/api/import-novelai.parse.test.ts`:

```ts
describe("POST /api/import/novelai/parse — happy path", () => {
  let tmp: string;
  const originalEnv = process.env;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "scriptr-parse-"));
    process.env = { ...originalEnv, SCRIPTR_DATA_DIR: tmp };
  });
  afterEach(async () => {
    process.env = originalEnv;
    await rm(tmp, { recursive: true, force: true });
  });

  it("returns parsed/split/proposed for the fixture", async () => {
    const file = await readFile(FIXTURE);
    const { POST } = await import("@/app/api/import/novelai/parse/route");
    const res = await POST(
      makeReq("http://localhost/api/import/novelai/parse", file)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.parsed.title).toBe("Garden at Dusk");
    expect(body.data.split.splitSource).toBe("marker");
    expect(body.data.split.chapters.length).toBeGreaterThanOrEqual(2);
    expect(body.data.proposed.story.keywords).toEqual(["fixture", "test"]);
    expect(body.data.proposed.bible.characters.map((c: { name: string }) => c.name))
      .toContain("Mira");
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/api/import-novelai.parse.test.ts
```

Expected: PASS — the route wiring already supports this case since Task 2.1 implemented the full flow. (If it fails, investigate: the route implementation is complete but the test may have a multipart-assembly issue.)

- [ ] **Step 3: Commit**

```bash
cd /home/chase/projects/scriptr && git add tests/api/import-novelai.parse.test.ts && git commit -m "test(api): parse route happy path on fixture"
```

---

### Task 2.3: commit route — new-story mode

**Files:**
- Create: `/home/chase/projects/scriptr/app/api/import/novelai/commit/route.ts`
- Create: `/home/chase/projects/scriptr/tests/api/import-novelai.commit.test.ts`

- [ ] **Step 1: Write the failing test**

Write to `/home/chase/projects/scriptr/tests/api/import-novelai.commit.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { getStory } from "@/lib/storage/stories";
import { listChapters } from "@/lib/storage/chapters";

function makeJsonReq(url: string, body: unknown): NextRequest {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe("POST /api/import/novelai/commit — new-story mode", () => {
  let tmp: string;
  const originalEnv = process.env;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "scriptr-commit-"));
    process.env = { ...originalEnv, SCRIPTR_DATA_DIR: tmp };
  });
  afterEach(async () => {
    process.env = originalEnv;
    await rm(tmp, { recursive: true, force: true });
  });

  it("creates a story with description, keywords, bible, and chapters", async () => {
    const { POST } = await import("@/app/api/import/novelai/commit/route");
    const res = await POST(
      makeJsonReq("http://localhost/api/import/novelai/commit", {
        target: "new-story",
        story: {
          title: "Imported Book",
          description: "a desc",
          keywords: ["a", "b"],
        },
        bible: {
          characters: [{ name: "Alice", description: "a woman" }],
          setting: "## Town\na small town",
          pov: "third-limited",
          tone: "",
          styleNotes: "some style",
          nsfwPreferences: "",
        },
        chapters: [
          { title: "One", body: "first chapter body" },
          { title: "", body: "second chapter body" },
        ],
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.slug).toBe("imported-book");
    expect(body.data.chapterIds).toHaveLength(2);

    const story = await getStory(tmp, "imported-book");
    expect(story?.description).toBe("a desc");
    expect(story?.keywords).toEqual(["a", "b"]);

    const bibleRaw = await readFile(
      join(tmp, "stories", "imported-book", "bible.json"),
      "utf-8"
    );
    const bible = JSON.parse(bibleRaw);
    expect(bible.characters[0].name).toBe("Alice");
    expect(bible.styleNotes).toBe("some style");

    const chapters = await listChapters(tmp, "imported-book");
    expect(chapters.map((c) => c.title)).toEqual(["One", "Untitled"]);
    expect(chapters[0].sections[0].content).toBe("first chapter body");
    expect(chapters[0].source).toBe("imported");
  });

  it("auto-suffixes the slug on collision", async () => {
    const { POST } = await import("@/app/api/import/novelai/commit/route");
    const first = await POST(
      makeJsonReq("http://localhost/api/import/novelai/commit", {
        target: "new-story",
        story: { title: "Same Title", description: "", keywords: [] },
        bible: {
          characters: [],
          setting: "",
          pov: "third-limited",
          tone: "",
          styleNotes: "",
          nsfwPreferences: "",
        },
        chapters: [{ title: "One", body: "body" }],
      })
    );
    expect((await first.json()).data.slug).toBe("same-title");

    const second = await POST(
      makeJsonReq("http://localhost/api/import/novelai/commit", {
        target: "new-story",
        story: { title: "Same Title", description: "", keywords: [] },
        bible: {
          characters: [],
          setting: "",
          pov: "third-limited",
          tone: "",
          styleNotes: "",
          nsfwPreferences: "",
        },
        chapters: [{ title: "One", body: "body" }],
      })
    );
    expect((await second.json()).data.slug).toBe("same-title-2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/api/import-novelai.commit.test.ts
```

Expected: FAIL — route module not found.

- [ ] **Step 3: Implement the commit route (new-story mode only for now)**

Write to `/home/chase/projects/scriptr/app/api/import/novelai/commit/route.ts`:

```ts
import type { NextRequest } from "next/server";
import { writeFile } from "node:fs/promises";
import { ok, fail, readJson } from "@/lib/api";
import { effectiveDataDir } from "@/lib/config";
import { createStory, updateStory, deleteStory } from "@/lib/storage/stories";
import { createImportedChapter } from "@/lib/storage/chapters";
import { bibleJson } from "@/lib/storage/paths";
import type { Bible } from "@/lib/types";
import type { ProposedChapter } from "@/lib/novelai/types";

type CommitRequest =
  | {
      target: "new-story";
      story: { title: string; description: string; keywords: string[] };
      bible: Bible;
      chapters: ProposedChapter[];
    }
  | {
      target: "existing-story";
      slug: string;
      chapters: ProposedChapter[];
    };

export async function POST(req: NextRequest) {
  const body = await readJson<CommitRequest>(req);

  if (body.target === "new-story") {
    return handleNewStory(body);
  }
  if (body.target === "existing-story") {
    return handleExistingStory(body);
  }
  return fail("invalid target", 400);
}

async function handleNewStory(
  body: Extract<CommitRequest, { target: "new-story" }>
) {
  if (!body.story?.title || typeof body.story.title !== "string") {
    return fail("title required", 400);
  }
  if (!Array.isArray(body.chapters) || body.chapters.length === 0) {
    return fail("at least one chapter required", 400);
  }

  const dataDir = effectiveDataDir();
  const story = await createStory(dataDir, { title: body.story.title });

  try {
    await updateStory(dataDir, story.slug, {
      description: body.story.description ?? "",
      keywords: Array.isArray(body.story.keywords) ? body.story.keywords : [],
    });

    await writeFile(
      bibleJson(dataDir, story.slug),
      JSON.stringify(body.bible, null, 2),
      "utf-8"
    );

    const chapterIds: string[] = [];
    for (const ch of body.chapters) {
      const title = (ch.title || "Untitled").trim() || "Untitled";
      const created = await createImportedChapter(dataDir, story.slug, {
        title,
        sectionContents: [ch.body],
      });
      chapterIds.push(created.id);
    }

    return ok({ slug: story.slug, chapterIds });
  } catch (err) {
    // Rollback: new-story mode owns the whole story dir; unlink it.
    await deleteStory(dataDir, story.slug).catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    return fail(`Failed to write story files: ${msg}`, 500);
  }
}

async function handleExistingStory(
  _body: Extract<CommitRequest, { target: "existing-story" }>
) {
  // Implemented in Task 2.4.
  return fail("not implemented", 501);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/api/import-novelai.commit.test.ts
```

Expected: PASS — both new-story tests green. (The "existing-story" test will arrive in the next task.)

- [ ] **Step 5: Commit**

```bash
cd /home/chase/projects/scriptr && git add app/api/import/novelai/commit/route.ts tests/api/import-novelai.commit.test.ts && git commit -m "feat(api): POST /api/import/novelai/commit — new-story mode"
```

---

### Task 2.4: commit route — existing-story mode

**Files:**
- Modify: `/home/chase/projects/scriptr/app/api/import/novelai/commit/route.ts`
- Modify: `/home/chase/projects/scriptr/tests/api/import-novelai.commit.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `/home/chase/projects/scriptr/tests/api/import-novelai.commit.test.ts`:

```ts
describe("POST /api/import/novelai/commit — existing-story mode", () => {
  let tmp: string;
  const originalEnv = process.env;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "scriptr-commit-ex-"));
    process.env = { ...originalEnv, SCRIPTR_DATA_DIR: tmp };
  });
  afterEach(async () => {
    process.env = originalEnv;
    await rm(tmp, { recursive: true, force: true });
  });

  it("appends chapters to an existing story", async () => {
    // Seed: create a story with one chapter via storage helpers directly.
    const { createStory } = await import("@/lib/storage/stories");
    const { createChapter } = await import("@/lib/storage/chapters");
    const story = await createStory(tmp, { title: "Host" });
    await createChapter(tmp, story.slug, { title: "Existing Ch 1" });

    const { POST } = await import("@/app/api/import/novelai/commit/route");
    const res = await POST(
      makeJsonReq("http://localhost/api/import/novelai/commit", {
        target: "existing-story",
        slug: story.slug,
        chapters: [
          { title: "New A", body: "new a body" },
          { title: "New B", body: "new b body" },
        ],
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.slug).toBe(story.slug);
    expect(body.data.chapterIds).toHaveLength(2);

    const all = await listChapters(tmp, story.slug);
    expect(all.map((c) => c.title)).toEqual(["Existing Ch 1", "New A", "New B"]);
    expect(all[1].source).toBe("imported");
  });

  it("returns 404 when the story slug does not exist", async () => {
    const { POST } = await import("@/app/api/import/novelai/commit/route");
    const res = await POST(
      makeJsonReq("http://localhost/api/import/novelai/commit", {
        target: "existing-story",
        slug: "does-not-exist",
        chapters: [{ title: "x", body: "y" }],
      })
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Story not found.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/api/import-novelai.commit.test.ts
```

Expected: the two new tests FAIL (current handler returns 501 for existing-story).

- [ ] **Step 3: Implement existing-story mode**

In `/home/chase/projects/scriptr/app/api/import/novelai/commit/route.ts`, add `getStory` to the imports:

```ts
import { createStory, updateStory, deleteStory, getStory } from "@/lib/storage/stories";
```

Replace the `handleExistingStory` stub with:

```ts
async function handleExistingStory(
  body: Extract<CommitRequest, { target: "existing-story" }>
) {
  if (!body.slug || typeof body.slug !== "string") {
    return fail("slug required", 400);
  }
  if (!Array.isArray(body.chapters) || body.chapters.length === 0) {
    return fail("at least one chapter required", 400);
  }

  const dataDir = effectiveDataDir();
  const existing = await getStory(dataDir, body.slug);
  if (!existing) {
    return fail("Story not found.", 404);
  }

  const chapterIds: string[] = [];
  try {
    for (const ch of body.chapters) {
      const title = (ch.title || "Untitled").trim() || "Untitled";
      const created = await createImportedChapter(dataDir, body.slug, {
        title,
        sectionContents: [ch.body],
      });
      chapterIds.push(created.id);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(`Failed to write chapter files: ${msg}`, 500);
  }

  return ok({ slug: body.slug, chapterIds });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/api/import-novelai.commit.test.ts
```

Expected: PASS — all four tests green (2 new-story + 2 existing-story).

- [ ] **Step 5: Commit**

```bash
cd /home/chase/projects/scriptr && git add app/api/import/novelai/commit/route.ts tests/api/import-novelai.commit.test.ts && git commit -m "feat(api): commit route — existing-story append mode"
```

---

### Task 2.5: Privacy test — exercise both new routes

**Files:**
- Modify: `/home/chase/projects/scriptr/tests/privacy/no-external-egress.test.ts`

- [ ] **Step 1: Confirm the fixture path and understand the test structure**

Read [tests/privacy/no-external-egress.test.ts](../../../tests/privacy/no-external-egress.test.ts) (approx. 300+ lines). The test invokes each route's `POST`/`GET`/etc. handler directly and asserts `recorded === []` at the end. New routes slot into the single big `it("exercising every non-generate route...")` block.

- [ ] **Step 2: Write the failing additions**

In the main `it("exercising every non-generate route records zero fetches", ...)` block, just before the final `expect(recorded).toEqual([]);`, add two new route exercises. Locate a convenient spot (e.g., after the DELETE /api/stories/[slug] block) and insert:

```ts
    // ── POST /api/import/novelai/parse ─────────────────────────────────────
    {
      const { POST } = await import("@/app/api/import/novelai/parse/route");
      const fixture = await readFile(
        join(__dirname, "..", "..", "lib", "novelai", "__fixtures__", "sample.story")
      );
      const fd = new FormData();
      fd.append(
        "file",
        new Blob([fixture], { type: "application/octet-stream" }),
        "sample.story"
      );
      const req = new Request("http://localhost/api/import/novelai/parse", {
        method: "POST",
        body: fd,
      }) as unknown as NextRequest;
      const res = await POST(req);
      expect(res.status).toBe(200);
    }

    // ── POST /api/import/novelai/commit (new-story) ────────────────────────
    {
      const { POST } = await import("@/app/api/import/novelai/commit/route");
      const req = makeReq("http://localhost/api/import/novelai/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target: "new-story",
          story: {
            title: "Egress Guard Story",
            description: "",
            keywords: [],
          },
          bible: {
            characters: [],
            setting: "",
            pov: "third-limited",
            tone: "",
            styleNotes: "",
            nsfwPreferences: "",
          },
          chapters: [{ title: "C", body: "body" }],
        }),
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
    }

    // ── POST /api/import/novelai/commit (existing-story) ───────────────────
    {
      const { POST } = await import("@/app/api/import/novelai/commit/route");
      const req = makeReq("http://localhost/api/import/novelai/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target: "existing-story",
          slug,
          chapters: [{ title: "Via Egress Test", body: "x" }],
        }),
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
    }
```

If `readFile` isn't already imported at the top of the file, add it to the `node:fs/promises` import. Likewise `__dirname` — if the file uses ES modules and `__dirname` isn't available, substitute `new URL(".", import.meta.url).pathname` or read via `require.resolve` patterns used elsewhere in the file.

Also add, at the top-level ROUTES EXERCISED block comment (the commented list of routes tested), three new lines:

```
 *   POST /api/import/novelai/parse
 *   POST /api/import/novelai/commit  (new-story)
 *   POST /api/import/novelai/commit  (existing-story, reuses seeded slug)
```

- [ ] **Step 3: Run the privacy test**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/privacy/no-external-egress.test.ts
```

Expected: PASS. `recorded` stays empty because no new route fetches anything outbound.

- [ ] **Step 4: Run the full test suite to make sure nothing else regressed**

Run:
```bash
cd /home/chase/projects/scriptr && npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd /home/chase/projects/scriptr && git add tests/privacy/no-external-egress.test.ts && git commit -m "test(privacy): exercise NovelAI parse + commit routes (zero egress)"
```

---

**End of Chunk 2.** We now have:
- `POST /api/import/novelai/parse` — multipart in, preview JSON out, full error coverage.
- `POST /api/import/novelai/commit` — both new-story and existing-story modes, with rollback on new-story failure.
- Both routes exercised in the privacy egress test with `recorded === []` confirmed.

---

## Chunk 3: UI dialogs + entry points + e2e

Two dialogs, two entry points, one end-to-end Playwright test. All dialog state is local (useState); no Zustand.

### Task 3.1: Shared chapter-list subcomponent

Both dialogs render a list of editable chapters. Extract that into a small component so both dialogs share it.

**Files:**
- Create: `/home/chase/projects/scriptr/components/import/ChapterEditList.tsx`
- Create: `/home/chase/projects/scriptr/tests/components/import/ChapterEditList.test.tsx`

- [ ] **Step 1: Write the failing test**

Write to `/home/chase/projects/scriptr/tests/components/import/ChapterEditList.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChapterEditList } from "@/components/import/ChapterEditList";

const initial = [
  { title: "One", body: "body one" },
  { title: "Two", body: "body two" },
  { title: "", body: "body three" },
];

describe("ChapterEditList", () => {
  it("renders one row per chapter with editable title", () => {
    render(
      <ChapterEditList chapters={initial} splitSource="marker" onChange={() => {}} />
    );
    expect(screen.getAllByRole("textbox").filter((n) => n.tagName === "INPUT")).toHaveLength(3);
    expect(screen.getByDisplayValue("One")).toBeTruthy();
    expect(screen.getByDisplayValue("Two")).toBeTruthy();
  });

  it("calls onChange when a title is edited", () => {
    const onChange = vi.fn();
    render(
      <ChapterEditList chapters={initial} splitSource="marker" onChange={onChange} />
    );
    const input = screen.getByDisplayValue("One") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "One Updated" } });
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(last[0].title).toBe("One Updated");
  });

  it("removes a chapter when delete is clicked", () => {
    const onChange = vi.fn();
    render(
      <ChapterEditList chapters={initial} splitSource="marker" onChange={onChange} />
    );
    const buttons = screen.getAllByRole("button", { name: /delete/i });
    fireEvent.click(buttons[1]);
    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(last).toHaveLength(2);
    expect(last.map((c: { title: string }) => c.title)).toEqual(["One", ""]);
  });

  it("merges a chapter into the next when 'merge with next' is clicked", () => {
    const onChange = vi.fn();
    render(
      <ChapterEditList chapters={initial} splitSource="marker" onChange={onChange} />
    );
    const mergeButtons = screen.getAllByRole("button", { name: /merge with next/i });
    // Row 0's "merge with next" should combine rows 0+1.
    fireEvent.click(mergeButtons[0]);
    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(last).toHaveLength(2);
    expect(last[0].title).toBe("One");
    expect(last[0].body).toBe("body one\n\nbody two");
  });

  it("shows the split-source badge", () => {
    render(
      <ChapterEditList chapters={initial} splitSource="scenebreak-fallback" onChange={() => {}} />
    );
    expect(screen.getByText(/scene breaks/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/components/import/ChapterEditList.test.tsx
```

Expected: FAIL — component module not found.

- [ ] **Step 3: Implement the component**

Write to `/home/chase/projects/scriptr/components/import/ChapterEditList.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Trash2, ArrowDownToLine } from "lucide-react";
import type { ProposedChapter, SplitSource } from "@/lib/novelai/types";

type Props = {
  chapters: ProposedChapter[];
  splitSource: SplitSource;
  onChange: (next: ProposedChapter[]) => void;
};

const SPLIT_LABEL: Record<SplitSource, string> = {
  marker: "Split by //// markers",
  heading: "Split by chapter headings",
  "scenebreak-fallback": "Split by scene breaks (verify)",
  none: "Single chapter",
};

function wordCount(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

export function ChapterEditList({ chapters, splitSource, onChange }: Props) {
  function updateAt(i: number, patch: Partial<ProposedChapter>) {
    onChange(chapters.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
  function deleteAt(i: number) {
    onChange(chapters.filter((_, idx) => idx !== i));
  }
  function mergeWithNext(i: number) {
    if (i >= chapters.length - 1) return;
    const merged: ProposedChapter = {
      title: chapters[i].title,
      body: `${chapters[i].body}\n\n${chapters[i + 1].body}`.trim(),
    };
    const next: ProposedChapter[] = [
      ...chapters.slice(0, i),
      merged,
      ...chapters.slice(i + 2),
    ];
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs uppercase text-muted-foreground">
        {SPLIT_LABEL[splitSource]} · {chapters.length} chapter
        {chapters.length === 1 ? "" : "s"}
      </div>
      {chapters.map((ch, i) => (
        <div
          key={i}
          className="border border-border rounded p-3 flex flex-col gap-2"
        >
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground tabular-nums w-8">
              {String(i + 1).padStart(2, "0")}
            </span>
            <Input
              value={ch.title}
              onChange={(e) => updateAt(i, { title: e.target.value })}
              placeholder="Untitled"
              className="flex-1 text-sm"
            />
            <span className="text-xs text-muted-foreground tabular-nums">
              {wordCount(ch.body).toLocaleString()} words
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Merge with next"
              title="Merge with next chapter"
              onClick={() => mergeWithNext(i)}
              disabled={i >= chapters.length - 1}
            >
              <ArrowDownToLine className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Delete chapter ${i + 1}`}
              onClick={() => deleteAt(i)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
          <Textarea
            value={ch.body}
            onChange={(e) => updateAt(i, { body: e.target.value })}
            className="font-mono text-xs min-h-[120px]"
          />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/components/import/ChapterEditList.test.tsx
```

Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
cd /home/chase/projects/scriptr && git add components/import/ChapterEditList.tsx tests/components/import/ChapterEditList.test.tsx && git commit -m "feat(import): shared ChapterEditList component for NovelAI dialogs"
```

---

### Task 3.2: NewStoryFromNovelAIDialog

**Files:**
- Create: `/home/chase/projects/scriptr/components/import/NewStoryFromNovelAIDialog.tsx`
- Create: `/home/chase/projects/scriptr/tests/components/import/NewStoryFromNovelAIDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

Write to `/home/chase/projects/scriptr/tests/components/import/NewStoryFromNovelAIDialog.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NewStoryFromNovelAIDialog } from "@/components/import/NewStoryFromNovelAIDialog";

// Stub sonner toast
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Stub next/navigation router
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

function fakeParsedResponse() {
  return {
    ok: true,
    data: {
      parsed: {
        title: "Garden at Dusk",
        description: "a desc",
        tags: ["a", "b"],
        textPreview: "",
        contextBlocks: [],
        lorebookEntries: [],
        prose: "body one\n\n////\n\nbody two",
      },
      split: {
        chapters: [
          { title: "One", body: "body one" },
          { title: "Two", body: "body two" },
        ],
        splitSource: "marker",
      },
      proposed: {
        story: {
          title: "Garden at Dusk",
          description: "a desc",
          keywords: ["a", "b"],
        },
        bible: {
          characters: [{ name: "Mira", description: "a gardener" }],
          setting: "## Walled Garden\nold stones",
          pov: "third-limited",
          tone: "",
          styleNotes: "",
          nsfwPreferences: "",
        },
      },
    },
  };
}

describe("NewStoryFromNovelAIDialog", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = global.fetch;
    push.mockReset();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("shows the file picker on open", () => {
    render(<NewStoryFromNovelAIDialog open onOpenChange={() => {}} />);
    expect(screen.getByText(/import from novelai/i)).toBeTruthy();
    // file input is present
    expect(document.querySelector('input[type="file"]')).toBeTruthy();
  });

  it("parses the file and renders the preview on upload", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(fakeParsedResponse()), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    ) as unknown as typeof fetch;

    render(<NewStoryFromNovelAIDialog open onOpenChange={() => {}} />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], "x.story", {
      type: "application/octet-stream",
    });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByDisplayValue("Garden at Dusk")).toBeTruthy();
    });
    expect(screen.getByText(/Mira/)).toBeTruthy();
    expect(screen.getByText(/## Walled Garden/)).toBeTruthy();
    expect(screen.getAllByDisplayValue(/body (one|two)/)).toHaveLength(2);
  });

  it("commits and navigates on 'Create story'", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(fakeParsedResponse()), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, data: { slug: "garden-at-dusk", chapterIds: ["a", "b"] } }),
          { status: 200 }
        )
      ) as unknown as typeof fetch;

    render(<NewStoryFromNovelAIDialog open onOpenChange={() => {}} />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File([new Uint8Array([1, 2, 3])], "x.story")] },
    });
    await waitFor(() => screen.getByDisplayValue("Garden at Dusk"));

    fireEvent.click(screen.getByRole("button", { name: /create story/i }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/s/garden-at-dusk");
    });
  });

  it("shows the parse error and a 'Choose a different file' button on parse failure", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ ok: false, error: "Unsupported NovelAI format version: got 99, expected 1." }),
        { status: 400 }
      )
    ) as unknown as typeof fetch;

    render(<NewStoryFromNovelAIDialog open onOpenChange={() => {}} />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File([new Uint8Array([1])], "bad.story")] },
    });

    await waitFor(() => {
      expect(screen.getByText(/Unsupported NovelAI format version/)).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: /choose a different file/i })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/components/import/NewStoryFromNovelAIDialog.test.tsx
```

Expected: FAIL — component module not found.

- [ ] **Step 3: Implement the dialog**

Write to `/home/chase/projects/scriptr/components/import/NewStoryFromNovelAIDialog.tsx`:

```tsx
"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ChapterEditList } from "@/components/import/ChapterEditList";
import type { ParsedStory, ProposedChapter, ProposedWrite, SplitResult } from "@/lib/novelai/types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type ParseOk = {
  ok: true;
  data: {
    parsed: ParsedStory;
    split: SplitResult;
    proposed: ProposedWrite;
  };
};
type ParseErr = { ok: false; error: string };

type Stage =
  | { kind: "idle" }
  | { kind: "parsing" }
  | { kind: "error"; message: string }
  | { kind: "preview"; data: ParseOk["data"] };

export function NewStoryFromNovelAIDialog({ open, onOpenChange }: Props) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [keywords, setKeywords] = useState("");
  const [chapters, setChapters] = useState<ProposedChapter[]>([]);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  const reset = useCallback(() => {
    setStage({ kind: "idle" });
    setTitle("");
    setDescription("");
    setKeywords("");
    setChapters([]);
  }, []);

  const onFile = useCallback(async (f: File) => {
    setStage({ kind: "parsing" });
    const fd = new FormData();
    fd.append("file", f);
    try {
      const res = await fetch("/api/import/novelai/parse", {
        method: "POST",
        body: fd,
      });
      const body = (await res.json()) as ParseOk | ParseErr;
      if (!body.ok) {
        setStage({ kind: "error", message: body.error });
        return;
      }
      setStage({ kind: "preview", data: body.data });
      setTitle(body.data.proposed.story.title);
      setDescription(body.data.proposed.story.description);
      setKeywords(body.data.proposed.story.keywords.join(", "));
      setChapters(body.data.split.chapters);
    } catch (err) {
      setStage({
        kind: "error",
        message: err instanceof Error ? err.message : "Import failed — try again.",
      });
    }
  }, []);

  const onCommit = useCallback(async () => {
    if (stage.kind !== "preview") return;
    setSaving(true);
    try {
      const res = await fetch("/api/import/novelai/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target: "new-story",
          story: {
            title: title.trim() || stage.data.proposed.story.title,
            description,
            keywords: keywords
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          },
          bible: stage.data.proposed.bible,
          chapters,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        toast.error(body.error ?? `Import failed (${res.status})`);
        return;
      }
      toast.success(`Created "${title}" (${chapters.length} chapters).`);
      onOpenChange(false);
      reset();
      router.push(`/s/${body.data.slug}`);
    } finally {
      setSaving(false);
    }
  }, [stage, title, description, keywords, chapters, router, onOpenChange, reset]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-stretch justify-center">
      <div className="bg-background border border-border rounded w-full max-w-[1400px] m-4 flex flex-col">
        <div className="border-b border-border px-4 py-2 text-sm font-semibold">
          Import from NovelAI
        </div>

        {stage.kind === "idle" && (
          <div className="p-8 flex-1 flex flex-col items-center justify-center gap-3">
            <p className="text-sm text-muted-foreground">
              Choose a NovelAI <code>.story</code> file to import.
            </p>
            <input
              type="file"
              accept=".story,application/json"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
              data-testid="novelai-file-input"
            />
          </div>
        )}

        {stage.kind === "parsing" && (
          <div className="p-8 flex-1 flex items-center justify-center text-sm text-muted-foreground">
            Parsing…
          </div>
        )}

        {stage.kind === "error" && (
          <div className="p-8 flex-1 flex flex-col items-center justify-center gap-3">
            <p className="text-sm text-destructive">{stage.message}</p>
            <Button type="button" variant="outline" onClick={reset}>
              Choose a different file
            </Button>
          </div>
        )}

        {stage.kind === "preview" && (
          <div className="grid grid-cols-[320px_1fr_320px] flex-1 min-h-0">
            <div className="p-4 border-r border-border flex flex-col gap-3">
              <div>
                <div className="text-xs uppercase text-muted-foreground mb-1">Title</div>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground mb-1">Description</div>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="min-h-[100px] text-sm"
                />
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground mb-1">
                  Keywords (comma-separated)
                </div>
                <Input value={keywords} onChange={(e) => setKeywords(e.target.value)} />
              </div>
            </div>

            <div className="p-4 overflow-auto">
              <ChapterEditList
                chapters={chapters}
                splitSource={stage.data.split.splitSource}
                onChange={setChapters}
              />
            </div>

            <div className="p-4 border-l border-border overflow-auto flex flex-col gap-3">
              <div className="text-xs uppercase text-muted-foreground">Proposed Bible</div>
              <div>
                <div className="text-xs font-semibold mb-1">Characters</div>
                {stage.data.proposed.bible.characters.length === 0 ? (
                  <div className="text-xs text-muted-foreground italic">None</div>
                ) : (
                  <ul className="text-xs flex flex-col gap-1">
                    {stage.data.proposed.bible.characters.map((c, i) => (
                      <li key={i}>
                        <strong>{c.name}</strong>: {c.description.slice(0, 80)}
                        {c.description.length > 80 ? "…" : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <div className="text-xs font-semibold mb-1">Setting</div>
                <pre className="text-xs text-muted-foreground whitespace-pre-wrap">
                  {stage.data.proposed.bible.setting || "(empty)"}
                </pre>
              </div>
              <div>
                <div className="text-xs font-semibold mb-1">Style notes</div>
                <pre className="text-xs text-muted-foreground whitespace-pre-wrap">
                  {stage.data.proposed.bible.styleNotes || "(empty)"}
                </pre>
              </div>
              <p className="text-xs text-muted-foreground italic">
                Edit these in the Bible editor after import.
              </p>
            </div>
          </div>
        )}

        <div className="border-t border-border px-4 py-3 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              reset();
            }}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onCommit}
            disabled={saving || stage.kind !== "preview" || chapters.length === 0}
          >
            {saving ? "Creating…" : "Create story"}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/components/import/NewStoryFromNovelAIDialog.test.tsx
```

Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
cd /home/chase/projects/scriptr && git add components/import/NewStoryFromNovelAIDialog.tsx tests/components/import/NewStoryFromNovelAIDialog.test.tsx && git commit -m "feat(import): NewStoryFromNovelAIDialog — parse, preview, create"
```

---

### Task 3.3: Wire the new-story dialog into LibraryList

**Files:**
- Modify: `/home/chase/projects/scriptr/components/library/LibraryList.tsx`

- [ ] **Step 1: Add the import and button**

Open [components/library/LibraryList.tsx](../../../components/library/LibraryList.tsx). Near the other component imports at the top, add:

```ts
import { NewStoryFromNovelAIDialog } from "@/components/import/NewStoryFromNovelAIDialog";
```

Near `setNewStoryOpen`, add a second `useState` for the NovelAI dialog:

```ts
const [novelaiOpen, setNovelaiOpen] = useState(false);
```

Immediately after the existing `<Button onClick={() => setNewStoryOpen(true)}>New story</Button>` on **both** occurrences (around lines 184 and 193-195 per the grep output from the exploratory step), add a sibling button:

```tsx
<Button variant="outline" onClick={() => setNovelaiOpen(true)}>
  Import from NovelAI
</Button>
```

At the bottom of the component, near the existing `{/* New story dialog */}` block, add:

```tsx
<NewStoryFromNovelAIDialog open={novelaiOpen} onOpenChange={setNovelaiOpen} />
```

- [ ] **Step 2: Typecheck + lint**

Run:
```bash
cd /home/chase/projects/scriptr && npm run typecheck && npm run lint
```

Expected: both exit 0.

- [ ] **Step 3: Run the full test suite**

Run:
```bash
cd /home/chase/projects/scriptr && npm test
```

Expected: PASS.

- [ ] **Step 4: Manual smoke check (dev server)**

Run `npm run dev` in a separate terminal, navigate to `http://127.0.0.1:3000/`, click "Import from NovelAI", confirm the dialog renders. Close it with Cancel. Stop the dev server. (This is a fast visual sanity check — the e2e test in Task 3.6 automates it.)

- [ ] **Step 5: Commit**

```bash
cd /home/chase/projects/scriptr && git add components/library/LibraryList.tsx && git commit -m "feat(import): wire Import-from-NovelAI button into LibraryList"
```

---

### Task 3.4: AddChaptersFromNovelAIDialog

**Files:**
- Create: `/home/chase/projects/scriptr/components/import/AddChaptersFromNovelAIDialog.tsx`
- Create: `/home/chase/projects/scriptr/tests/components/import/AddChaptersFromNovelAIDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

Write to `/home/chase/projects/scriptr/tests/components/import/AddChaptersFromNovelAIDialog.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AddChaptersFromNovelAIDialog } from "@/components/import/AddChaptersFromNovelAIDialog";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function fakeParseResp() {
  return {
    ok: true,
    data: {
      parsed: {
        title: "Ignored Title",
        description: "",
        tags: ["ignored"],
        textPreview: "",
        contextBlocks: [],
        lorebookEntries: [],
        prose: "a\n\n////\n\nb",
      },
      split: {
        chapters: [
          { title: "A", body: "a" },
          { title: "B", body: "b" },
        ],
        splitSource: "marker",
      },
      proposed: {
        story: { title: "Ignored Title", description: "", keywords: ["ignored"] },
        bible: {
          characters: [],
          setting: "",
          pov: "third-limited",
          tone: "",
          styleNotes: "",
          nsfwPreferences: "",
        },
      },
    },
  };
}

describe("AddChaptersFromNovelAIDialog", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = global.fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("shows the discarded-data banner in the preview", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(fakeParseResp()), { status: 200 })
    ) as unknown as typeof fetch;

    const onImported = vi.fn();
    render(
      <AddChaptersFromNovelAIDialog
        slug="host-story"
        open
        onOpenChange={() => {}}
        onImported={onImported}
      />
    );
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File([new Uint8Array([1])], "x.story")] },
    });

    await waitFor(() => {
      expect(screen.getByText(/ignored in this mode/i)).toBeTruthy();
    });
  });

  it("commits with target='existing-story' and no bible/story fields", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(fakeParseResp()), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, data: { slug: "host-story", chapterIds: ["x", "y"] } }),
          { status: 200 }
        )
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    const onImported = vi.fn();
    render(
      <AddChaptersFromNovelAIDialog
        slug="host-story"
        open
        onOpenChange={() => {}}
        onImported={onImported}
      />
    );
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File([new Uint8Array([1])], "x.story")] },
    });
    await waitFor(() => screen.getByText(/ignored in this mode/i));

    fireEvent.click(screen.getByRole("button", { name: /add 2 chapter/i }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => String(c[0]).endsWith("/commit")
      );
      expect(call).toBeTruthy();
      const payload = JSON.parse(call![1].body as string);
      expect(payload.target).toBe("existing-story");
      expect(payload.slug).toBe("host-story");
      expect(payload).not.toHaveProperty("bible");
      expect(payload).not.toHaveProperty("story");
      expect(payload.chapters).toHaveLength(2);
    });
    expect(onImported).toHaveBeenCalledWith(["x", "y"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/components/import/AddChaptersFromNovelAIDialog.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the dialog**

Write to `/home/chase/projects/scriptr/components/import/AddChaptersFromNovelAIDialog.tsx`:

```tsx
"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ChapterEditList } from "@/components/import/ChapterEditList";
import type { ParsedStory, ProposedChapter, SplitResult } from "@/lib/novelai/types";

type Props = {
  slug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (chapterIds: string[]) => void;
};

type ParseOk = {
  ok: true;
  data: {
    parsed: ParsedStory;
    split: SplitResult;
    proposed: unknown; // not used in this mode
  };
};
type ParseErr = { ok: false; error: string };

type Stage =
  | { kind: "idle" }
  | { kind: "parsing" }
  | { kind: "error"; message: string }
  | { kind: "preview"; split: SplitResult };

export function AddChaptersFromNovelAIDialog({
  slug,
  open,
  onOpenChange,
  onImported,
}: Props) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [chapters, setChapters] = useState<ProposedChapter[]>([]);
  const [saving, setSaving] = useState(false);

  const reset = useCallback(() => {
    setStage({ kind: "idle" });
    setChapters([]);
  }, []);

  const onFile = useCallback(async (f: File) => {
    setStage({ kind: "parsing" });
    const fd = new FormData();
    fd.append("file", f);
    try {
      const res = await fetch("/api/import/novelai/parse", {
        method: "POST",
        body: fd,
      });
      const body = (await res.json()) as ParseOk | ParseErr;
      if (!body.ok) {
        setStage({ kind: "error", message: body.error });
        return;
      }
      setStage({ kind: "preview", split: body.data.split });
      setChapters(body.data.split.chapters);
    } catch (err) {
      setStage({
        kind: "error",
        message: err instanceof Error ? err.message : "Import failed — try again.",
      });
    }
  }, []);

  const onCommit = useCallback(async () => {
    if (stage.kind !== "preview") return;
    setSaving(true);
    try {
      const res = await fetch("/api/import/novelai/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target: "existing-story",
          slug,
          chapters,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        toast.error(body.error ?? `Import failed (${res.status})`);
        return;
      }
      toast.success(`Added ${chapters.length} chapter${chapters.length === 1 ? "" : "s"}.`);
      onImported(body.data.chapterIds);
      onOpenChange(false);
      reset();
    } finally {
      setSaving(false);
    }
  }, [stage, slug, chapters, onImported, onOpenChange, reset]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-stretch justify-center">
      <div className="bg-background border border-border rounded w-full max-w-[1100px] m-4 flex flex-col">
        <div className="border-b border-border px-4 py-2 text-sm font-semibold">
          Import chapters from .story
        </div>

        {stage.kind === "idle" && (
          <div className="p-8 flex-1 flex flex-col items-center justify-center gap-3">
            <p className="text-sm text-muted-foreground">
              Choose a NovelAI <code>.story</code> file to append as chapters.
            </p>
            <input
              type="file"
              accept=".story,application/json"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
              data-testid="novelai-file-input"
            />
          </div>
        )}

        {stage.kind === "parsing" && (
          <div className="p-8 flex-1 flex items-center justify-center text-sm text-muted-foreground">
            Parsing…
          </div>
        )}

        {stage.kind === "error" && (
          <div className="p-8 flex-1 flex flex-col items-center justify-center gap-3">
            <p className="text-sm text-destructive">{stage.message}</p>
            <Button type="button" variant="outline" onClick={reset}>
              Choose a different file
            </Button>
          </div>
        )}

        {stage.kind === "preview" && (
          <div className="p-4 flex-1 flex flex-col gap-3 overflow-auto">
            <div className="border border-border rounded bg-muted/30 p-2 text-xs text-muted-foreground">
              Description, lorebook, and tags from this .story file are ignored in this mode.
              Use <em>Import from NovelAI</em> on the home page to import everything.
            </div>
            <ChapterEditList
              chapters={chapters}
              splitSource={stage.split.splitSource}
              onChange={setChapters}
            />
          </div>
        )}

        <div className="border-t border-border px-4 py-3 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              reset();
            }}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onCommit}
            disabled={saving || stage.kind !== "preview" || chapters.length === 0}
          >
            {saving
              ? "Adding…"
              : `Add ${chapters.length} chapter${chapters.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /home/chase/projects/scriptr && npx vitest run tests/components/import/AddChaptersFromNovelAIDialog.test.tsx
```

Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
cd /home/chase/projects/scriptr && git add components/import/AddChaptersFromNovelAIDialog.tsx tests/components/import/AddChaptersFromNovelAIDialog.test.tsx && git commit -m "feat(import): AddChaptersFromNovelAIDialog for existing stories"
```

---

### Task 3.5: Wire the add-chapters dialog into ChapterList

**Files:**
- Modify: `/home/chase/projects/scriptr/components/editor/ChapterList.tsx`

- [ ] **Step 1: Add import + second button**

Open [components/editor/ChapterList.tsx](../../../components/editor/ChapterList.tsx). Near the existing import for `ImportChapterDialog` (around line 34), add:

```ts
import { AddChaptersFromNovelAIDialog } from "@/components/import/AddChaptersFromNovelAIDialog";
```

Near the existing `const [importOpen, setImportOpen] = useState(false);`, add a sibling:

```ts
const [novelaiOpen, setNovelaiOpen] = useState(false);
```

Inside the `{/* Import chapter button */}` block (around lines 282-294), add a second button below the existing one:

```tsx
<Button
  type="button"
  variant="ghost"
  size="sm"
  onClick={() => setNovelaiOpen(true)}
  className="w-full justify-start gap-1.5 text-xs text-muted-foreground hover:text-foreground"
>
  <Upload className="size-3.5" />
  Import chapters from .story
</Button>
```

And near the existing `<ImportChapterDialog ... />` JSX (around line 296), add a sibling:

```tsx
<AddChaptersFromNovelAIDialog
  slug={slug}
  open={novelaiOpen}
  onOpenChange={setNovelaiOpen}
  onImported={() => {
    void mutate();
  }}
/>
```

- [ ] **Step 2: Typecheck + lint + test**

Run:
```bash
cd /home/chase/projects/scriptr && npm run typecheck && npm run lint && npm test
```

Expected: all green.

- [ ] **Step 3: Commit**

```bash
cd /home/chase/projects/scriptr && git add components/editor/ChapterList.tsx && git commit -m "feat(import): wire AddChapters-from-NovelAI into editor ChapterList"
```

---

### Task 3.6: E2E happy-path Playwright test

**Files:**
- Create: `/home/chase/projects/scriptr/tests/e2e/novelai-import.spec.ts`

- [ ] **Step 1: Write the test**

Write to `/home/chase/projects/scriptr/tests/e2e/novelai-import.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { join } from "node:path";

const FIXTURE = join(
  __dirname,
  "..",
  "..",
  "lib",
  "novelai",
  "__fixtures__",
  "sample.story"
);

test("imports a .story file wholesale into a new story", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /import from novelai/i }).first().click();

  // Set the file on the hidden file input.
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(FIXTURE);

  // Preview renders; title prefilled from the fixture.
  await expect(page.getByDisplayValue("Garden at Dusk")).toBeVisible();

  // At least 2 chapters from the //// split.
  const chapterRows = page.locator("text=/01\\s|02\\s|0[1-9]/i");
  await expect(chapterRows.first()).toBeVisible();

  await page.getByRole("button", { name: /create story/i }).click();

  // Navigated to the story editor page.
  await expect(page).toHaveURL(/\/s\/garden-at-dusk/);
});
```

- [ ] **Step 2: Run the e2e test**

Run:
```bash
cd /home/chase/projects/scriptr && npm run e2e -- tests/e2e/novelai-import.spec.ts
```

Expected: PASS. Playwright spins its own dev server on port 3001 using `SCRIPTR_DATA_DIR=/tmp/scriptr-e2e` per [playwright.config.ts](../../../playwright.config.ts), so this test does not touch real user data.

- [ ] **Step 3: Commit**

```bash
cd /home/chase/projects/scriptr && git add tests/e2e/novelai-import.spec.ts && git commit -m "test(e2e): wholesale NovelAI import creates new story"
```

---

### Task 3.7: Final green-pass + docs

**Files:** none new; verification only.

- [ ] **Step 1: Run everything**

Run:
```bash
cd /home/chase/projects/scriptr && npm run lint && npm run typecheck && npm test && npm run e2e
```

Expected: all four exit 0 with zero failures.

- [ ] **Step 2: Smoke-test in the browser once more**

Start `npm run dev`, navigate to `http://127.0.0.1:3000/`. Import the fixture `.story`, verify the new story renders with chapters. Open an existing story, click "Import chapters from .story", import the same fixture, verify chapters are appended. Stop the dev server.

- [ ] **Step 3: Final commit if anything needs cleanup**

If the green-pass revealed any straggler issues (stale imports, lint warnings, etc.), fix and commit. If clean, there's nothing to commit.

---

**End of Chunk 3 — feature complete.**

At this point:
- User can click "Import from NovelAI" on the stories list, pick a `.story` file, and produce a new story with description/keywords/Bible/chapters auto-populated.
- User can click "Import chapters from .story" inside an existing story to append chapters from a different NovelAI session.
- The `////` marker works in both flows and in the existing paste-based `ImportChapterDialog`.
- Both new routes are exercised by the privacy egress test and provably don't fetch anything outbound.
- The synthetic fixture lets unit, API, component, and e2e tests run without depending on any real NovelAI export.
- All tests (unit, API, component, privacy, e2e) pass on a clean checkout.

