# EPUB Import Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new-story importer that ingests `.epub` files (Scriptr-exported, KDP, Smashwords) into a Scriptr story — title, description, keywords, cover, pen-name, chapters — with a per-chapter include/exclude UI.

**Architecture:** Server-side EPUB parser in `lib/epub/` (`jszip` + `fast-xml-parser` + `cheerio`, mirroring the structure of `lib/novelai/`). Two API routes at `/api/import/epub/{parse,commit}` mirror the NovelAI importer's parse-then-commit flow. A new `NewStoryFromEpubDialog` component is wired into the stories list page. Empty Bible defaults are written; full Bible derivation is out of scope. Privacy: routes are local-only and added to the no-egress test allowlist.

**Tech Stack:** Next.js 16 (App Router, route handlers), TypeScript, Vitest (node + jsdom envs), Playwright e2e. New runtime deps: `jszip`, `fast-xml-parser`, `cheerio`. Reuses existing helpers: `htmlToMarkdown`, `createStory`/`updateStory`/`deleteStory`/`createImportedChapter`, `saveBible`/`validateBible`, `writeCoverJpeg`, `PenNamePicker`, `effectiveDataDir`/`getConfig`.

**Spec:** [docs/superpowers/specs/2026-04-30-epub-import-design.md](../specs/2026-04-30-epub-import-design.md)

---

## Pre-flight (read before executing)

- This work should run in a dedicated git worktree (e.g. `.worktrees/epub-import`), not on `main`. See AGENTS.md "Subagent cwd discipline" if dispatching implementers.
- Read `node_modules/next/dist/docs/` for the *current* App Router route-handler API before touching `app/api/import/epub/*`. The Next.js version in this repo (16) has divergences from training data per AGENTS.md.
- Privacy is non-negotiable: any new route MUST be exercised in [tests/privacy/no-external-egress.test.ts](../../../tests/privacy/no-external-egress.test.ts) before the PR can land.
- All disk writes go through helpers in [lib/storage/](../../../lib/storage/) and [lib/publish/epub-storage.ts](../../../lib/publish/epub-storage.ts) — no hand-rolled paths.

## File structure (locked)

**`lib/epub/`** — server-only parsing module, parallel to `lib/novelai/`:
- `types.ts` — type definitions only, no logic
- `unzip.ts` — JSZip wrapper: build `Map<path, JSZipObject>`, read bytes by path
- `opf.ts` — locate + parse content.opf (metadata, manifest, spine, cover lookup)
- `nav.ts` — parse EPUB3 nav.xhtml or EPUB2 toc.ncx → flat `NavEntry[]`
- `walk.ts` — nav-first chapter walker, anchor-aware, with spine fallback
- `boilerplate.ts` — denylist regex + `applyBoilerplateFlags()`
- `cover.ts` — extract cover bytes from manifest + magic-byte mime sniff
- `cover-cache.ts` — in-memory `Map<sessionId, {bytes, mimeType, expiresAt}>` with 10-min TTL
- `map.ts` — `ParsedEpub` → `ProposedWrite` (story + empty Bible + pen-name match)
- `parse.ts` — top-level orchestrator: size cap → DRM check → unzip → opf → nav → walk → boilerplate → cover. Returns `ParsedEpub` or throws `EpubParseError`.

**`scripts/`:**
- `build-epub-fixtures.ts` — generates 3 synthetic EPUBs into `lib/epub/__fixtures__/` at test-fixture-build time.

**`app/api/import/epub/`:**
- `parse/route.ts` — multipart upload → preview JSON
- `commit/route.ts` — JSON body → write story to disk

**`components/import/`:**
- `NewStoryFromEpubDialog.tsx` — file picker → preview → commit. Local sub-components `EpubChapterRow` and `EpubMetadataPanel` live in the same file unless either grows past ~80 lines.

**Modified:**
- [tests/privacy/no-external-egress.test.ts](../../../tests/privacy/no-external-egress.test.ts) — exercise both new routes
- [app/page.tsx](../../../app/page.tsx) — add "Import from EPUB" button next to existing import buttons
- `package.json` — add deps + pretest hook

---

## Chunk 1: Foundations (deps, types, fixture builder)

This chunk gets the build green with all dependencies installed, the type vocabulary defined, and a working fixture-builder script that produces three synthetic EPUBs the rest of the plan exercises.

### Task 1.1: Install runtime dependencies

**Files:**
- Modify: `package.json`

**Baseline note:** `jszip` is currently a `devDependency` (used by tests). It will be promoted to `dependencies` because EPUB import makes it runtime code. `cheerio`, `fast-xml-parser`, and `tsx` are not yet installed.

- [ ] **Step 1: Snapshot `jsdom` baseline**

Run: `npm ls jsdom > /tmp/jsdom-baseline.txt 2>&1; cat /tmp/jsdom-baseline.txt`

Expected: shows current jsdom locations (likely a top-level devDep + transitive pulls from existing test deps). This is the "before" picture.

- [ ] **Step 2: Install jszip, fast-xml-parser, cheerio as runtime deps; tsx as dev dep**

Run: `npm install --save jszip fast-xml-parser cheerio && npm install --save-dev tsx`

Expected: `package.json` `dependencies` gains `jszip`, `fast-xml-parser`, `cheerio`. `devDependencies` gains `tsx`. `jszip` is removed from `devDependencies` (npm 7+ dedupe). `package-lock.json` updates.

- [ ] **Step 3: Verify no NEW jsdom transitive pull**

Run: `npm ls jsdom > /tmp/jsdom-after.txt 2>&1; diff /tmp/jsdom-baseline.txt /tmp/jsdom-after.txt`

Expected: empty diff (or a diff that doesn't introduce jsdom under `jszip`, `fast-xml-parser`, or `cheerio`). If a new path through any of those three appears, halt and revisit dep choice — see [memory: jsdom ESM chain breaks packaged Electron](../../../../.claude/projects/-home-chase-projects-scriptr/memory/feedback_jsdom_esm_chain_in_electron.md).

- [ ] **Step 4: Verify lint + typecheck still green**

Run: `npm run lint && npm run typecheck`

Expected: both pass. No new warnings about untyped imports (cheerio and fast-xml-parser ship their own types).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add jszip/cheerio/fast-xml-parser for EPUB import; promote jszip to runtime"
```

### Task 1.2: Define `lib/epub/types.ts`

The type-only module the rest of the implementation imports from. Pure declarations, no runtime code.

**Files:**
- Create: `lib/epub/types.ts`
- Test: none (pure types — verified by tsc compiling consumers)

- [ ] **Step 1: Create the types file**

Create `lib/epub/types.ts`:

```ts
import type { Bible } from "@/lib/types";

/**
 * Output of parseEpub(): everything we extracted from a .epub file before any
 * transformation into Scriptr shapes.
 */
export type ParsedEpub = {
  metadata: {
    title: string;
    creator: string;
    description: string;
    subjects: string[];
    language: string;
  };
  cover: { mimeType: string; bytes: Uint8Array } | null;
  chapters: ChapterDraft[];
  epubVersion: 2 | 3;
};

/**
 * One chapter as walked from the nav (or spine fallback). Body is markdown
 * (output of htmlToMarkdown). Carries the boilerplate-denylist verdict so
 * the UI can default-skip without the server filtering them out.
 *
 * NOTE: `source` is a plan-level addition not in the spec's ChapterDraft.
 * It backs the UI's `nav`/`spine` badge requirement (spec UI section). The
 * field is filled by walk.ts based on which code path produced the chapter.
 */
export type ChapterDraft = {
  navTitle: string;
  body: string;
  wordCount: number;
  sourceHref: string;
  skippedByDefault: boolean;
  skipReason?: string;
  /** "nav" when produced from nav.xhtml/toc.ncx; "spine" when nav was empty/missing. */
  source: "nav" | "spine";
};

/**
 * One nav entry as resolved from nav.xhtml or toc.ncx. Hrefs are split into
 * file (relative to the OPF dir) + optional anchor.
 */
export type NavEntry = {
  title: string;
  file: string;
  anchor?: string;
};

/**
 * Result of pen-name auto-match against the user's saved profiles.
 *
 * - "exact": metadata.creator equals a profile key.
 * - "case-insensitive": equals a profile key case-insensitively (UI uses the
 *   profile's canonical casing).
 * - "none": no match.
 */
export type PenNameMatch = "exact" | "case-insensitive" | "none";

/**
 * Output of mapToProposedWrite(): Scriptr-shaped story + bible data ready for
 * the UI to preview and commit. Uses the actual Bible shape from lib/types.ts.
 */
export type ProposedWrite = {
  story: {
    title: string;
    description: string;
    keywords: string[];
    authorPenName: string;
  };
  bible: Bible;
  cover: { mimeType: string; bytes: Uint8Array } | null;
  chapters: ChapterDraft[];
  penNameMatch: PenNameMatch;
};

/**
 * Tagged error class. parse.ts and its dependencies throw this; the API route
 * unwraps `userMessage` for a clean 400 response.
 */
export class EpubParseError extends Error {
  readonly userMessage: string;
  constructor(userMessage: string) {
    super(userMessage);
    this.name = "EpubParseError";
    this.userMessage = userMessage;
  }
}
```

- [ ] **Step 2: Verify the file typechecks**

Run: `npm run typecheck`

Expected: pass. `lib/types.ts`'s `Bible` import resolves cleanly.

- [ ] **Step 3: Commit**

```bash
git add lib/epub/types.ts
git commit -m "feat(epub): add types module"
```

### Task 1.3: Create the fixture-builder script

The plan's test files load three synthetic EPUBs from `lib/epub/__fixtures__/`. Rather than commit binary EPUBs (unreviewable diffs), we generate them at test time from a TypeScript script.

**Note on convention divergence from `lib/novelai/__fixtures__/`:** the NovelAI importer commits its `sample.story` binary because the format is opaque (msgpack-CRDT). EPUB is plain XML in a zip — script-generated fixtures stay reviewable. The two conventions intentionally differ.

**Files:**
- Create: `scripts/build-epub-fixtures.mts` (note `.mts` — explicit ESM, mirrors existing `scripts/build-bisac-codes.mjs`)
- Create: `lib/epub/__fixtures__/.gitignore`
- Modify: `package.json` (`scripts.build:fixtures`, `scripts.pretest`)

- [ ] **Step 1: Write the .gitignore**

Create `lib/epub/__fixtures__/.gitignore`:

```
*.epub
```

This keeps the generated fixtures out of git while letting the directory exist via `.gitignore`.

- [ ] **Step 2: Write the fixture builder script**

Create `scripts/build-epub-fixtures.mts`. **Note for the implementer:** Vitest's `test:watch` doesn't re-run npm scripts on file change. After editing this script, manually re-run `npm run build:fixtures` (or rerun `npm test` once) before watch reruns pick up the new fixtures.

```ts
/**
 * Generates synthetic EPUB fixtures for tests in lib/epub/__fixtures__/.
 *
 * Three fixtures cover the test matrix:
 *  - sample-kdp.epub        : EPUB3, nav.xhtml, 1 chapter per spine item,
 *                              cover-image property, boilerplate front+back matter,
 *                              3 real chapters.
 *  - sample-smashwords.epub : EPUB2, toc.ncx, <meta name="cover"> pattern,
 *                              2 chapters.
 *  - sample-anchors.epub    : EPUB3, single XHTML in spine with 3 in-page
 *                              <h1 id="..."> anchors. Tests Pattern Z.
 *
 * NOTE: Vitest's test:watch does NOT rerun npm scripts. Re-run `npm run
 * build:fixtures` after editing this file to regenerate before watch picks up.
 */

import JSZip from "jszip";
import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, "..", "lib", "epub", "__fixtures__");

/** Escape XML special characters in user-supplied strings. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const MIMETYPE = "application/epub+zip";

// Tiny 1x1 transparent PNG (cover for KDP/anchors fixtures).
const COVER_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

// Tiny valid 1x1 JPEG (cover for Smashwords fixture). This is a complete
// decodable JPEG, not just magic bytes — commit-time tests that pipe the
// cover through `sharp` need a real image.
const COVER_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL+AB//Z";

function chapterXhtml(title: string, paragraphs: string[]): string {
  const body = paragraphs.map((p) => `<p>${esc(p)}</p>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${esc(title)}</title></head>
<body><h1>${esc(title)}</h1>${body}</body>
</html>`;
}

async function writeEpub(zip: JSZip, outFile: string) {
  // EPUB spec: 'mimetype' MUST be the first entry AND stored (not deflated).
  // JSZip preserves insertion order; the per-entry `compression: "STORE"`
  // option set when adding mimetype overrides the top-level compression.
  const buf = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, buf);
  // Show relative path so output is reproducible across machines.
  const rel = outFile.replace(`${process.cwd()}/`, "");
  console.log(`wrote ${rel} (${buf.byteLength} bytes)`);
}

async function buildKdp() {
  const zip = new JSZip();
  zip.file("mimetype", MIMETYPE, { compression: "STORE" });
  zip.file("META-INF/container.xml", CONTAINER_XML);
  zip.file("OEBPS/cover.png", Buffer.from(COVER_PNG_BASE64, "base64"));

  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:fixture-kdp</dc:identifier>
    <dc:title>The Garden Wall</dc:title>
    <dc:creator>Jane Author</dc:creator>
    <dc:description>A short synthetic EPUB3 for tests.</dc:description>
    <dc:subject>FIC027010</dc:subject>
    <dc:subject>romance</dc:subject>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="copyright" href="copyright.xhtml" media-type="application/xhtml+xml"/>
    <item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch3" href="ch3.xhtml" media-type="application/xhtml+xml"/>
    <item id="aboutauthor" href="aboutauthor.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="copyright"/>
    <itemref idref="title"/>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
    <itemref idref="ch3"/>
    <itemref idref="aboutauthor"/>
  </spine>
</package>`
  );

  zip.file(
    "OEBPS/nav.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body>
  <nav epub:type="toc">
    <ol>
      <li><a href="copyright.xhtml">Copyright</a></li>
      <li><a href="title.xhtml">Title Page</a></li>
      <li><a href="ch1.xhtml">Chapter 1: Arrival</a></li>
      <li><a href="ch2.xhtml">Chapter 2: The Door</a></li>
      <li><a href="ch3.xhtml">Chapter 3: Beyond</a></li>
      <li><a href="aboutauthor.xhtml">About the Author</a></li>
    </ol>
  </nav>
</body>
</html>`
  );

  zip.file(
    "OEBPS/copyright.xhtml",
    chapterXhtml("Copyright", ["Copyright 2026 Jane Author. All rights reserved."])
  );
  zip.file("OEBPS/title.xhtml", chapterXhtml("Title Page", ["The Garden Wall"]));
  zip.file(
    "OEBPS/ch1.xhtml",
    chapterXhtml("Chapter 1: Arrival", [
      "Mira stepped through the gate and into the garden for the first time.",
      "The air was warmer than she had expected.",
    ])
  );
  zip.file(
    "OEBPS/ch2.xhtml",
    chapterXhtml("Chapter 2: The Door", [
      "She found a door at the far end of the garden, half-hidden behind ivy.",
      "It was older than anything else she had seen here.",
    ])
  );
  zip.file(
    "OEBPS/ch3.xhtml",
    chapterXhtml("Chapter 3: Beyond", [
      "Beyond the door was another garden, and another, and another.",
      "She stopped counting after the seventh.",
    ])
  );
  zip.file(
    "OEBPS/aboutauthor.xhtml",
    chapterXhtml("About the Author", [
      "Jane Author lives somewhere quiet and writes about gardens.",
    ])
  );

  await writeEpub(zip, join(FIXTURE_DIR, "sample-kdp.epub"));
}

async function buildSmashwords() {
  const zip = new JSZip();
  zip.file("mimetype", MIMETYPE, { compression: "STORE" });
  zip.file("META-INF/container.xml", CONTAINER_XML);
  zip.file("OEBPS/cover.jpg", Buffer.from(COVER_JPEG_BASE64, "base64"));

  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="bookid">urn:uuid:fixture-sw</dc:identifier>
    <dc:title>Two Letters</dc:title>
    <dc:creator opf:role="aut">J. K. Author</dc:creator>
    <dc:description>An EPUB2 fixture using the toc.ncx pattern.</dc:description>
    <dc:language>en</dc:language>
    <meta name="cover" content="cover-img"/>
  </metadata>
  <manifest>
    <item id="cover-img" href="cover.jpg" media-type="image/jpeg"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`
  );

  zip.file(
    "OEBPS/toc.ncx",
    `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:uuid:fixture-sw"/></head>
  <docTitle><text>Two Letters</text></docTitle>
  <navMap>
    <navPoint id="np1" playOrder="1">
      <navLabel><text>The First Letter</text></navLabel>
      <content src="ch1.xhtml"/>
    </navPoint>
    <navPoint id="np2" playOrder="2">
      <navLabel><text>The Second Letter</text></navLabel>
      <content src="ch2.xhtml"/>
    </navPoint>
  </navMap>
</ncx>`
  );

  zip.file(
    "OEBPS/ch1.xhtml",
    chapterXhtml("The First Letter", ["Dear reader, this is the first letter.", "It is short on purpose."])
  );
  zip.file(
    "OEBPS/ch2.xhtml",
    chapterXhtml("The Second Letter", ["Dear reader, this is the second letter.", "Also short."])
  );

  await writeEpub(zip, join(FIXTURE_DIR, "sample-smashwords.epub"));
}

async function buildAnchors() {
  const zip = new JSZip();
  zip.file("mimetype", MIMETYPE, { compression: "STORE" });
  zip.file("META-INF/container.xml", CONTAINER_XML);
  zip.file("OEBPS/cover.png", Buffer.from(COVER_PNG_BASE64, "base64"));

  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:fixture-anchors</dc:identifier>
    <dc:title>One File Three Chapters</dc:title>
    <dc:creator>Anchor Test</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="book" href="book.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="book"/>
  </spine>
</package>`
  );

  zip.file(
    "OEBPS/nav.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body>
  <nav epub:type="toc">
    <ol>
      <li><a href="book.xhtml#ch1">Chapter One</a></li>
      <li><a href="book.xhtml#ch2">Chapter Two</a></li>
      <li><a href="book.xhtml#ch3">Chapter Three</a></li>
    </ol>
  </nav>
</body>
</html>`
  );

  zip.file(
    "OEBPS/book.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>One File Three Chapters</title></head>
<body>
  <h1 id="ch1">Chapter One</h1>
  <p>The first chapter is brief and to the point.</p>
  <p>It establishes the world.</p>
  <h1 id="ch2">Chapter Two</h1>
  <p>The second chapter introduces a complication.</p>
  <p>The complication is unexpected but inevitable.</p>
  <h1 id="ch3">Chapter Three</h1>
  <p>The third chapter resolves nothing.</p>
  <p>That is the point.</p>
</body>
</html>`
  );

  await writeEpub(zip, join(FIXTURE_DIR, "sample-anchors.epub"));
}

async function buildNoNav() {
  // EPUB3 with NO nav.xhtml — exercises walk.ts's spine-fallback path. Each
  // spine item should become a chapter, titled from its first <h1>.
  const zip = new JSZip();
  zip.file("mimetype", MIMETYPE, { compression: "STORE" });
  zip.file("META-INF/container.xml", CONTAINER_XML);

  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:fixture-nonav</dc:identifier>
    <dc:title>No Nav Book</dc:title>
    <dc:creator>Spine Fallback</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`
  );

  zip.file(
    "OEBPS/ch1.xhtml",
    chapterXhtml("Opening", ["The first chapter of a book without a nav.", "Walker should fall back to spine."])
  );
  zip.file(
    "OEBPS/ch2.xhtml",
    chapterXhtml("Closing", ["The second and final chapter.", "Title comes from the h1, not nav metadata."])
  );

  await writeEpub(zip, join(FIXTURE_DIR, "sample-nonav.epub"));
}

async function main() {
  await buildKdp();
  await buildSmashwords();
  await buildAnchors();
  await buildNoNav();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Add the script + pretest hook to package.json**

In `package.json` `scripts`, add:

```json
"build:fixtures": "tsx scripts/build-epub-fixtures.mts",
"pretest": "npm run build:fixtures"
```

Notes:
- `tsx` was added as a devDependency in Task 1.1, Step 2.
- A `pretest` script does not currently exist in this repo (verified at plan-write time). If one has been added since, append: `"pretest": "<existing> && npm run build:fixtures"`. Confirm first with `python3 -c "import json; print(json.load(open('package.json'))['scripts'].get('pretest','none'))"`.

- [ ] **Step 4: Run the script and verify it produces fixtures**

Run: `npm run build:fixtures`

Expected output (relative paths):
```
wrote lib/epub/__fixtures__/sample-kdp.epub (... bytes)
wrote lib/epub/__fixtures__/sample-smashwords.epub (... bytes)
wrote lib/epub/__fixtures__/sample-anchors.epub (... bytes)
wrote lib/epub/__fixtures__/sample-nonav.epub (... bytes)
```

Run: `ls lib/epub/__fixtures__/`

Expected: `.gitignore`, `sample-kdp.epub`, `sample-smashwords.epub`, `sample-anchors.epub`, `sample-nonav.epub`.

- [ ] **Step 5: Verify all four fixtures unzip cleanly and `mimetype` is the first entry**

Run (uses `unzip -Z1` which prints one entry per line, no header — portable across InfoZip versions):

```bash
for f in lib/epub/__fixtures__/sample-{kdp,smashwords,anchors,nonav}.epub; do
  echo "=== $f ==="
  echo "first entry: $(unzip -Z1 "$f" | head -1)"
  unzip -Z1 "$f"
done
```

Expected: for each file, the "first entry" line prints `mimetype`. Each entry listing includes the expected files (KDP: nav.xhtml + 6 XHTML chapters + cover.png; Smashwords: toc.ncx + 2 XHTML + cover.jpg; anchors: nav.xhtml + book.xhtml + cover.png; nonav: 2 XHTML, no nav).

If `mimetype` is NOT the first entry: JSZip ordering changed between versions. Halt, switch to manually building the central directory or pinning JSZip ≥3.10.x (which preserves insertion order).

Also verify mimetype contents:

Run: `unzip -p lib/epub/__fixtures__/sample-kdp.epub mimetype`

Expected: prints `application/epub+zip` (no trailing newline).

- [ ] **Step 6: Verify .gitignore is respected**

Run: `git status lib/epub/__fixtures__/`

Expected: only the `.gitignore` file shows as untracked. No `.epub` files appear.

- [ ] **Step 7: Verify lint + typecheck still green**

Run: `npm run lint && npm run typecheck`

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add scripts/build-epub-fixtures.mts lib/epub/__fixtures__/.gitignore package.json package-lock.json
git commit -m "feat(epub): fixture builder for synthetic EPUBs

Generates four fixtures used by the EPUB importer's test suite:
sample-kdp (EPUB3 + nav.xhtml), sample-smashwords (EPUB2 + toc.ncx),
sample-anchors (Pattern Z — one XHTML, multiple in-page anchors),
sample-nonav (no nav.xhtml — exercises spine fallback in walk.ts).

Generated EPUBs are gitignored. The pretest npm hook runs the builder
so CI always has fresh fixtures matching the source script."
```

---

## Chunk 2: lib/epub — archive, OPF, and nav parsers

This chunk builds the three lowest-level parsing modules: the JSZip wrapper, the OPF (`content.opf`) parser, and the nav (`nav.xhtml`/`toc.ncx`) parser. Each task follows TDD strictly: write a failing test, run to confirm failure, implement, run to confirm passes, commit. Higher-level modules (walker, boilerplate, cover, map, orchestrator) follow in Chunks 3 and 4.

**Path constant for tests:** every test file in this chunk uses the same fixture-loading helper. To avoid repetition, the first test file (`unzip.test.ts`) defines `FIXTURE_DIR` inline; subsequent test files copy the same pattern. Fixture path resolution mirrors `tests/lib/novelai/decode.test.ts`:

```ts
const FIXTURE_DIR = join(__dirname, "..", "..", "..", "lib", "epub", "__fixtures__");
```

(Vitest runs `.test.ts` files in CommonJS-by-default mode, so `__dirname` is available without ESM ceremony — same as the NovelAI tests.)

### Task 2.1: `unzip.ts` — JSZip wrapper

Provides typed access to file contents inside an EPUB zip. Pure function: input bytes, output a path-keyed map. Throws `EpubParseError` on invalid zip.

**Files:**
- Create: `lib/epub/unzip.ts`
- Test: `tests/lib/epub/unzip.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/epub/unzip.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { openEpubArchive } from "@/lib/epub/unzip";
import { EpubParseError } from "@/lib/epub/types";

const FIXTURE_DIR = join(__dirname, "..", "..", "..", "lib", "epub", "__fixtures__");

describe("openEpubArchive", () => {
  it("rejects non-zip input", async () => {
    const buf = Buffer.from("this is not a zip file at all");
    await expect(openEpubArchive(buf)).rejects.toBeInstanceOf(EpubParseError);
    await expect(openEpubArchive(buf)).rejects.toMatchObject({
      userMessage: "File is not a valid EPUB (could not unzip).",
    });
  });

  it("returns an archive with readText/readBytes/has methods", async () => {
    const buf = await readFile(join(FIXTURE_DIR, "sample-kdp.epub"));
    const archive = await openEpubArchive(buf);
    expect(typeof archive.readText).toBe("function");
    expect(typeof archive.readBytes).toBe("function");
    expect(typeof archive.has).toBe("function");
  });

  it("reads the mimetype file as text", async () => {
    const buf = await readFile(join(FIXTURE_DIR, "sample-kdp.epub"));
    const archive = await openEpubArchive(buf);
    const mimetype = await archive.readText("mimetype");
    expect(mimetype.trim()).toBe("application/epub+zip");
  });

  it("reads container.xml as text", async () => {
    const buf = await readFile(join(FIXTURE_DIR, "sample-kdp.epub"));
    const archive = await openEpubArchive(buf);
    const xml = await archive.readText("META-INF/container.xml");
    expect(xml).toContain("OEBPS/content.opf");
  });

  it("reads cover image as bytes", async () => {
    const buf = await readFile(join(FIXTURE_DIR, "sample-kdp.epub"));
    const archive = await openEpubArchive(buf);
    const bytes = await archive.readBytes("OEBPS/cover.png");
    expect(bytes.byteLength).toBeGreaterThan(0);
    // PNG magic: 89 50 4E 47
    expect(bytes[0]).toBe(0x89);
    expect(bytes[1]).toBe(0x50);
  });

  it("has() returns true for present paths and false for absent", async () => {
    const buf = await readFile(join(FIXTURE_DIR, "sample-kdp.epub"));
    const archive = await openEpubArchive(buf);
    expect(archive.has("mimetype")).toBe(true);
    expect(archive.has("nope/nonexistent.xhtml")).toBe(false);
  });

  it("readText throws if the path is missing", async () => {
    const buf = await readFile(join(FIXTURE_DIR, "sample-kdp.epub"));
    const archive = await openEpubArchive(buf);
    await expect(archive.readText("nope.xhtml")).rejects.toThrow(/not found/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/epub/unzip.test.ts`

Expected: every test fails with import error or "openEpubArchive is not a function" — `lib/epub/unzip.ts` does not exist yet.

- [ ] **Step 3: Implement `lib/epub/unzip.ts`**

Create `lib/epub/unzip.ts`:

```ts
import JSZip from "jszip";
import { EpubParseError } from "@/lib/epub/types";

export interface EpubArchive {
  has(path: string): boolean;
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  /** All paths inside the archive, in zip order. */
  paths(): string[];
}

export async function openEpubArchive(buf: Buffer): Promise<EpubArchive> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw new EpubParseError("File is not a valid EPUB (could not unzip).");
  }

  return {
    has(path) {
      return zip.file(path) !== null;
    },
    async readText(path) {
      const f = zip.file(path);
      if (!f) throw new Error(`EPUB entry not found: ${path}`);
      return f.async("string");
    },
    async readBytes(path) {
      const f = zip.file(path);
      if (!f) throw new Error(`EPUB entry not found: ${path}`);
      return f.async("uint8array");
    },
    paths() {
      return Object.keys(zip.files);
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/epub/unzip.test.ts`

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/epub/unzip.ts tests/lib/epub/unzip.test.ts
git commit -m "feat(epub): unzip wrapper around JSZip with typed accessors"
```

### Task 2.2: `opf.ts` — content.opf parser

Locates `content.opf` via `META-INF/container.xml`, then parses it for metadata, manifest, spine, and cover-image lookup. Returns a structured `ParsedOpf` consumed by nav/walk/cover.

**Files:**
- Create: `lib/epub/opf.ts`
- Test: `tests/lib/epub/opf.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/epub/opf.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { openEpubArchive } from "@/lib/epub/unzip";
import { findOpfPath, parseOpf } from "@/lib/epub/opf";
import { EpubParseError } from "@/lib/epub/types";

const FIXTURE_DIR = join(__dirname, "..", "..", "..", "lib", "epub", "__fixtures__");

async function loadOpf(fixture: string) {
  const buf = await readFile(join(FIXTURE_DIR, fixture));
  const archive = await openEpubArchive(buf);
  const opfPath = await findOpfPath(archive);
  const opfXml = await archive.readText(opfPath);
  return { archive, opfPath, opf: parseOpf(opfXml, opfPath) };
}

describe("findOpfPath", () => {
  it("reads container.xml and returns the rootfile full-path", async () => {
    const buf = await readFile(join(FIXTURE_DIR, "sample-kdp.epub"));
    const archive = await openEpubArchive(buf);
    expect(await findOpfPath(archive)).toBe("OEBPS/content.opf");
  });

  it("throws if container.xml is missing", async () => {
    const archive = {
      has: () => false,
      readText: async () => "",
      readBytes: async () => new Uint8Array(),
      paths: () => [],
    };
    await expect(findOpfPath(archive)).rejects.toMatchObject({
      userMessage: "Missing container.xml — not an EPUB.",
    });
  });
});

describe("parseOpf — metadata (EPUB3, KDP fixture)", () => {
  it("extracts title, creator, description, language", async () => {
    const { opf } = await loadOpf("sample-kdp.epub");
    expect(opf.metadata.title).toBe("The Garden Wall");
    expect(opf.metadata.creator).toBe("Jane Author");
    expect(opf.metadata.description).toBe("A short synthetic EPUB3 for tests.");
    expect(opf.metadata.language).toBe("en");
  });

  it("collects multiple dc:subject entries into subjects[]", async () => {
    const { opf } = await loadOpf("sample-kdp.epub");
    expect(opf.metadata.subjects).toEqual(["FIC027010", "romance"]);
  });

  it("reports epubVersion=3", async () => {
    const { opf } = await loadOpf("sample-kdp.epub");
    expect(opf.epubVersion).toBe(3);
  });
});

describe("parseOpf — manifest + spine", () => {
  it("returns manifest as a map with hrefs resolved relative to OPF dir", async () => {
    const { opf } = await loadOpf("sample-kdp.epub");
    expect(opf.manifest.get("ch1")?.href).toBe("OEBPS/ch1.xhtml");
    expect(opf.manifest.get("ch1")?.mediaType).toBe("application/xhtml+xml");
    expect(opf.manifest.get("nav")?.properties).toContain("nav");
  });

  it("returns spine as ordered idref array", async () => {
    const { opf } = await loadOpf("sample-kdp.epub");
    expect(opf.spine).toEqual(["copyright", "title", "ch1", "ch2", "ch3", "aboutauthor"]);
  });
});

describe("parseOpf — cover lookup (EPUB3 properties=cover-image)", () => {
  it("finds cover via manifest item with properties=cover-image", async () => {
    const { opf } = await loadOpf("sample-kdp.epub");
    expect(opf.coverManifestId).toBe("cover");
  });
});

describe("parseOpf — EPUB2 fixture (toc.ncx + meta cover)", () => {
  it("reports epubVersion=2", async () => {
    const { opf } = await loadOpf("sample-smashwords.epub");
    expect(opf.epubVersion).toBe(2);
  });

  it("finds cover via <meta name=cover content=ID/>", async () => {
    const { opf } = await loadOpf("sample-smashwords.epub");
    expect(opf.coverManifestId).toBe("cover-img");
  });

  it("strips opf:role from creator", async () => {
    const { opf } = await loadOpf("sample-smashwords.epub");
    expect(opf.metadata.creator).toBe("J. K. Author");
  });
});

describe("parseOpf — error conditions", () => {
  it("throws on unsupported version", () => {
    const xml = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="1.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>X</dc:title></metadata>
  <manifest/><spine/>
</package>`;
    expect(() => parseOpf(xml, "OEBPS/content.opf")).toThrow(EpubParseError);
    expect(() => parseOpf(xml, "OEBPS/content.opf")).toThrow(/Unsupported EPUB version/);
  });

  it("throws on missing title", () => {
    const xml = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"></metadata>
  <manifest/><spine/>
</package>`;
    expect(() => parseOpf(xml, "OEBPS/content.opf")).toThrow(/no title/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/epub/opf.test.ts`

Expected: all tests fail — module does not exist.

- [ ] **Step 3: Implement `lib/epub/opf.ts`**

Create `lib/epub/opf.ts`:

```ts
import { XMLParser } from "fast-xml-parser";
import { dirname, posix } from "node:path";
import type { EpubArchive } from "@/lib/epub/unzip";
import { EpubParseError } from "@/lib/epub/types";

export type ManifestEntry = {
  id: string;
  href: string; // resolved relative to OPF dir (zip-style forward slashes)
  mediaType: string;
  properties?: string;
};

export type ParsedOpf = {
  epubVersion: 2 | 3;
  metadata: {
    title: string;
    creator: string;
    description: string;
    subjects: string[];
    language: string;
  };
  manifest: Map<string, ManifestEntry>;
  spine: string[]; // idrefs in order
  coverManifestId: string | null;
  /** Directory the OPF lives in (zip path), used by callers to resolve hrefs. */
  opfDir: string;
};

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Always return arrays for repeated elements (subject, item, itemref, meta).
  isArray: (name) =>
    [
      "dc:subject",
      "subject",
      "item",
      "itemref",
      "meta",
      "rootfile",
    ].includes(name),
  textNodeName: "#text",
  parseAttributeValue: false,
});

export async function findOpfPath(archive: EpubArchive): Promise<string> {
  if (!archive.has("META-INF/container.xml")) {
    throw new EpubParseError("Missing container.xml — not an EPUB.");
  }
  const xml = await archive.readText("META-INF/container.xml");
  const parsed = xmlParser.parse(xml) as Record<string, unknown>;
  const container = parsed["container"] as Record<string, unknown> | undefined;
  const rootfiles = container?.["rootfiles"] as Record<string, unknown> | undefined;
  const rfList = (rootfiles?.["rootfile"] ?? []) as Array<Record<string, unknown>>;
  const fullPath = rfList[0]?.["@_full-path"] as string | undefined;
  if (!fullPath) {
    throw new EpubParseError("Could not find content.opf in this EPUB.");
  }
  return fullPath;
}

function joinZip(opfDir: string, href: string): string {
  // EPUB paths use forward slashes; posix.join keeps them.
  return posix.join(opfDir, href);
}

function flatString(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node.trim();
  if (typeof node === "object" && node !== null) {
    const o = node as Record<string, unknown>;
    if (typeof o["#text"] === "string") return (o["#text"] as string).trim();
  }
  return "";
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

export function parseOpf(xml: string, opfPath: string): ParsedOpf {
  const parsed = xmlParser.parse(xml) as Record<string, unknown>;
  const pkg = parsed["package"] as Record<string, unknown> | undefined;
  if (!pkg) throw new EpubParseError("Could not find content.opf in this EPUB.");

  const versionRaw = String(pkg["@_version"] ?? "");
  let epubVersion: 2 | 3;
  if (/^3(\.|$)/.test(versionRaw)) epubVersion = 3;
  else if (/^2(\.|$)/.test(versionRaw)) epubVersion = 2;
  else {
    throw new EpubParseError(
      `Unsupported EPUB version: got ${versionRaw || "unknown"}, expected 2.x or 3.x.`
    );
  }

  const opfDir = dirname(opfPath); // e.g. "OEBPS"

  // ── metadata ───────────────────────────────────────────────────────────
  const metaBlock = (pkg["metadata"] ?? {}) as Record<string, unknown>;
  const title = flatString(asArray(metaBlock["dc:title"])[0] ?? metaBlock["dc:title"]);
  if (!title) throw new EpubParseError("This EPUB has no title in its metadata.");

  const creator = flatString(asArray(metaBlock["dc:creator"])[0] ?? metaBlock["dc:creator"]);
  const description = flatString(metaBlock["dc:description"]);
  const language = flatString(metaBlock["dc:language"]);
  const subjects = asArray(metaBlock["dc:subject"])
    .map((s) => flatString(s))
    .filter((s) => s.length > 0);

  // ── manifest ───────────────────────────────────────────────────────────
  const manifestBlock = (pkg["manifest"] ?? {}) as Record<string, unknown>;
  const manifest = new Map<string, ManifestEntry>();
  for (const item of asArray<Record<string, unknown>>(
    manifestBlock["item"] as Record<string, unknown>[] | undefined
  )) {
    const id = String(item["@_id"] ?? "");
    const hrefRaw = String(item["@_href"] ?? "");
    const mediaType = String(item["@_media-type"] ?? "");
    const properties = item["@_properties"] as string | undefined;
    if (!id || !hrefRaw) continue;
    manifest.set(id, {
      id,
      href: joinZip(opfDir, hrefRaw),
      mediaType,
      properties,
    });
  }

  // ── spine ──────────────────────────────────────────────────────────────
  const spineBlock = (pkg["spine"] ?? {}) as Record<string, unknown>;
  const spine: string[] = asArray<Record<string, unknown>>(
    spineBlock["itemref"] as Record<string, unknown>[] | undefined
  )
    .map((ir) => String(ir["@_idref"] ?? ""))
    .filter((s) => s.length > 0);

  // ── cover lookup ───────────────────────────────────────────────────────
  // EPUB3: manifest item with properties containing "cover-image".
  let coverManifestId: string | null = null;
  for (const entry of manifest.values()) {
    if (entry.properties && /(?:^|\s)cover-image(?:\s|$)/.test(entry.properties)) {
      coverManifestId = entry.id;
      break;
    }
  }
  // EPUB2 fallback: <meta name="cover" content="ID"/>.
  if (!coverManifestId) {
    for (const m of asArray<Record<string, unknown>>(
      metaBlock["meta"] as Record<string, unknown>[] | undefined
    )) {
      if (m["@_name"] === "cover" && typeof m["@_content"] === "string") {
        const candidate = m["@_content"] as string;
        if (manifest.has(candidate)) {
          coverManifestId = candidate;
          break;
        }
      }
    }
  }

  return {
    epubVersion,
    metadata: { title, creator, description, subjects, language },
    manifest,
    spine,
    coverManifestId,
    opfDir,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/epub/opf.test.ts`

Expected: all tests pass. If `parseAttributeValue: false` causes string/number coercion issues in any test, leave the option alone — the tests exercise string-only attributes.

- [ ] **Step 5: Commit**

```bash
git add lib/epub/opf.ts tests/lib/epub/opf.test.ts
git commit -m "feat(epub): parse content.opf — metadata, manifest, spine, cover lookup"
```

### Task 2.3: `nav.ts` — nav.xhtml + toc.ncx parser

Given a parsed OPF + the archive, locate the nav file and return a flat `NavEntry[]` (title + file + optional anchor).

**Files:**
- Create: `lib/epub/nav.ts`
- Test: `tests/lib/epub/nav.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/epub/nav.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { openEpubArchive } from "@/lib/epub/unzip";
import { findOpfPath, parseOpf } from "@/lib/epub/opf";
import { parseNav } from "@/lib/epub/nav";

const FIXTURE_DIR = join(__dirname, "..", "..", "..", "lib", "epub", "__fixtures__");

async function loadParsed(fixture: string) {
  const buf = await readFile(join(FIXTURE_DIR, fixture));
  const archive = await openEpubArchive(buf);
  const opfPath = await findOpfPath(archive);
  const opf = parseOpf(await archive.readText(opfPath), opfPath);
  return { archive, opf };
}

describe("parseNav — EPUB3 nav.xhtml (KDP fixture)", () => {
  it("returns flat list of nav entries in document order", async () => {
    const { archive, opf } = await loadParsed("sample-kdp.epub");
    const entries = await parseNav(archive, opf);
    expect(entries).toHaveLength(6);
    expect(entries[0]).toMatchObject({ title: "Copyright", file: "OEBPS/copyright.xhtml" });
    expect(entries[2]).toMatchObject({ title: "Chapter 1: Arrival", file: "OEBPS/ch1.xhtml" });
    expect(entries[5]).toMatchObject({ title: "About the Author", file: "OEBPS/aboutauthor.xhtml" });
  });

  it("does not set anchor when href has no fragment", async () => {
    const { archive, opf } = await loadParsed("sample-kdp.epub");
    const entries = await parseNav(archive, opf);
    for (const e of entries) expect(e.anchor).toBeUndefined();
  });
});

describe("parseNav — EPUB3 anchors (Pattern Z fixture)", () => {
  it("splits href on '#' into file + anchor", async () => {
    const { archive, opf } = await loadParsed("sample-anchors.epub");
    const entries = await parseNav(archive, opf);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({ title: "Chapter One", file: "OEBPS/book.xhtml", anchor: "ch1" });
    expect(entries[1]).toEqual({ title: "Chapter Two", file: "OEBPS/book.xhtml", anchor: "ch2" });
    expect(entries[2]).toEqual({ title: "Chapter Three", file: "OEBPS/book.xhtml", anchor: "ch3" });
  });
});

describe("parseNav — EPUB2 toc.ncx (Smashwords fixture)", () => {
  it("returns nav entries from navMap", async () => {
    const { archive, opf } = await loadParsed("sample-smashwords.epub");
    const entries = await parseNav(archive, opf);
    expect(entries).toEqual([
      { title: "The First Letter", file: "OEBPS/ch1.xhtml" },
      { title: "The Second Letter", file: "OEBPS/ch2.xhtml" },
    ]);
  });
});

describe("parseNav — missing nav (No-Nav fixture)", () => {
  it("returns empty array when nav file is missing", async () => {
    const { archive, opf } = await loadParsed("sample-nonav.epub");
    const entries = await parseNav(archive, opf);
    expect(entries).toEqual([]);
  });
});

describe("parseNav — flattens nested <ol>", () => {
  it("treats nested nav items as a flat list in document order", async () => {
    // Hand-built archive with a nav.xhtml containing nested <ol> structure.
    const navXhtml = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body><nav epub:type="toc"><ol>
  <li><a href="part1.xhtml">Part One</a><ol>
    <li><a href="ch1.xhtml">Chapter 1</a></li>
    <li><a href="ch2.xhtml">Chapter 2</a></li>
  </ol></li>
  <li><a href="part2.xhtml">Part Two</a></li>
</ol></nav></body></html>`;
    const archive = {
      has: (p: string) => p === "OEBPS/nav.xhtml",
      readText: async () => navXhtml,
      readBytes: async () => new Uint8Array(),
      paths: () => ["OEBPS/nav.xhtml"],
    };
    const opf = {
      epubVersion: 3 as const,
      metadata: { title: "X", creator: "", description: "", subjects: [], language: "" },
      manifest: new Map([
        ["nav", { id: "nav", href: "OEBPS/nav.xhtml", mediaType: "application/xhtml+xml", properties: "nav" }],
      ]),
      spine: [],
      coverManifestId: null,
      opfDir: "OEBPS",
    };
    const entries = await parseNav(archive, opf);
    expect(entries.map((e) => e.title)).toEqual(["Part One", "Chapter 1", "Chapter 2", "Part Two"]);
    expect(entries[0].file).toBe("OEBPS/part1.xhtml");
    expect(entries[2].file).toBe("OEBPS/ch2.xhtml");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/epub/nav.test.ts`

Expected: all tests fail — module does not exist.

- [ ] **Step 3: Implement `lib/epub/nav.ts`**

Create `lib/epub/nav.ts`:

```ts
import * as cheerio from "cheerio";
import { XMLParser } from "fast-xml-parser";
import { dirname, posix } from "node:path";
import type { EpubArchive } from "@/lib/epub/unzip";
import type { ParsedOpf } from "@/lib/epub/opf";
import type { NavEntry } from "@/lib/epub/types";

const ncxParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => ["navPoint"].includes(name),
  textNodeName: "#text",
});

function splitHref(href: string, baseDir: string): { file: string; anchor?: string } {
  const [path, anchor] = href.split("#");
  return {
    file: posix.join(baseDir, path),
    anchor: anchor || undefined,
  };
}

async function parseEpub3Nav(
  archive: EpubArchive,
  navHref: string
): Promise<NavEntry[]> {
  const xml = await archive.readText(navHref);
  const $ = cheerio.load(xml, { xml: false });
  // Prefer epub:type="toc" if present; otherwise first <nav>.
  let navEl = $("nav[epub\\:type='toc']").first();
  if (navEl.length === 0) navEl = $("nav").first();
  if (navEl.length === 0) return [];

  const entries: NavEntry[] = [];
  const baseDir = dirname(navHref);
  // Walk descendant <a href> in document order, flattening any nesting.
  navEl.find("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (!href) return;
    const title = $(el).text().trim();
    const { file, anchor } = splitHref(href, baseDir);
    entries.push({ title, file, ...(anchor ? { anchor } : {}) });
  });
  return entries;
}

async function parseEpub2Ncx(
  archive: EpubArchive,
  ncxHref: string
): Promise<NavEntry[]> {
  const xml = await archive.readText(ncxHref);
  const parsed = ncxParser.parse(xml) as Record<string, unknown>;
  const ncx = parsed["ncx"] as Record<string, unknown> | undefined;
  const navMap = ncx?.["navMap"] as Record<string, unknown> | undefined;
  const navPoints = (navMap?.["navPoint"] ?? []) as Array<Record<string, unknown>>;

  const baseDir = dirname(ncxHref);
  const entries: NavEntry[] = [];

  function visit(point: Record<string, unknown>) {
    const navLabel = point["navLabel"] as Record<string, unknown> | undefined;
    const labelText = navLabel?.["text"];
    let title = "";
    if (typeof labelText === "string") title = labelText.trim();
    else if (labelText && typeof labelText === "object" && "#text" in labelText) {
      title = String((labelText as Record<string, unknown>)["#text"] ?? "").trim();
    }
    const content = point["content"] as Record<string, unknown> | undefined;
    const src = content?.["@_src"];
    if (typeof src === "string" && src.length > 0) {
      const { file, anchor } = splitHref(src, baseDir);
      entries.push({ title, file, ...(anchor ? { anchor } : {}) });
    }
    // Flatten nested navPoints in document order.
    const children = point["navPoint"];
    if (Array.isArray(children)) {
      for (const child of children) visit(child as Record<string, unknown>);
    } else if (children && typeof children === "object") {
      visit(children as Record<string, unknown>);
    }
  }

  for (const p of navPoints) visit(p);
  return entries;
}

export async function parseNav(
  archive: EpubArchive,
  opf: ParsedOpf
): Promise<NavEntry[]> {
  if (opf.epubVersion === 3) {
    // Find manifest item with properties containing "nav".
    for (const entry of opf.manifest.values()) {
      if (entry.properties && /(?:^|\s)nav(?:\s|$)/.test(entry.properties)) {
        if (archive.has(entry.href)) return parseEpub3Nav(archive, entry.href);
      }
    }
    return [];
  }
  // EPUB2: find ncx via mediaType "application/x-dtbncx+xml".
  for (const entry of opf.manifest.values()) {
    if (entry.mediaType === "application/x-dtbncx+xml") {
      if (archive.has(entry.href)) return parseEpub2Ncx(archive, entry.href);
    }
  }
  return [];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/epub/nav.test.ts`

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/epub/nav.ts tests/lib/epub/nav.test.ts
git commit -m "feat(epub): parse nav.xhtml (EPUB3) and toc.ncx (EPUB2) into flat NavEntry list"
```

---

## Chunk 3: lib/epub — chapter walker + boilerplate denylist

This chunk produces the per-chapter content. Tasks 3.1 (walker) and 3.2 (boilerplate denylist) together turn an `EpubArchive` + `ParsedOpf` + `NavEntry[]` into a `ChapterDraft[]` with skip flags applied. Same TDD discipline as Chunk 2.

### Task 3.1: `walk.ts` — chapter walker

The most complex unit. Given parsed OPF + nav entries + archive, produces `ChapterDraft[]`. Handles:
- Pattern X: 1 nav entry per file → take whole `<body>`.
- Pattern Z: anchor splits → slice content between consecutive anchors in the same file.
- Spine fallback: when `parseNav()` returned `[]`, walk the spine directly, titling chapters from first `<h1>`/`<h2>`.
- Missing files (nav entry references a file not in the manifest/zip) → skip silently.

Each output `ChapterDraft.body` is markdown via `htmlToMarkdown`. Word count is computed inline.

**Files:**
- Create: `lib/epub/walk.ts`
- Test: `tests/lib/epub/walk.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/epub/walk.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { openEpubArchive } from "@/lib/epub/unzip";
import { findOpfPath, parseOpf } from "@/lib/epub/opf";
import { parseNav } from "@/lib/epub/nav";
import { walkChapters } from "@/lib/epub/walk";

const FIXTURE_DIR = join(__dirname, "..", "..", "..", "lib", "epub", "__fixtures__");

async function loadAll(fixture: string) {
  const buf = await readFile(join(FIXTURE_DIR, fixture));
  const archive = await openEpubArchive(buf);
  const opfPath = await findOpfPath(archive);
  const opf = parseOpf(await archive.readText(opfPath), opfPath);
  const nav = await parseNav(archive, opf);
  return { archive, opf, nav };
}

describe("walkChapters — Pattern X (KDP fixture, 1 file per chapter)", () => {
  it("produces one ChapterDraft per nav entry, source='nav'", async () => {
    const { archive, opf, nav } = await loadAll("sample-kdp.epub");
    const chapters = await walkChapters(archive, opf, nav);
    expect(chapters).toHaveLength(6);
    expect(chapters[0].source).toBe("nav");
  });

  it("preserves nav titles and uses sourceHref for the file", async () => {
    const { archive, opf, nav } = await loadAll("sample-kdp.epub");
    const chapters = await walkChapters(archive, opf, nav);
    expect(chapters[2].navTitle).toBe("Chapter 1: Arrival");
    expect(chapters[2].sourceHref).toBe("OEBPS/ch1.xhtml");
  });

  it("body is markdown with paragraphs separated by blank lines", async () => {
    const { archive, opf, nav } = await loadAll("sample-kdp.epub");
    const chapters = await walkChapters(archive, opf, nav);
    const ch1 = chapters[2];
    expect(ch1.body).toContain("Mira stepped through the gate");
    expect(ch1.body).toContain("\n\n");
    // The <h1> heading was inside the body; htmlToMarkdown drops unknown tags
    // and keeps inner text, so "Chapter 1: Arrival" appears in the prose.
    expect(ch1.body).toContain("Chapter 1: Arrival");
  });

  it("populates wordCount", async () => {
    const { archive, opf, nav } = await loadAll("sample-kdp.epub");
    const chapters = await walkChapters(archive, opf, nav);
    expect(chapters[2].wordCount).toBeGreaterThan(0);
  });
});

describe("walkChapters — Pattern Z (anchors fixture)", () => {
  it("slices content between consecutive anchors in the same file", async () => {
    const { archive, opf, nav } = await loadAll("sample-anchors.epub");
    const chapters = await walkChapters(archive, opf, nav);
    expect(chapters).toHaveLength(3);
    expect(chapters[0].body).toContain("first chapter is brief");
    expect(chapters[0].body).not.toContain("second chapter introduces");
    expect(chapters[1].body).toContain("second chapter introduces");
    expect(chapters[1].body).not.toContain("third chapter resolves");
    expect(chapters[2].body).toContain("third chapter resolves");
  });
});

describe("walkChapters — spine fallback (No-Nav fixture)", () => {
  it("returns one chapter per spine item when nav is empty", async () => {
    const { archive, opf, nav } = await loadAll("sample-nonav.epub");
    expect(nav).toEqual([]);
    const chapters = await walkChapters(archive, opf, nav);
    expect(chapters).toHaveLength(2);
    expect(chapters[0].source).toBe("spine");
  });

  it("titles chapters from the first <h1> in spine fallback", async () => {
    const { archive, opf, nav } = await loadAll("sample-nonav.epub");
    const chapters = await walkChapters(archive, opf, nav);
    expect(chapters[0].navTitle).toBe("Opening");
    expect(chapters[1].navTitle).toBe("Closing");
  });
});

describe("walkChapters — missing nav-target file", () => {
  it("skips entries whose file is not in the archive", async () => {
    const { archive, opf } = await loadAll("sample-kdp.epub");
    const fakeNav = [
      { title: "Real", file: "OEBPS/ch1.xhtml" },
      { title: "Ghost", file: "OEBPS/does-not-exist.xhtml" },
      { title: "Real 2", file: "OEBPS/ch2.xhtml" },
    ];
    const chapters = await walkChapters(archive, opf, fakeNav);
    expect(chapters).toHaveLength(2);
    expect(chapters.map((c) => c.navTitle)).toEqual(["Real", "Real 2"]);
  });
});

describe("walkChapters — cross-file boundary", () => {
  it("when next nav entry is in a DIFFERENT file, slice runs to end-of-body of current file", async () => {
    // Two consecutive nav entries: one anchored in book.xhtml, the next in
    // a different file. The first entry's slice should include everything
    // from its anchor through end-of-body, NOT stop at the second entry's
    // anchor (which lives in another file).
    const { archive, opf } = await loadAll("sample-anchors.epub");
    const nav = [
      { title: "Anchored", file: "OEBPS/book.xhtml", anchor: "ch2" },
      { title: "Elsewhere", file: "OEBPS/nav.xhtml" },
    ];
    const chapters = await walkChapters(archive, opf, nav);
    expect(chapters).toHaveLength(2);
    // Anchored chapter must include both ch2 and ch3 content, since they're
    // siblings after ch2's anchor and the next entry is in another file.
    expect(chapters[0].body).toContain("second chapter introduces");
    expect(chapters[0].body).toContain("third chapter resolves");
  });
});

describe("walkChapters — empty body", () => {
  it("flags empty chapters as skippedByDefault with reason 'Empty chapter'", async () => {
    // Manually craft an archive with one XHTML containing no prose.
    const xml = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><img src="x.png"/></body></html>`;
    const archive = {
      has: (p: string) => p === "OEBPS/empty.xhtml",
      readText: async () => xml,
      readBytes: async () => new Uint8Array(),
      paths: () => ["OEBPS/empty.xhtml"],
    };
    const opf = {
      epubVersion: 3 as const,
      metadata: { title: "X", creator: "", description: "", subjects: [], language: "" },
      manifest: new Map(),
      spine: [],
      coverManifestId: null,
      opfDir: "OEBPS",
    };
    const nav = [{ title: "Empty", file: "OEBPS/empty.xhtml" }];
    const chapters = await walkChapters(archive, opf, nav);
    expect(chapters).toHaveLength(1);
    expect(chapters[0].skippedByDefault).toBe(true);
    expect(chapters[0].skipReason).toBe("Empty chapter");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/epub/walk.test.ts`

Expected: all tests fail — module does not exist.

- [ ] **Step 3: Implement `lib/epub/walk.ts`**

Create `lib/epub/walk.ts`:

```ts
import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { htmlToMarkdown } from "@/lib/publish/html-to-markdown";
import { logger } from "@/lib/logger";
import type { EpubArchive } from "@/lib/epub/unzip";
import type { ParsedOpf } from "@/lib/epub/opf";
import type { ChapterDraft, NavEntry } from "@/lib/epub/types";

// Known limitation: anchor slicing assumes anchored elements are siblings
// inside <body>. If a real-world EPUB nests anchors under <section>/<div>
// wrappers, the walker will overshoot to end-of-body for the affected
// chapter. Documented in the spec's "Edge cases" section; revisit when
// users hit it on real books.

function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function makeDraft(opts: {
  title: string;
  body: string;
  href: string;
  source: "nav" | "spine";
}): ChapterDraft {
  const wordCount = countWords(opts.body);
  const empty = wordCount === 0;
  return {
    navTitle: opts.title,
    body: opts.body,
    wordCount,
    sourceHref: opts.href,
    source: opts.source,
    skippedByDefault: empty,
    ...(empty ? { skipReason: "Empty chapter" } : {}),
  };
}

/**
 * Group consecutive nav entries that point at the same file. Each group is
 * one document, and within it the entries' anchors define slice boundaries.
 *
 * - Group of 1 with no anchor → take whole body.
 * - Group of 1 with anchor → take from anchor to end-of-body.
 * - Group of N → for each entry, take from its anchor to (next entry's anchor
 *   in same group) or end-of-body if last.
 *
 * Cross-file boundary: if the immediately-next nav entry is in a different
 * file, the current entry's group ends here, so the slice runs to end-of-body
 * automatically.
 */
type FileGroup = {
  file: string;
  entries: Array<{ title: string; anchor?: string; href: string }>;
};

function groupByFile(nav: NavEntry[]): FileGroup[] {
  const groups: FileGroup[] = [];
  for (const e of nav) {
    const prev = groups[groups.length - 1];
    if (prev && prev.file === e.file) {
      prev.entries.push({ title: e.title, anchor: e.anchor, href: e.file });
    } else {
      groups.push({
        file: e.file,
        entries: [{ title: e.title, anchor: e.anchor, href: e.file }],
      });
    }
  }
  return groups;
}

function bodyHtml($: cheerio.CheerioAPI): string {
  const body = $("body").first();
  if (body.length === 0) return ""; // malformed XHTML → empty, will be skipped
  return body.html() ?? "";
}

/**
 * Walk siblings starting at `startNode` (inclusive), stopping at the element
 * with id === `endId` (exclusive). If `endId` is null, walks to the end of
 * the sibling chain. Returns serialised HTML of the collected nodes.
 *
 * If `startNode` is null, this falls back to the first child of `<body>` so
 * a leading anchorless entry in a multi-anchor group (e.g., a Prologue
 * before the first labeled <h1 id="ch1">) still produces content.
 */
function sliceFromNode(
  $: cheerio.CheerioAPI,
  startNode: AnyNode | null,
  endId: string | null
): string {
  let node: AnyNode | null = startNode ?? ($("body").children().first()[0] as AnyNode | undefined) ?? null;
  if (!node) return "";
  const collected: AnyNode[] = [];
  while (node) {
    if (endId && node.type === "tag" && (node as Element).attribs?.id === endId) {
      break;
    }
    collected.push(node);
    node = (node as AnyNode & { next: AnyNode | null }).next;
  }
  return collected.map((n) => $.html(n)).join("");
}

async function walkFromNav(
  archive: EpubArchive,
  nav: NavEntry[]
): Promise<ChapterDraft[]> {
  const groups = groupByFile(nav);
  const out: ChapterDraft[] = [];
  for (const group of groups) {
    if (!archive.has(group.file)) {
      logger.warn(`[epub/walk] nav target missing: ${group.file}`);
      continue;
    }
    const xml = await archive.readText(group.file);
    const $ = cheerio.load(xml, { xml: false });

    if (group.entries.length === 1 && !group.entries[0].anchor) {
      out.push(
        makeDraft({
          title: group.entries[0].title,
          body: htmlToMarkdown(bodyHtml($)),
          href: group.file,
          source: "nav",
        })
      );
      continue;
    }

    for (let i = 0; i < group.entries.length; i++) {
      const cur = group.entries[i];
      const next = group.entries[i + 1];
      const startNode: AnyNode | null = cur.anchor
        ? (($(`#${cur.anchor}`).first()[0] as AnyNode | undefined) ?? null)
        : null;
      const endId = next?.anchor ?? null;
      const slice = sliceFromNode($, startNode, endId);
      out.push(
        makeDraft({
          title: cur.title,
          body: htmlToMarkdown(slice),
          href: group.file,
          source: "nav",
        })
      );
    }
  }
  return out;
}

async function walkFromSpine(
  archive: EpubArchive,
  opf: ParsedOpf
): Promise<ChapterDraft[]> {
  const out: ChapterDraft[] = [];
  let nthChapter = 0;
  for (const idref of opf.spine) {
    const entry = opf.manifest.get(idref);
    if (!entry) continue;
    if (!archive.has(entry.href)) {
      logger.warn(`[epub/walk] spine target missing: ${entry.href}`);
      continue;
    }
    nthChapter += 1;
    const xml = await archive.readText(entry.href);
    const $ = cheerio.load(xml, { xml: false });
    const heading = $("h1").first().text().trim() || $("h2").first().text().trim();
    const title = heading || `Chapter ${nthChapter}`;
    out.push(
      makeDraft({
        title,
        body: htmlToMarkdown(bodyHtml($)),
        href: entry.href,
        source: "spine",
      })
    );
  }
  return out;
}

export async function walkChapters(
  archive: EpubArchive,
  opf: ParsedOpf,
  nav: NavEntry[]
): Promise<ChapterDraft[]> {
  if (nav.length > 0) return walkFromNav(archive, nav);
  return walkFromSpine(archive, opf);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/epub/walk.test.ts`

Expected: all tests pass. Anchor-slicing tests are the highest-risk — if `sliceFromNode` returns wrong content, eyeball the cheerio element traversal: the `node.type === "tag"` filter is needed because text nodes appear as siblings and we want to include them but not check their `attribs.id`.

- [ ] **Step 5: Verify typecheck passes**

Run: `npm run typecheck`

Expected: pass. The `cheerio.Element`/`AnyNode` imports come from `domhandler`, which is a transitive dep of cheerio and ships its own types. If `npm` failed to install `@types/domhandler` or domhandler doesn't expose the types directly, you may need `npm install --save-dev @types/domhandler` — but cheerio 1.0.0+ ships domhandler types directly so the explicit `@types/` package isn't usually needed.

- [ ] **Step 6: Commit**

```bash
git add lib/epub/walk.ts tests/lib/epub/walk.test.ts
git commit -m "feat(epub): chapter walker — nav-first with anchor slicing + spine fallback"
```

### Task 3.2: `boilerplate.ts` — denylist for default-skip

Pure function: takes an array of `ChapterDraft` and sets `skippedByDefault` + `skipReason` on entries whose `navTitle` matches the boilerplate regex. Does not filter — only flags.

**Files:**
- Create: `lib/epub/boilerplate.ts`
- Test: `tests/lib/epub/boilerplate.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/epub/boilerplate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { applyBoilerplateFlags } from "@/lib/epub/boilerplate";
import type { ChapterDraft } from "@/lib/epub/types";

function draft(navTitle: string): ChapterDraft {
  return {
    navTitle,
    body: "Some body text.",
    wordCount: 3,
    sourceHref: "OEBPS/x.xhtml",
    skippedByDefault: false,
    source: "nav",
  };
}

describe("applyBoilerplateFlags — denylist matches", () => {
  const cases: [string, string][] = [
    ["Copyright", "copyright"],
    ["Dedication", "dedication"],
    ["Acknowledgments", "acknowledg"],
    ["About the Author", "about the author"],
    ["Also by Jane Smith", "also by"],
    ["Table of Contents", "table of contents"],
    ["Title Page", "title page"],
    ["Other Works", "other works"],
    ["Cover", "cover"],
    ["Halftitle", "halftitle"],
    ["Frontmatter", "frontmatter"],
    ["Backmatter", "backmatter"],
    ["Imprint", "imprint"],
    ["Colophon", "colophon"],
  ];
  for (const [title, expectedReason] of cases) {
    it(`flags "${title}" with reason mentioning "${expectedReason}"`, () => {
      const out = applyBoilerplateFlags([draft(title)]);
      expect(out[0].skippedByDefault).toBe(true);
      expect(out[0].skipReason?.toLowerCase()).toContain(expectedReason);
    });
  }
});

describe("applyBoilerplateFlags — non-matches", () => {
  const titles = ["Chapter 1", "The Beginning", "Prologue", "Epilogue", "Part One"];
  for (const title of titles) {
    it(`does NOT flag "${title}"`, () => {
      const out = applyBoilerplateFlags([draft(title)]);
      expect(out[0].skippedByDefault).toBe(false);
      expect(out[0].skipReason).toBeUndefined();
    });
  }
});

describe("applyBoilerplateFlags — preserves prior skips", () => {
  it("keeps a prior skippedByDefault=true and its reason", () => {
    const ch = draft("Chapter 1");
    ch.skippedByDefault = true;
    ch.skipReason = "Empty chapter";
    const [out] = applyBoilerplateFlags([ch]);
    expect(out.skippedByDefault).toBe(true);
    expect(out.skipReason).toBe("Empty chapter");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/epub/boilerplate.test.ts`

Expected: all tests fail — module does not exist.

- [ ] **Step 3: Implement `lib/epub/boilerplate.ts`**

Create `lib/epub/boilerplate.ts`:

```ts
import type { ChapterDraft } from "@/lib/epub/types";

const BOILERPLATE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bcopyright\b/i, label: "copyright" },
  { pattern: /\bdedication\b/i, label: "dedication" },
  { pattern: /\backnowledg/i, label: "acknowledgments" },
  { pattern: /\babout the author\b/i, label: "about the author" },
  { pattern: /\balso by\b/i, label: "also by" },
  { pattern: /\btable of contents\b/i, label: "table of contents" },
  { pattern: /\btitle page\b/i, label: "title page" },
  { pattern: /\bother works\b/i, label: "other works" },
  { pattern: /^cover$/i, label: "cover" },
  { pattern: /\bhalftitle\b/i, label: "halftitle" },
  { pattern: /\bfrontmatter\b/i, label: "frontmatter" },
  { pattern: /\bbackmatter\b/i, label: "backmatter" },
  { pattern: /\bimprint\b/i, label: "imprint" },
  { pattern: /\bcolophon\b/i, label: "colophon" },
];

export function applyBoilerplateFlags(chapters: ChapterDraft[]): ChapterDraft[] {
  return chapters.map((ch) => {
    if (ch.skippedByDefault) return ch; // preserve prior flag (e.g. "Empty chapter")
    const title = ch.navTitle.trim();
    for (const { pattern, label } of BOILERPLATE_PATTERNS) {
      if (pattern.test(title)) {
        return {
          ...ch,
          skippedByDefault: true,
          skipReason: `Matched '${label}' rule`,
        };
      }
    }
    return ch;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/epub/boilerplate.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/epub/boilerplate.ts tests/lib/epub/boilerplate.test.ts
git commit -m "feat(epub): boilerplate denylist for default-skip flagging"
```

---

## Chunk 4: lib/epub — cover, cache, mapping, and orchestrator

This chunk completes the parse pipeline by adding the cover extractor (4.1), the in-memory bridge between parse and commit (4.2), the `ParsedEpub → ProposedWrite` mapper (4.3), and the top-level orchestrator (4.4). After this chunk, `parseEpub(buf)` returns a fully-shaped result the API routes can hand to the UI.

### Task 4.1: `cover.ts` — cover bytes + magic-byte mime sniff

Given a parsed OPF + the archive, returns `{mimeType, bytes}` or `null`. Magic-byte sniff doesn't trust the OPF's `mediaType` field.

**Files:**
- Create: `lib/epub/cover.ts`
- Test: `tests/lib/epub/cover.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/epub/cover.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { openEpubArchive } from "@/lib/epub/unzip";
import { findOpfPath, parseOpf } from "@/lib/epub/opf";
import { extractCover, sniffMime } from "@/lib/epub/cover";

const FIXTURE_DIR = join(__dirname, "..", "..", "..", "lib", "epub", "__fixtures__");

describe("sniffMime", () => {
  it("identifies JPEG via FF D8 FF", () => {
    expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe("image/jpeg");
  });

  it("identifies PNG via 89 50 4E 47", () => {
    expect(sniffMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe("image/png");
  });

  it("identifies WebP via RIFF....WEBP", () => {
    const bytes = new Uint8Array(12);
    bytes.set([0x52, 0x49, 0x46, 0x46], 0);
    bytes.set([0x57, 0x45, 0x42, 0x50], 8);
    expect(sniffMime(bytes)).toBe("image/webp");
  });

  it("returns octet-stream for unknown bytes", () => {
    expect(sniffMime(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBe("application/octet-stream");
  });

  it("returns octet-stream for too-short input", () => {
    expect(sniffMime(new Uint8Array([0xff, 0xd8]))).toBe("application/octet-stream");
  });
});

describe("extractCover", () => {
  async function loadOpf(fixture: string) {
    const buf = await readFile(join(FIXTURE_DIR, fixture));
    const archive = await openEpubArchive(buf);
    const opfPath = await findOpfPath(archive);
    const opf = parseOpf(await archive.readText(opfPath), opfPath);
    return { archive, opf };
  }

  it("returns PNG cover from KDP fixture (cover-image property)", async () => {
    const { archive, opf } = await loadOpf("sample-kdp.epub");
    const cover = await extractCover(archive, opf);
    expect(cover).not.toBeNull();
    expect(cover!.mimeType).toBe("image/png");
    expect(cover!.bytes.byteLength).toBeGreaterThan(0);
  });

  it("returns JPEG cover from Smashwords fixture (<meta name=cover>)", async () => {
    const { archive, opf } = await loadOpf("sample-smashwords.epub");
    const cover = await extractCover(archive, opf);
    expect(cover).not.toBeNull();
    expect(cover!.mimeType).toBe("image/jpeg");
  });

  it("returns null when coverManifestId is null", async () => {
    const { archive, opf } = await loadOpf("sample-nonav.epub");
    expect(opf.coverManifestId).toBeNull();
    const cover = await extractCover(archive, opf);
    expect(cover).toBeNull();
  });

  it("returns null when manifest entry exists but file is missing", async () => {
    const { opf } = await loadOpf("sample-kdp.epub");
    const fakeArchive = {
      has: () => false,
      readText: async () => "",
      readBytes: async () => new Uint8Array(),
      paths: () => [],
    };
    const cover = await extractCover(fakeArchive, opf);
    expect(cover).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/epub/cover.test.ts`

Expected: all tests fail — module does not exist.

- [ ] **Step 3: Implement `lib/epub/cover.ts`**

Create `lib/epub/cover.ts`:

```ts
import type { EpubArchive } from "@/lib/epub/unzip";
import type { ParsedOpf } from "@/lib/epub/opf";

export function sniffMime(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return "application/octet-stream";
}

export async function extractCover(
  archive: EpubArchive,
  opf: ParsedOpf
): Promise<{ mimeType: string; bytes: Uint8Array } | null> {
  if (!opf.coverManifestId) return null;
  const entry = opf.manifest.get(opf.coverManifestId);
  if (!entry) return null;
  if (!archive.has(entry.href)) return null;
  const bytes = await archive.readBytes(entry.href);
  return { mimeType: sniffMime(bytes), bytes };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/epub/cover.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/epub/cover.ts tests/lib/epub/cover.test.ts
git commit -m "feat(epub): extract cover bytes + magic-byte mime sniff"
```

### Task 4.2: `cover-cache.ts` — in-memory bridge between parse and commit

Trivial Map+TTL store. The parse route caches raw cover bytes here; the commit route retrieves them by `sessionId`.

**Files:**
- Create: `lib/epub/cover-cache.ts`
- Test: `tests/lib/epub/cover-cache.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/epub/cover-cache.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { putCover, getCover, deleteCover, _resetCacheForTests } from "@/lib/epub/cover-cache";

beforeEach(() => {
  _resetCacheForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("cover-cache", () => {
  it("stores and retrieves bytes by sessionId", () => {
    const id = putCover({ mimeType: "image/png", bytes: new Uint8Array([1, 2, 3]) });
    const got = getCover(id);
    expect(got?.mimeType).toBe("image/png");
    expect(Array.from(got!.bytes)).toEqual([1, 2, 3]);
  });

  it("returns undefined for missing sessionId", () => {
    expect(getCover("nope")).toBeUndefined();
  });

  it("deleteCover removes the entry", () => {
    const id = putCover({ mimeType: "image/jpeg", bytes: new Uint8Array([1]) });
    deleteCover(id);
    expect(getCover(id)).toBeUndefined();
  });

  it("evicts entries past the 10-minute TTL", () => {
    vi.useFakeTimers();
    const start = Date.now();
    vi.setSystemTime(start);
    const id = putCover({ mimeType: "image/jpeg", bytes: new Uint8Array([1]) });
    vi.setSystemTime(start + 9 * 60 * 1000);
    expect(getCover(id)).toBeDefined();
    vi.setSystemTime(start + 10 * 60 * 1000 + 1);
    expect(getCover(id)).toBeUndefined();
  });

  it("single-entry cap: a second putCover replaces the first", () => {
    const id1 = putCover({ mimeType: "image/png", bytes: new Uint8Array([1]) });
    const id2 = putCover({ mimeType: "image/jpeg", bytes: new Uint8Array([2]) });
    expect(getCover(id1)).toBeUndefined();
    expect(getCover(id2)).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/epub/cover-cache.test.ts`

Expected: all tests fail — module does not exist.

- [ ] **Step 3: Implement `lib/epub/cover-cache.ts`**

Create `lib/epub/cover-cache.ts`:

```ts
import { randomUUID } from "node:crypto";

const TTL_MS = 10 * 60 * 1000;

type Entry = {
  mimeType: string;
  bytes: Uint8Array;
  expiresAt: number;
};

let current: { id: string; entry: Entry } | null = null;

export function putCover(input: { mimeType: string; bytes: Uint8Array }): string {
  const id = randomUUID();
  current = {
    id,
    entry: {
      mimeType: input.mimeType,
      bytes: input.bytes,
      expiresAt: Date.now() + TTL_MS,
    },
  };
  return id;
}

export function getCover(id: string): { mimeType: string; bytes: Uint8Array } | undefined {
  if (!current || current.id !== id) return undefined;
  if (Date.now() > current.entry.expiresAt) {
    current = null;
    return undefined;
  }
  return { mimeType: current.entry.mimeType, bytes: current.entry.bytes };
}

export function deleteCover(id: string): void {
  if (current && current.id === id) current = null;
}

/** Test-only helper to clear the singleton between tests. */
export function _resetCacheForTests(): void {
  current = null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/epub/cover-cache.test.ts`

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/epub/cover-cache.ts tests/lib/epub/cover-cache.test.ts
git commit -m "feat(epub): in-memory cover cache (10-min TTL, single-entry)"
```

### Task 4.3: `map.ts` — ParsedEpub → ProposedWrite

Builds the UI's preview shape: title/description/keywords, pen-name auto-match against profiles, empty Bible defaults, and pass-through of cover + chapter drafts.

**Files:**
- Create: `lib/epub/map.ts`
- Test: `tests/lib/epub/map.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/epub/map.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mapToProposedWrite } from "@/lib/epub/map";
import type { ParsedEpub } from "@/lib/epub/types";
import type { PenNameProfile } from "@/lib/config";

function fakeParsed(over: Partial<ParsedEpub> = {}): ParsedEpub {
  return {
    metadata: {
      title: "Test Book",
      creator: "Jane Author",
      description: "<p>A <em>test</em> book.</p>",
      subjects: ["FIC027010", "  ", "romance"],
      language: "en",
    },
    cover: null,
    chapters: [],
    epubVersion: 3,
    ...over,
  };
}

const profiles: Record<string, PenNameProfile> = {
  "Jane Author": { displayName: "Jane Author" } as unknown as PenNameProfile,
};

describe("mapToProposedWrite — story metadata", () => {
  it("trims title and passes it through", () => {
    const out = mapToProposedWrite(fakeParsed({ metadata: { title: "  Test Book  ", creator: "", description: "", subjects: [], language: "en" } }), {});
    expect(out.story.title).toBe("Test Book");
  });

  it("converts description HTML to markdown via htmlToMarkdown", () => {
    const out = mapToProposedWrite(fakeParsed(), {});
    expect(out.story.description).toBe("A *test* book.");
  });

  it("drops empty keyword entries", () => {
    const out = mapToProposedWrite(fakeParsed(), {});
    expect(out.story.keywords).toEqual(["FIC027010", "romance"]);
  });
});

describe("mapToProposedWrite — pen-name match", () => {
  it("exact match", () => {
    const out = mapToProposedWrite(fakeParsed(), profiles);
    expect(out.story.authorPenName).toBe("Jane Author");
    expect(out.penNameMatch).toBe("exact");
  });

  it("case-insensitive match uses the profile's casing", () => {
    const out = mapToProposedWrite(
      fakeParsed({ metadata: { title: "X", creator: "JANE AUTHOR", description: "", subjects: [], language: "en" } }),
      profiles
    );
    expect(out.story.authorPenName).toBe("Jane Author");
    expect(out.penNameMatch).toBe("case-insensitive");
  });

  it("no match returns empty string + 'none'", () => {
    const out = mapToProposedWrite(
      fakeParsed({ metadata: { title: "X", creator: "Stranger", description: "", subjects: [], language: "en" } }),
      profiles
    );
    expect(out.story.authorPenName).toBe("");
    expect(out.penNameMatch).toBe("none");
  });

  it("empty creator returns empty + 'none' (no spurious match against empty profile key)", () => {
    const out = mapToProposedWrite(
      fakeParsed({ metadata: { title: "X", creator: "", description: "", subjects: [], language: "en" } }),
      profiles
    );
    expect(out.story.authorPenName).toBe("");
    expect(out.penNameMatch).toBe("none");
  });
});

describe("mapToProposedWrite — empty Bible defaults", () => {
  it("returns the documented empty Bible shape", () => {
    const out = mapToProposedWrite(fakeParsed(), {});
    expect(out.bible).toEqual({
      characters: [],
      setting: "",
      pov: "third-limited",
      tone: "",
      styleNotes: "",
      nsfwPreferences: "",
    });
  });
});

describe("mapToProposedWrite — pass-through", () => {
  it("passes cover and chapters through untouched", () => {
    const cover = { mimeType: "image/png", bytes: new Uint8Array([1]) };
    const chapters = [
      { navTitle: "Ch1", body: "x", wordCount: 1, sourceHref: "x.xhtml", skippedByDefault: false, source: "nav" as const },
    ];
    const out = mapToProposedWrite(fakeParsed({ cover, chapters }), {});
    expect(out.cover).toBe(cover);
    expect(out.chapters).toBe(chapters);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/epub/map.test.ts`

Expected: all tests fail — module does not exist.

- [ ] **Step 3: Implement `lib/epub/map.ts`**

Create `lib/epub/map.ts`:

```ts
import { htmlToMarkdown } from "@/lib/publish/html-to-markdown";
import type { Bible } from "@/lib/types";
import type { PenNameProfile } from "@/lib/config";
import type { ParsedEpub, ProposedWrite, PenNameMatch } from "@/lib/epub/types";

// Exported so Chunk 5's commit route can reuse the same empty-bible shape.
// Single source of truth — never duplicate this elsewhere.
export const EMPTY_BIBLE: Bible = {
  characters: [],
  setting: "",
  pov: "third-limited",
  tone: "",
  styleNotes: "",
  nsfwPreferences: "",
};

function matchPenName(
  creator: string,
  profiles: Record<string, PenNameProfile>
): { authorPenName: string; penNameMatch: PenNameMatch } {
  const trimmed = creator.trim();
  if (!trimmed) return { authorPenName: "", penNameMatch: "none" };
  if (profiles[trimmed]) return { authorPenName: trimmed, penNameMatch: "exact" };
  const lower = trimmed.toLowerCase();
  for (const key of Object.keys(profiles)) {
    if (key.toLowerCase() === lower) {
      return { authorPenName: key, penNameMatch: "case-insensitive" };
    }
  }
  return { authorPenName: "", penNameMatch: "none" };
}

export function mapToProposedWrite(
  parsed: ParsedEpub,
  profiles: Record<string, PenNameProfile>
): ProposedWrite {
  const description = parsed.metadata.description
    ? htmlToMarkdown(parsed.metadata.description).trim()
    : "";
  const keywords = parsed.metadata.subjects
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const { authorPenName, penNameMatch } = matchPenName(parsed.metadata.creator, profiles);

  return {
    story: {
      title: parsed.metadata.title.trim(),
      description,
      keywords,
      authorPenName,
    },
    bible: { ...EMPTY_BIBLE },
    cover: parsed.cover,
    chapters: parsed.chapters,
    penNameMatch,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/epub/map.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/epub/map.ts tests/lib/epub/map.test.ts
git commit -m "feat(epub): map ParsedEpub to ProposedWrite (pen-name match, empty Bible)"
```

### Task 4.4: `parse.ts` — top-level orchestrator

The single entry point for the parse route. Composes everything: size cap → DRM check → unzip → opf → nav → walk → boilerplate → cover. Returns `ParsedEpub` or throws `EpubParseError`.

**Files:**
- Create: `lib/epub/parse.ts`
- Test: `tests/lib/epub/parse.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/epub/parse.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseEpub } from "@/lib/epub/parse";
import { EpubParseError } from "@/lib/epub/types";

const FIXTURE_DIR = join(__dirname, "..", "..", "..", "lib", "epub", "__fixtures__");

describe("parseEpub — happy paths", () => {
  it("KDP fixture: 6 chapters, EPUB3, cover present, boilerplate flagged", async () => {
    const buf = await readFile(join(FIXTURE_DIR, "sample-kdp.epub"));
    const parsed = await parseEpub(buf);
    expect(parsed.epubVersion).toBe(3);
    expect(parsed.chapters).toHaveLength(6);
    expect(parsed.cover?.mimeType).toBe("image/png");
    const flagged = parsed.chapters.filter((c) => c.skippedByDefault);
    expect(flagged.map((c) => c.navTitle)).toEqual([
      "Copyright",
      "Title Page",
      "About the Author",
    ]);
  });

  it("Smashwords fixture: 2 chapters, EPUB2, JPEG cover", async () => {
    const buf = await readFile(join(FIXTURE_DIR, "sample-smashwords.epub"));
    const parsed = await parseEpub(buf);
    expect(parsed.epubVersion).toBe(2);
    expect(parsed.chapters).toHaveLength(2);
    expect(parsed.cover?.mimeType).toBe("image/jpeg");
  });

  it("No-Nav fixture: spine fallback, source=spine", async () => {
    const buf = await readFile(join(FIXTURE_DIR, "sample-nonav.epub"));
    const parsed = await parseEpub(buf);
    expect(parsed.chapters).toHaveLength(2);
    expect(parsed.chapters.every((c) => c.source === "spine")).toBe(true);
  });
});

describe("parseEpub — error conditions", () => {
  it("rejects oversized files", async () => {
    const buf = Buffer.alloc(50 * 1024 * 1024 + 1);
    await expect(parseEpub(buf)).rejects.toMatchObject({
      userMessage: "File too large (limit 50MB).",
    });
  });

  it("rejects empty buffer", async () => {
    await expect(parseEpub(Buffer.alloc(0))).rejects.toMatchObject({
      userMessage: "No file uploaded.",
    });
  });

  it("rejects DRM-encrypted EPUB (encryption.xml with non-font algorithm)", async () => {
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
    zip.file(
      "META-INF/container.xml",
      `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
    );
    zip.file(
      "META-INF/encryption.xml",
      `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/></EncryptedData></encryption>`
    );
    zip.file("OEBPS/content.opf", "<package version='3.0'/>");
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    await expect(parseEpub(buf)).rejects.toMatchObject({
      userMessage: "This EPUB is DRM-protected and cannot be imported.",
    });
  });

  it("ALLOWS encryption.xml for Adobe font obfuscation only", async () => {
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
    zip.file(
      "META-INF/container.xml",
      `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
    );
    zip.file(
      "META-INF/encryption.xml",
      `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData><EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/></EncryptedData></encryption>`
    );
    // Re-use real fixture content to avoid building a full OPF here.
    const realBuf = await readFile(join(FIXTURE_DIR, "sample-kdp.epub"));
    const real = await JSZip.loadAsync(realBuf);
    for (const path of Object.keys(real.files)) {
      if (path === "mimetype" || path.startsWith("META-INF/")) continue;
      const f = real.file(path);
      if (!f) continue;
      zip.file(path, await f.async("uint8array"));
    }
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    // Should NOT throw — font obfuscation is permitted.
    const parsed = await parseEpub(buf);
    expect(parsed.chapters.length).toBeGreaterThan(0);
  });

  it("rejects non-EPUB zip (no container.xml)", async () => {
    const zip = new JSZip();
    zip.file("hello.txt", "world");
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    await expect(parseEpub(buf)).rejects.toMatchObject({
      userMessage: "Missing container.xml — not an EPUB.",
    });
  });

  it("rejects when chapter walk produces zero entries", async () => {
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
    zip.file(
      "META-INF/container.xml",
      `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
    );
    zip.file(
      "OEBPS/content.opf",
      `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Empty</dc:title></metadata><manifest/><spine/></package>`
    );
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    await expect(parseEpub(buf)).rejects.toMatchObject({
      userMessage: "This EPUB has no readable content (empty spine).",
    });
  });

  it("rejects EPUBs with more than 200 chapters", async () => {
    // Build a synthetic OPF with 201 spine items.
    const items: string[] = [];
    const itemrefs: string[] = [];
    for (let i = 0; i < 201; i++) {
      items.push(`<item id="ch${i}" href="ch${i}.xhtml" media-type="application/xhtml+xml"/>`);
      itemrefs.push(`<itemref idref="ch${i}"/>`);
    }
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
    zip.file(
      "META-INF/container.xml",
      `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
    );
    zip.file(
      "OEBPS/content.opf",
      `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Big</dc:title></metadata><manifest>${items.join("")}</manifest><spine>${itemrefs.join("")}</spine></package>`
    );
    for (let i = 0; i < 201; i++) {
      zip.file(
        `OEBPS/ch${i}.xhtml`,
        `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><p>x</p></body></html>`
      );
    }
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    await expect(parseEpub(buf)).rejects.toMatchObject({
      userMessage: "This EPUB has more than 200 chapters — please split it before importing.",
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/epub/parse.test.ts`

Expected: all tests fail — module does not exist.

- [ ] **Step 3: Implement `lib/epub/parse.ts`**

Create `lib/epub/parse.ts`:

```ts
import { XMLParser } from "fast-xml-parser";
import { openEpubArchive } from "@/lib/epub/unzip";
import { findOpfPath, parseOpf } from "@/lib/epub/opf";
import { parseNav } from "@/lib/epub/nav";
import { walkChapters } from "@/lib/epub/walk";
import { applyBoilerplateFlags } from "@/lib/epub/boilerplate";
import { extractCover } from "@/lib/epub/cover";
import { EpubParseError } from "@/lib/epub/types";
import type { ParsedEpub } from "@/lib/epub/types";

const MAX_BYTES = 50 * 1024 * 1024;
const MAX_CHAPTERS = 200;
// Adobe font-obfuscation algorithm is not real DRM and shouldn't trigger
// rejection. Anything else in encryption.xml means real encryption.
const FONT_OBFUSCATION_ALGS = new Set([
  "http://www.idpf.org/2008/embedding",
  "http://ns.adobe.com/pdf/enc#RC",
]);

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => ["EncryptedData"].includes(name),
});

function checkEncryption(xml: string): "ok" | "drm" {
  const parsed = xmlParser.parse(xml) as Record<string, unknown>;
  const enc = parsed["encryption"] as Record<string, unknown> | undefined;
  if (!enc) return "ok";
  const items = (enc["EncryptedData"] ?? []) as Array<Record<string, unknown>>;
  if (items.length === 0) return "ok";
  for (const item of items) {
    const method = item["EncryptionMethod"] as Record<string, unknown> | undefined;
    const alg = method?.["@_Algorithm"] as string | undefined;
    if (!alg || !FONT_OBFUSCATION_ALGS.has(alg)) {
      return "drm";
    }
  }
  return "ok";
}

export async function parseEpub(buf: Buffer): Promise<ParsedEpub> {
  if (buf.byteLength === 0) throw new EpubParseError("No file uploaded.");
  if (buf.byteLength > MAX_BYTES) throw new EpubParseError("File too large (limit 50MB).");

  const archive = await openEpubArchive(buf);

  // DRM check before any parsing work.
  if (archive.has("META-INF/encryption.xml")) {
    const xml = await archive.readText("META-INF/encryption.xml");
    if (checkEncryption(xml) === "drm") {
      throw new EpubParseError("This EPUB is DRM-protected and cannot be imported.");
    }
  }

  const opfPath = await findOpfPath(archive);
  const opfXml = await archive.readText(opfPath);
  const opf = parseOpf(opfXml, opfPath);

  if (opf.spine.length === 0) {
    throw new EpubParseError("This EPUB has no readable content (empty spine).");
  }
  if (opf.spine.length > MAX_CHAPTERS) {
    throw new EpubParseError(
      "This EPUB has more than 200 chapters — please split it before importing."
    );
  }

  const nav = await parseNav(archive, opf);
  const rawChapters = await walkChapters(archive, opf, nav);

  if (rawChapters.length === 0) {
    throw new EpubParseError("No chapters with prose were found in this EPUB.");
  }
  if (rawChapters.length > MAX_CHAPTERS) {
    throw new EpubParseError(
      "This EPUB has more than 200 chapters — please split it before importing."
    );
  }

  const chapters = applyBoilerplateFlags(rawChapters);
  const cover = await extractCover(archive, opf);

  return {
    metadata: opf.metadata,
    cover,
    chapters,
    epubVersion: opf.epubVersion,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/epub/parse.test.ts`

Expected: all 8 tests pass.

- [ ] **Step 5: Sanity-check the full lib/epub/ test suite + typecheck + lint**

Run: `npx vitest run tests/lib/epub/ && npm run typecheck && npm run lint`

Expected: all tests across all 8 test files pass; tsc finds no type errors; eslint reports no new warnings or errors. No flakiness, no skipped tests. This is the first point in the build where the parse pipeline is fully wired end-to-end, so cross-module type contracts must be sound before moving to API routes.

- [ ] **Step 6: Commit**

```bash
git add lib/epub/parse.ts tests/lib/epub/parse.test.ts
git commit -m "feat(epub): top-level parseEpub orchestrator with DRM + size + chapter caps"
```

---

## Chunk 5: API routes + privacy egress test

This chunk wires `parseEpub` to two HTTP endpoints and adds them to the load-bearing privacy test. After this chunk, the importer is fully usable from `curl` even before the UI is built — useful for manual smoke testing.

**API contract** (verbatim from spec, single source of truth):

```ts
// POST /api/import/epub/parse  (multipart/form-data, field: file)
type ParseOk = {
  ok: true;
  data: {
    parsed: ParsedEpubLite;     // ParsedEpub minus cover.bytes
    proposed: ProposedWriteLite; // ProposedWrite minus cover.bytes
    coverPreview: string | null; // data: URL of ≤300px-wide JPEG thumb
    sessionId: string;           // cover-cache key for commit
  };
};

// POST /api/import/epub/commit  (application/json)
type CommitRequest = {
  sessionId: string | null;
  story: { title: string; description: string; keywords: string[]; authorPenName: string };
  importCover: boolean;
  chapters: Array<{ title: string; body: string }>;
};
type CommitOk = { ok: true; data: { slug: string; chapterIds: string[] } };
```

The "Lite" suffixes mean the same shape with the `cover` field replaced by a presence flag (`hasCover: boolean`) so the client knows whether to render a cover thumbnail. Bytes never travel over the wire — they round-trip through the in-memory `cover-cache`.

### Task 5.1: Parse route

**Files:**
- Create: `app/api/import/epub/parse/route.ts`
- Test: `tests/api/import-epub-parse.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/api/import-epub-parse.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { POST } from "@/app/api/import/epub/parse/route";
import { _resetCacheForTests, getCover } from "@/lib/epub/cover-cache";

const FIXTURE_DIR = join(__dirname, "..", "..", "lib", "epub", "__fixtures__");

beforeEach(() => {
  _resetCacheForTests();
});

function makeRequest(buf: Buffer | null, filename = "book.epub"): Request {
  if (!buf) {
    return new Request("http://localhost/api/import/epub/parse", { method: "POST" });
  }
  const form = new FormData();
  form.set("file", new File([new Uint8Array(buf)], filename, { type: "application/epub+zip" }));
  return new Request("http://localhost/api/import/epub/parse", { method: "POST", body: form });
}

async function readBody<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe("POST /api/import/epub/parse — happy path (KDP fixture)", () => {
  it("returns parsed metadata, proposed write, and a sessionId", async () => {
    const buf = await readFile(join(FIXTURE_DIR, "sample-kdp.epub"));
    const res = await POST(makeRequest(buf) as never);
    expect(res.status).toBe(200);
    const body = await readBody<{ ok: true; data: { parsed: { metadata: { title: string; subjects: string[] } }; proposed: { story: { title: string; keywords: string[] }; chapters: Array<{ navTitle: string; skippedByDefault: boolean }> }; coverPreview: string | null; sessionId: string } }>(res);
    expect(body.ok).toBe(true);
    expect(body.data.parsed.metadata.title).toBe("The Garden Wall");
    expect(body.data.parsed.metadata.subjects).toEqual(["FIC027010", "romance"]);
    expect(body.data.proposed.story.title).toBe("The Garden Wall");
    expect(body.data.proposed.chapters.filter((c) => c.skippedByDefault)).toHaveLength(3);
    expect(typeof body.data.sessionId).toBe("string");
    expect(body.data.sessionId.length).toBeGreaterThan(0);
  });

  it("populates coverPreview as a data URL and stores raw bytes in cover-cache", async () => {
    const buf = await readFile(join(FIXTURE_DIR, "sample-kdp.epub"));
    const res = await POST(makeRequest(buf) as never);
    const body = await readBody<{ ok: true; data: { coverPreview: string | null; sessionId: string } }>(res);
    expect(body.data.coverPreview).toMatch(/^data:image\/jpeg;base64,/);
    const cached = getCover(body.data.sessionId);
    expect(cached).toBeDefined();
    expect(cached!.mimeType).toBe("image/png");
  });

  it("strips cover.bytes from the JSON response (replaced by hasCover flag)", async () => {
    const buf = await readFile(join(FIXTURE_DIR, "sample-kdp.epub"));
    const res = await POST(makeRequest(buf) as never);
    const json = await res.text();
    // Raw bytes would appear as a base64-ish substring or numeric array; assert it's absent.
    expect(json).not.toMatch(/"bytes":\[\d/);
    const body = JSON.parse(json) as { ok: true; data: { parsed: { hasCover: boolean }; proposed: { hasCover: boolean } } };
    expect(body.data.parsed.hasCover).toBe(true);
    expect(body.data.proposed.hasCover).toBe(true);
  });
});

describe("POST /api/import/epub/parse — no-cover fixture", () => {
  it("returns coverPreview: null, hasCover: false, and an empty sessionId", async () => {
    const buf = await readFile(join(FIXTURE_DIR, "sample-nonav.epub"));
    const res = await POST(makeRequest(buf) as never);
    expect(res.status).toBe(200);
    const body = await readBody<{ ok: true; data: { coverPreview: string | null; sessionId: string; parsed: { hasCover: boolean } } }>(res);
    expect(body.data.coverPreview).toBeNull();
    expect(body.data.parsed.hasCover).toBe(false);
    // No cover → empty sessionId. Commit accepts either "" or null.
    expect(body.data.sessionId).toBe("");
  });
});

describe("POST /api/import/epub/parse — error responses", () => {
  it("400 when no file uploaded", async () => {
    const res = await POST(makeRequest(null) as never);
    expect(res.status).toBe(400);
    const body = await readBody<{ ok: false; error: string }>(res);
    expect(body.error).toBe("No file uploaded.");
  });

  it("400 when file is not a valid EPUB", async () => {
    const res = await POST(makeRequest(Buffer.from("not a zip")) as never);
    expect(res.status).toBe(400);
    const body = await readBody<{ ok: false; error: string }>(res);
    expect(body.error).toMatch(/not a valid EPUB/);
  });

  it("400 when file exceeds 50 MB cap", async () => {
    const big = Buffer.alloc(50 * 1024 * 1024 + 1);
    const res = await POST(makeRequest(big) as never);
    expect(res.status).toBe(400);
    const body = await readBody<{ ok: false; error: string }>(res);
    expect(body.error).toBe("File too large (limit 50MB).");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/api/import-epub-parse.test.ts`

Expected: all tests fail — route module does not exist.

- [ ] **Step 3: Implement `app/api/import/epub/parse/route.ts`**

Create `app/api/import/epub/parse/route.ts`:

```ts
import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api";
import { effectiveDataDir, loadConfig } from "@/lib/config";
import { parseEpub } from "@/lib/epub/parse";
import { mapToProposedWrite } from "@/lib/epub/map";
import { putCover } from "@/lib/epub/cover-cache";
import { EpubParseError } from "@/lib/epub/types";
import { logger } from "@/lib/logger";
import sharp from "sharp";

const PREVIEW_MAX_WIDTH = 300;

async function makeCoverPreview(bytes: Uint8Array): Promise<string | null> {
  try {
    const jpegBuf = await sharp(Buffer.from(bytes))
      .rotate()
      .resize({ width: PREVIEW_MAX_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toBuffer();
    return `data:image/jpeg;base64,${jpegBuf.toString("base64")}`;
  } catch (err) {
    logger.warn("[epub/parse] cover preview encode failed", err instanceof Error ? err.message : String(err));
    return null;
  }
}

// Note: req.formData() buffers the entire upload into memory before parseEpub's
// 50MB cap can reject it. We accept this for a single-user local app — a
// malicious 5GB upload would OOM, but there is no untrusted client here.

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("No file uploaded.", 400);
  }

  const fileEntry = form.get("file");
  if (
    fileEntry === null ||
    typeof fileEntry !== "object" ||
    typeof (fileEntry as { arrayBuffer?: unknown }).arrayBuffer !== "function"
  ) {
    return fail("No file uploaded.", 400);
  }
  const fileLike = fileEntry as { arrayBuffer(): Promise<ArrayBuffer> };
  const buf = Buffer.from(await fileLike.arrayBuffer());

  let parsed;
  try {
    parsed = await parseEpub(buf);
  } catch (err) {
    if (err instanceof EpubParseError) return fail(err.userMessage, 400);
    logger.error("[epub/parse] unexpected error", err instanceof Error ? err.message : String(err));
    return fail("Could not read this EPUB.", 400);
  }

  const config = await loadConfig(effectiveDataDir()).catch(() => null);
  const profiles = config?.penNameProfiles ?? {};
  const proposed = mapToProposedWrite(parsed, profiles);

  // Cache cover bytes server-side; return a small preview + sessionId for commit.
  // When there's no cover, sessionId is "" — commit treats null/empty the same.
  let sessionId = "";
  let coverPreview: string | null = null;
  if (parsed.cover) {
    sessionId = putCover(parsed.cover);
    coverPreview = await makeCoverPreview(parsed.cover.bytes);
  }

  // Lite shape: replace `cover` with `hasCover` flag so raw bytes never go
  // over the wire. proposed.cover === parsed.cover (pure pass-through), so
  // a single hasCover at the top level would suffice — emitting it on both
  // shapes lets the UI read whichever is convenient without coupling to that.
  const parsedLite = {
    metadata: parsed.metadata,
    chapters: parsed.chapters,
    epubVersion: parsed.epubVersion,
    hasCover: parsed.cover !== null,
  };
  const proposedLite = {
    story: proposed.story,
    bible: proposed.bible,
    chapters: proposed.chapters,
    penNameMatch: proposed.penNameMatch,
    hasCover: proposed.cover !== null,
  };

  return ok({ parsed: parsedLite, proposed: proposedLite, coverPreview, sessionId });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/api/import-epub-parse.test.ts`

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/import/epub/parse/route.ts tests/api/import-epub-parse.test.ts
git commit -m "feat(epub): POST /api/import/epub/parse — multipart upload to preview JSON"
```

### Task 5.2: Commit route

**Files:**
- Create: `app/api/import/epub/commit/route.ts`
- Test: `tests/api/import-epub-commit.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/api/import-epub-commit.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { POST as commitPost } from "@/app/api/import/epub/commit/route";
import { POST as parsePost } from "@/app/api/import/epub/parse/route";
import { _resetCacheForTests, putCover } from "@/lib/epub/cover-cache";
import { effectiveDataDir } from "@/lib/config";
import { storyJson, bibleJson, coverPath } from "@/lib/storage/paths";

const FIXTURE_DIR = join(__dirname, "..", "..", "lib", "epub", "__fixtures__");

let dataDir: string;
let originalEnv: string | undefined;

beforeEach(async () => {
  _resetCacheForTests();
  dataDir = await mkdtemp(join(tmpdir(), "scriptr-epub-commit-"));
  originalEnv = process.env.SCRIPTR_DATA_DIR;
  process.env.SCRIPTR_DATA_DIR = dataDir;
  // Sanity: effectiveDataDir() should now be dataDir.
  expect(effectiveDataDir()).toBe(dataDir);
});

afterEach(async () => {
  if (originalEnv === undefined) delete process.env.SCRIPTR_DATA_DIR;
  else process.env.SCRIPTR_DATA_DIR = originalEnv;
  await rm(dataDir, { recursive: true, force: true });
});

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/import/epub/commit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readBody<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe("POST /api/import/epub/commit — happy path", () => {
  it("creates story, bible, chapters, and cover from a parsed EPUB", async () => {
    // First call parse to populate cover-cache + get a sessionId.
    const epubBuf = await readFile(join(FIXTURE_DIR, "sample-kdp.epub"));
    const form = new FormData();
    form.set("file", new File([new Uint8Array(epubBuf)], "book.epub", { type: "application/epub+zip" }));
    const parseRes = await parsePost(new Request("http://localhost/api/import/epub/parse", { method: "POST", body: form }) as never);
    const parseBody = await readBody<{ data: { sessionId: string; proposed: { story: { title: string; description: string; keywords: string[]; authorPenName: string }; chapters: Array<{ navTitle: string; body: string; skippedByDefault: boolean }> } } }>(parseRes);
    const proposed = parseBody.data.proposed;
    const chaptersToCommit = proposed.chapters.filter((c) => !c.skippedByDefault).map((c) => ({ title: c.navTitle, body: c.body }));

    const res = await commitPost(jsonRequest({
      sessionId: parseBody.data.sessionId,
      story: proposed.story,
      importCover: true,
      chapters: chaptersToCommit,
    }) as never);
    expect(res.status).toBe(200);
    const body = await readBody<{ ok: true; data: { slug: string; chapterIds: string[] } }>(res);
    expect(body.ok).toBe(true);
    expect(body.data.slug).toMatch(/garden/);
    expect(body.data.chapterIds).toHaveLength(3);

    // Story file written
    const storyRaw = await readFile(storyJson(dataDir, body.data.slug), "utf-8");
    const story = JSON.parse(storyRaw) as { title: string; description: string; keywords: string[]; chapterOrder: string[] };
    expect(story.title).toBe("The Garden Wall");
    expect(story.chapterOrder).toEqual(body.data.chapterIds);

    // Bible written with documented empty defaults
    const bible = JSON.parse(await readFile(bibleJson(dataDir, body.data.slug), "utf-8")) as { pov: string; characters: unknown[] };
    expect(bible.pov).toBe("third-limited");
    expect(bible.characters).toEqual([]);

    // Cover written — JPEG bytes, non-zero
    const coverStat = await stat(coverPath(dataDir, body.data.slug));
    expect(coverStat.size).toBeGreaterThan(0);
  });
});

describe("POST /api/import/epub/commit — cover branches", () => {
  it("importCover=true + sessionId=null → no cover written, no error", async () => {
    const res = await commitPost(jsonRequest({
      sessionId: null,
      story: { title: "X", description: "", keywords: [], authorPenName: "" },
      importCover: true,
      chapters: [{ title: "Ch1", body: "Some real prose." }],
    }) as never);
    expect(res.status).toBe(200);
    const body = await readBody<{ ok: true; data: { slug: string } }>(res);
    await expect(stat(coverPath(dataDir, body.data.slug))).rejects.toThrow();
  });

  it("importCover=false + valid sessionId → no cover written", async () => {
    const sessionId = putCover({
      mimeType: "image/jpeg",
      bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    });
    const res = await commitPost(jsonRequest({
      sessionId,
      story: { title: "Y", description: "", keywords: [], authorPenName: "" },
      importCover: false,
      chapters: [{ title: "Ch1", body: "Some real prose." }],
    }) as never);
    const body = await readBody<{ ok: true; data: { slug: string } }>(res);
    await expect(stat(coverPath(dataDir, body.data.slug))).rejects.toThrow();
  });

  it("importCover=true + bad sessionId (cache miss) → cover skipped, story still created", async () => {
    const res = await commitPost(jsonRequest({
      sessionId: "nope-not-a-real-uuid",
      story: { title: "Z", description: "", keywords: [], authorPenName: "" },
      importCover: true,
      chapters: [{ title: "Ch1", body: "Some real prose." }],
    }) as never);
    expect(res.status).toBe(200);
    const body = await readBody<{ ok: true; data: { slug: string } }>(res);
    expect(body.ok).toBe(true);
    await expect(stat(coverPath(dataDir, body.data.slug))).rejects.toThrow();
  });

  it("importCover=true + cached unknown mime → cover skipped, no error", async () => {
    const sessionId = putCover({ mimeType: "application/octet-stream", bytes: new Uint8Array([1, 2, 3]) });
    const res = await commitPost(jsonRequest({
      sessionId,
      story: { title: "W", description: "", keywords: [], authorPenName: "" },
      importCover: true,
      chapters: [{ title: "Ch1", body: "Some real prose." }],
    }) as never);
    expect(res.status).toBe(200);
    const body = await readBody<{ ok: true; data: { slug: string } }>(res);
    await expect(stat(coverPath(dataDir, body.data.slug))).rejects.toThrow();
  });
});

describe("POST /api/import/epub/commit — validation", () => {
  it("400 on empty chapters[]", async () => {
    const res = await commitPost(jsonRequest({
      sessionId: null,
      story: { title: "X", description: "", keywords: [], authorPenName: "" },
      importCover: false,
      chapters: [],
    }) as never);
    expect(res.status).toBe(400);
    const body = await readBody<{ ok: false; error: string }>(res);
    expect(body.error).toBe("Need at least one chapter to import.");
  });

  it("400 on missing title", async () => {
    const res = await commitPost(jsonRequest({
      sessionId: null,
      story: { title: "", description: "", keywords: [], authorPenName: "" },
      importCover: false,
      chapters: [{ title: "Ch1", body: "x" }],
    }) as never);
    expect(res.status).toBe(400);
  });

  it("400 on chapter with empty body", async () => {
    const res = await commitPost(jsonRequest({
      sessionId: null,
      story: { title: "X", description: "", keywords: [], authorPenName: "" },
      importCover: false,
      chapters: [{ title: "Ch1", body: "   " }],
    }) as never);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/import/epub/commit — atomicity", () => {
  it("rolls back the story dir if a chapter write throws", async () => {
    const chapters = vi.spyOn(await import("@/lib/storage/chapters"), "createImportedChapter")
      .mockImplementationOnce(async () => { throw new Error("disk full"); });
    try {
      const res = await commitPost(jsonRequest({
        sessionId: null,
        story: { title: "Rollback", description: "", keywords: [], authorPenName: "" },
        importCover: false,
        chapters: [{ title: "Ch1", body: "x" }],
      }) as never);
      expect(res.status).toBe(500);
      // Story dir should not exist after rollback. We don't know the slug from
      // the error response, so check that no story.json files exist anywhere.
      const { readdir } = await import("node:fs/promises");
      const storiesDir = join(dataDir, "stories");
      const dirs = await readdir(storiesDir).catch(() => []);
      expect(dirs).toEqual([]);
    } finally {
      chapters.mockRestore();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/api/import-epub-commit.test.ts`

Expected: all tests fail — route module does not exist.

- [ ] **Step 3: Implement `app/api/import/epub/commit/route.ts`**

Create `app/api/import/epub/commit/route.ts`:

```ts
import type { NextRequest } from "next/server";
import { ok, fail, readJson, JsonParseError } from "@/lib/api";
import { effectiveDataDir } from "@/lib/config";
import { createStory, updateStory, deleteStory } from "@/lib/storage/stories";
import { createImportedChapter } from "@/lib/storage/chapters";
import { saveBible } from "@/lib/storage/bible";
import { writeCoverJpeg } from "@/lib/publish/epub-storage";
import { getCover, deleteCover } from "@/lib/epub/cover-cache";
import { EMPTY_BIBLE } from "@/lib/epub/map";
import { logger } from "@/lib/logger";
import sharp from "sharp";

type CommitRequest = {
  sessionId: string | null;
  story: { title: string; description: string; keywords: string[]; authorPenName: string };
  importCover: boolean;
  chapters: Array<{ title: string; body: string }>;
};

function isCommitRequest(v: unknown): v is CommitRequest {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (o.sessionId !== null && typeof o.sessionId !== "string") return false;
  if (typeof o.importCover !== "boolean") return false;
  if (!Array.isArray(o.chapters)) return false;
  if (!o.story || typeof o.story !== "object") return false;
  const s = o.story as Record<string, unknown>;
  if (typeof s.title !== "string") return false;
  if (typeof s.description !== "string") return false;
  if (!Array.isArray(s.keywords)) return false;
  if (typeof s.authorPenName !== "string") return false;
  return true;
}

async function transcodeIfNeeded(
  mimeType: string,
  bytes: Uint8Array
): Promise<Buffer | null> {
  if (mimeType === "image/jpeg") return Buffer.from(bytes);
  if (mimeType === "image/png" || mimeType === "image/webp") {
    try {
      return await sharp(Buffer.from(bytes)).rotate().jpeg({ quality: 92 }).toBuffer();
    } catch (err) {
      logger.warn(
        "[epub/commit] cover transcode failed, skipping cover",
        err instanceof Error ? err.message : String(err)
      );
      return null;
    }
  }
  // Unknown/octet-stream → skip
  logger.warn(`[epub/commit] cover mime ${mimeType} not supported, skipping cover`);
  return null;
}

export async function POST(req: NextRequest) {
  let parsed: unknown;
  try {
    parsed = await readJson<unknown>(req);
  } catch (err) {
    if (err instanceof JsonParseError) return fail(err.message, 400);
    throw err;
  }
  if (!isCommitRequest(parsed)) return fail("invalid request body", 400);
  const body = parsed;

  const title = body.story.title.trim();
  if (!title) return fail("title required", 400);
  if (body.chapters.length === 0) return fail("Need at least one chapter to import.", 400);
  for (let i = 0; i < body.chapters.length; i++) {
    const ch = body.chapters[i];
    if (typeof ch?.body !== "string" || ch.body.trim().length === 0) {
      return fail(`chapter ${i + 1} has empty body`, 400);
    }
    if (typeof ch.title !== "string") return fail(`chapter ${i + 1} title must be a string`, 400);
  }

  const dataDir = effectiveDataDir();
  // Treat empty/null sessionId equivalently — they both mean "no cover".
  const cacheKey = body.sessionId && body.sessionId.length > 0 ? body.sessionId : null;
  let createdSlug: string | null = null;

  try {
    const story = await createStory(dataDir, {
      title,
      authorPenName: body.story.authorPenName,
    });
    createdSlug = story.slug;

    await updateStory(dataDir, story.slug, {
      description: body.story.description,
      keywords: body.story.keywords,
    });

    // Bible writes go through the storage helper (per CLAUDE.md storage rules).
    await saveBible(dataDir, story.slug, EMPTY_BIBLE);

    // Cover: best-effort, never blocks the import.
    if (body.importCover && cacheKey) {
      const cached = getCover(cacheKey);
      if (!cached) {
        logger.warn(`[epub/commit] cover-cache miss for sessionId ${cacheKey}`);
      } else {
        const jpeg = await transcodeIfNeeded(cached.mimeType, cached.bytes);
        if (jpeg) await writeCoverJpeg(dataDir, story.slug, jpeg);
      }
    }

    const chapterIds: string[] = [];
    for (const ch of body.chapters) {
      const created = await createImportedChapter(dataDir, story.slug, {
        title: (ch.title || "Untitled").trim() || "Untitled",
        sectionContents: [ch.body.trim()],
      });
      chapterIds.push(created.id);
    }

    return ok({ slug: story.slug, chapterIds });
  } catch (err) {
    if (createdSlug) {
      // deleteStory uses `rm({ recursive: true, force: true })` on the entire
      // story dir, so partial bible/cover/chapter writes are cleaned up too.
      await deleteStory(dataDir, createdSlug).catch(() => undefined);
    }
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[epub/commit] failed", msg);
    return fail(`Failed to write story files: ${msg}`, 500);
  } finally {
    // Always evict the cached cover, regardless of success/failure/skip path.
    if (cacheKey) deleteCover(cacheKey);
  }
}
```

The `EMPTY_BIBLE` constant lives in `lib/epub/map.ts` (where Task 4.3 defined it). Re-exporting from there keeps the truth in one place. **Update Task 4.3's `map.ts` to `export const EMPTY_BIBLE` instead of declaring it as a private `const`** — backport this small change to that file when implementing Chunk 5.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/api/import-epub-commit.test.ts`

Expected: all tests pass. The atomicity test relies on `vi.spyOn(...).mockImplementationOnce` — if Vitest reports "module not loaded yet", make sure the dynamic `await import` happens *inside* the test (which it does in the snippet).

- [ ] **Step 5: Commit**

```bash
git add app/api/import/epub/commit/route.ts tests/api/import-epub-commit.test.ts
git commit -m "feat(epub): POST /api/import/epub/commit — write story/bible/chapters/cover with rollback"
```

### Task 5.3: Privacy egress test

Both new routes must be exercised in [tests/privacy/no-external-egress.test.ts](../../../tests/privacy/no-external-egress.test.ts) per the project's load-bearing privacy invariant ([CLAUDE.md](../../../CLAUDE.md) "Privacy enforcement").

**Files:**
- Modify: `tests/privacy/no-external-egress.test.ts`

- [ ] **Step 1: Read the existing test to understand the pattern**

Run: `head -80 tests/privacy/no-external-egress.test.ts`

Expected output starts with the file's load-bearing-test docstring, followed by `EXEMPTED ROUTES` and `ROUTES EXERCISED` lists. The pattern: `global.fetch` is stubbed to record every call; each route is invoked; after each, `recorded` is asserted to be `[]`.

- [ ] **Step 2: Add `/api/import/epub/parse` and `/api/import/epub/commit` to the EXERCISED list comment**

Find the block of `// POST /api/import/novelai/parse` lines. Add two new lines below them:

```
 *   POST /api/import/epub/parse
 *   POST /api/import/epub/commit
```

- [ ] **Step 3: Add test invocations**

Locate the place in the test where `/api/import/novelai/parse` is exercised (search for `import/novelai/parse`). Right after the existing NovelAI exercises, add a new block:

```ts
// ── /api/import/epub/parse + commit ────────────────────────────────────
{
  const { POST: epubParsePost } = await import("@/app/api/import/epub/parse/route");
  const { POST: epubCommitPost } = await import("@/app/api/import/epub/commit/route");
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");

  recorded.length = 0;
  const epubBuf = await readFile(
    join(__dirname, "..", "..", "lib", "epub", "__fixtures__", "sample-kdp.epub")
  );
  const form = new FormData();
  form.set("file", new File([new Uint8Array(epubBuf)], "book.epub", { type: "application/epub+zip" }));
  const parseRes = await epubParsePost(
    new Request("http://localhost/api/import/epub/parse", { method: "POST", body: form }) as never
  );
  expect(parseRes.status).toBe(200);
  expect(recorded).toEqual([]);

  const parseBody = await parseRes.json() as {
    data: { sessionId: string; proposed: { story: { title: string; description: string; keywords: string[]; authorPenName: string }; chapters: Array<{ navTitle: string; body: string; skippedByDefault: boolean }> } };
  };
  const include = parseBody.data.proposed.chapters
    .filter((c) => !c.skippedByDefault)
    .map((c) => ({ title: c.navTitle, body: c.body }));

  recorded.length = 0;
  const commitRes = await epubCommitPost(
    new Request("http://localhost/api/import/epub/commit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: parseBody.data.sessionId,
        story: parseBody.data.proposed.story,
        importCover: true,
        chapters: include,
      }),
    }) as never
  );
  expect(commitRes.status).toBe(200);
  expect(recorded).toEqual([]);
}
```

- [ ] **Step 4: Run the privacy test**

Run: `npx vitest run tests/privacy/no-external-egress.test.ts`

Expected: passes. `recorded === []` after both EPUB route exercises.

(Vitest runs this test file in CommonJS-by-default mode, same as the existing NovelAI block — `__dirname` is available without ESM ceremony.)

- [ ] **Step 5: Run the full test suite to ensure no regressions**

Run: `npm test`

Expected: all tests pass (Vitest runs the egress test, all `lib/epub/` tests, NovelAI tests, etc.). No new failures, no flakiness.

- [ ] **Step 6: Commit**

```bash
git add tests/privacy/no-external-egress.test.ts
git commit -m "test(privacy): exercise EPUB import routes in no-egress test"
```

---

## Chunk 6: UI dialog + page button + e2e

This chunk completes the feature with the user-facing UI. The dialog mirrors `NewStoryFromNovelAIDialog`'s shape; the entry button lives in `components/library/LibraryList.tsx` (the empty-state and populated-state header), not directly in `app/page.tsx` (which just renders `<LibraryList />`). One Playwright happy path proves the full pipeline.

**Important integration-point correction from the spec:** the spec says "add button on `app/page.tsx`". The actual home-page button group lives in `components/library/LibraryList.tsx` lines ~187 and ~202. `app/page.tsx` is a thin wrapper. The plan threads through `LibraryList.tsx`.

### Task 6.1: `NewStoryFromEpubDialog` component

**Files:**
- Create: `components/import/NewStoryFromEpubDialog.tsx`

This task is implementation-only; component tests follow in Task 6.3. Build the dialog without tests first because the test scaffolding (manual React 19 harness from the NovelAI tests) is heavy and we want a working end-to-end UI before stress-testing it.

- [ ] **Step 1: Read the NovelAI dialog top-to-bottom**

Run: `wc -l components/import/NewStoryFromNovelAIDialog.tsx && head -100 components/import/NewStoryFromNovelAIDialog.tsx`

Expected: ~600 lines. Note the patterns: SWR-gated `/api/settings`, three-stage `Stage` discriminated union, `mount`-friendly default-export, `toForm()` helper for shape conversion.

- [ ] **Step 2: Verify shadcn primitives + apply substitutions before paste**

Run: `ls components/ui/`

`Checkbox` (from `components/ui/checkbox`) and `Badge` (`components/ui/badge`) are NOT in this repo today. Before pasting the dialog code in Step 3, substitute them everywhere they appear:

- Replace `<Checkbox checked={X} onCheckedChange={(v) => Y(v === true)} />` with:
  ```tsx
  <input type="checkbox" checked={X} onChange={(e) => Y(e.target.checked)} className="size-4" />
  ```
- Replace `<Badge variant="outline">label</Badge>` (and `secondary`/`destructive` variants) with:
  ```tsx
  <span className="rounded border px-1.5 py-0.5 text-[10px] uppercase">label</span>
  ```
  For the `destructive` variant (the "skipped" badge), add `border-destructive/40 text-destructive` to the className. Keep the `title` attribute so the tooltip on hover (the `skipReason`) still works.

Also remove the corresponding `import { Checkbox } ...` and `import { Badge } ...` lines.

If a future PR adds those primitives, the dialog can switch to them with a small refactor. Today, substituting up-front avoids a lint failure between Step 3 (paste) and Step 4 (verify).

- [ ] **Step 3: Create the dialog component**

Create `components/import/NewStoryFromEpubDialog.tsx` from the code below, applying the Step 2 substitutions inline as you paste. Internal sub-components `PickFileBlock`, `PreviewBlock`, and `EpubChapterRow` live in the same file (per the spec's "extract only when past ~80 lines" rule).

```tsx
"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import useSWR from "swr";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { PenNamePicker } from "@/components/import/PenNamePicker";
import type { Bible } from "@/lib/types";
import type { PenNameProfile } from "@/lib/config";

interface SettingsLite {
  penNameProfiles?: Record<string, PenNameProfile>;
}

const jsonFetcher = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url);
  const json = (await res.json()) as { ok: boolean; data?: T; error?: string };
  if (!json.ok) throw new Error(json.error ?? "request failed");
  return json.data as T;
};

type ChapterRow = {
  navTitle: string;
  body: string;
  wordCount: number;
  source: "nav" | "spine";
  skippedByDefault: boolean;
  skipReason?: string;
  include: boolean;
  expanded: boolean;
};

type ParsedLite = {
  metadata: {
    title: string;
    creator: string;
    description: string;
    subjects: string[];
    language: string;
  };
  chapters: Array<{
    navTitle: string;
    body: string;
    wordCount: number;
    source: "nav" | "spine";
    skippedByDefault: boolean;
    skipReason?: string;
  }>;
  epubVersion: 2 | 3;
  hasCover: boolean;
};

type ProposedLite = {
  story: { title: string; description: string; keywords: string[]; authorPenName: string };
  bible: Bible;
  chapters: ParsedLite["chapters"];
  penNameMatch: "exact" | "case-insensitive" | "none";
  hasCover: boolean;
};

type ParseResponse = {
  ok: true;
  data: {
    parsed: ParsedLite;
    proposed: ProposedLite;
    coverPreview: string | null;
    sessionId: string;
  };
};

type Stage =
  | { kind: "idle" }
  | { kind: "parsing" }
  | { kind: "error"; message: string }
  | {
      kind: "preview";
      parsed: ParsedLite;
      proposed: ProposedLite;
      coverPreview: string | null;
      sessionId: string;
    };

type FormState = {
  title: string;
  description: string;
  keywords: string;
  authorPenName: string;
  importCover: boolean;
  chapters: ChapterRow[];
};

function toForm(p: ProposedLite): FormState {
  return {
    title: p.story.title,
    description: p.story.description,
    keywords: p.story.keywords.join(", "),
    authorPenName: p.story.authorPenName,
    importCover: p.hasCover,
    chapters: p.chapters.map((c) => ({
      ...c,
      include: !c.skippedByDefault,
      expanded: false,
    })),
  };
}

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

export function NewStoryFromEpubDialog({ open, onOpenChange }: Props) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  const { data: settings } = useSWR<SettingsLite>(
    open ? "/api/settings" : null,
    jsonFetcher,
    { revalidateOnFocus: false },
  );
  const profiles = settings?.penNameProfiles;

  const reset = useCallback(() => {
    setStage({ kind: "idle" });
    setForm(null);
    setSaving(false);
  }, []);

  const handleClose = useCallback(
    (next: boolean) => {
      if (saving) return;
      if (!next) reset();
      onOpenChange(next);
    },
    [onOpenChange, reset, saving],
  );

  async function handleFile(file: File) {
    setStage({ kind: "parsing" });
    const fd = new FormData();
    fd.set("file", file);
    try {
      const res = await fetch("/api/import/epub/parse", { method: "POST", body: fd });
      const json = (await res.json()) as ParseResponse | { ok: false; error: string };
      if (!json.ok) {
        setStage({ kind: "error", message: json.error });
        return;
      }
      setStage({
        kind: "preview",
        parsed: json.data.parsed,
        proposed: json.data.proposed,
        coverPreview: json.data.coverPreview,
        sessionId: json.data.sessionId,
      });
      setForm(toForm(json.data.proposed));
    } catch (err) {
      setStage({
        kind: "error",
        message: err instanceof Error ? err.message : "Unexpected error reading file.",
      });
    }
  }

  async function handleCommit() {
    if (stage.kind !== "preview" || !form) return;
    const includedChapters = form.chapters
      .filter((c) => c.include)
      .map((c) => ({ title: c.navTitle, body: c.body }));
    if (includedChapters.length === 0) return;

    setSaving(true);
    try {
      const res = await fetch("/api/import/epub/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: stage.sessionId || null,
          story: {
            title: form.title.trim(),
            description: form.description,
            keywords: form.keywords.split(",").map((s) => s.trim()).filter(Boolean),
            authorPenName: form.authorPenName,
          },
          importCover: form.importCover && stage.proposed.hasCover,
          chapters: includedChapters,
        }),
      });
      const json = (await res.json()) as
        | { ok: true; data: { slug: string; chapterIds: string[] } }
        | { ok: false; error: string };
      if (!json.ok) {
        toast.error(json.error);
        setSaving(false);
        return;
      }
      toast.success(`Imported "${form.title.trim()}" (${includedChapters.length} chapters)`);
      handleClose(false);
      router.push(`/s/${json.data.slug}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to import.");
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Import from EPUB</DialogTitle>
          <DialogDescription>
            Pull a published `.epub` into a new Scriptr story.
          </DialogDescription>
        </DialogHeader>

        {stage.kind === "idle" && <PickFileBlock onFile={handleFile} />}
        {stage.kind === "parsing" && (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Reading EPUB…
          </div>
        )}
        {stage.kind === "error" && (
          <div className="flex flex-col gap-3">
            <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {stage.message}
            </p>
            <Button variant="outline" onClick={reset}>
              Choose a different file
            </Button>
          </div>
        )}
        {stage.kind === "preview" && form && (
          <PreviewBlock
            form={form}
            setForm={setForm}
            coverPreview={stage.coverPreview}
            penNameMatch={stage.proposed.penNameMatch}
            creator={stage.parsed.metadata.creator}
            profiles={profiles}
          />
        )}

        <DialogFooter>
          {stage.kind === "preview" && (
            <Button
              onClick={handleCommit}
              disabled={
                saving ||
                !form ||
                !form.title.trim() ||
                form.chapters.filter((c) => c.include).length === 0
              }
            >
              {saving ? "Creating…" : "Create story"}
            </Button>
          )}
          <Button variant="outline" onClick={() => handleClose(false)} disabled={saving}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PickFileBlock({ onFile }: { onFile: (f: File) => void }) {
  return (
    <label
      htmlFor="epub-file-input"
      className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-12 text-center text-sm text-muted-foreground hover:bg-muted/40"
    >
      <span>Drop a .epub here, or click to choose</span>
      <input
        id="epub-file-input"
        type="file"
        accept=".epub,application/epub+zip"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
    </label>
  );
}

function PreviewBlock({
  form,
  setForm,
  coverPreview,
  penNameMatch,
  creator,
  profiles,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState | null>>;
  coverPreview: string | null;
  penNameMatch: ProposedLite["penNameMatch"];
  creator: string;
  profiles: Record<string, PenNameProfile> | undefined;
}) {
  const skippedCount = form.chapters.filter((c) => c.skippedByDefault).length;
  const includeCount = form.chapters.filter((c) => c.include).length;

  function update(patch: Partial<FormState>) {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  }
  function updateChapter(i: number, patch: Partial<ChapterRow>) {
    setForm((prev) =>
      prev
        ? {
            ...prev,
            chapters: prev.chapters.map((c, idx) => (idx === i ? { ...c, ...patch } : c)),
          }
        : prev,
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[280px,1fr]">
      <div className="flex flex-col gap-3">
        {coverPreview && (
          <div className="flex flex-col gap-2">
            <img
              src={coverPreview}
              alt="Cover"
              className={`w-32 rounded border ${form.importCover ? "" : "opacity-30"}`}
            />
            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={form.importCover}
                onCheckedChange={(v) => update({ importCover: v === true })}
              />
              Import cover from EPUB
            </label>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Title</label>
          <Input value={form.title} onChange={(e) => update({ title: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Description</label>
          <Textarea
            rows={4}
            value={form.description}
            onChange={(e) => update({ description: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Keywords (comma-separated)</label>
          <Input
            value={form.keywords}
            onChange={(e) => update({ keywords: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Pen name</label>
          <PenNamePicker
            profiles={profiles}
            value={form.authorPenName}
            onChange={(next) => update({ authorPenName: next })}
          />
          {penNameMatch === "case-insensitive" && (
            <p className="text-xs text-muted-foreground">
              Auto-matched to "{form.authorPenName}".
            </p>
          )}
          {penNameMatch === "none" && creator && (
            <p className="text-xs text-muted-foreground">
              EPUB lists author as "{creator}" — pick a pen name or leave blank.
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          {form.chapters.length} chapters detected. {skippedCount} excluded by default
          (copyright pages, etc.) — check to include. {includeCount} will be imported.
        </p>
        <div className="flex flex-col divide-y rounded border">
          {form.chapters.map((ch, i) => (
            <EpubChapterRow
              key={`${ch.navTitle}-${i}`}
              row={ch}
              onChange={(patch) => updateChapter(i, patch)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function EpubChapterRow({
  row,
  onChange,
}: {
  row: ChapterRow;
  onChange: (patch: Partial<ChapterRow>) => void;
}) {
  return (
    <div className="flex flex-col gap-2 p-2">
      <div className="flex items-center gap-2">
        <Checkbox
          checked={row.include}
          onCheckedChange={(v) => onChange({ include: v === true })}
        />
        <Input
          value={row.navTitle}
          onChange={(e) => onChange({ navTitle: e.target.value })}
          className="flex-1"
        />
        <span className="text-xs text-muted-foreground">{row.wordCount} words</span>
        <Badge variant={row.source === "nav" ? "outline" : "secondary"}>{row.source}</Badge>
        {row.skippedByDefault && (
          <Badge variant="destructive" title={row.skipReason}>
            skipped
          </Badge>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({ expanded: !row.expanded })}
        >
          {row.expanded ? "Collapse" : "Edit body"}
        </Button>
      </div>
      {row.expanded && (
        <Textarea
          rows={8}
          value={row.body}
          onChange={(e) => onChange({ body: e.target.value })}
          className="font-mono text-xs"
        />
      )}
    </div>
  );
}

export { toForm };
```

- [ ] **Step 4: Verify lint + typecheck**

Run: `npm run lint && npm run typecheck`

Expected: pass. If lint flags an unused-import warning for the removed Checkbox/Badge lines, ensure those imports are gone (Step 2 instructed to remove them).

- [ ] **Step 5: Commit**

```bash
git add components/import/NewStoryFromEpubDialog.tsx
git commit -m "feat(epub): NewStoryFromEpubDialog UI component"
```

### Task 6.2: Wire the button into LibraryList

**Files:**
- Modify: `components/library/LibraryList.tsx`

- [ ] **Step 1: Add the import + state hook**

In `components/library/LibraryList.tsx`, add to the imports (near the existing NovelAI import):

```ts
import { NewStoryFromEpubDialog } from "@/components/import/NewStoryFromEpubDialog";
```

Add state near `const [novelaiOpen, setNovelaiOpen] = useState(false);`:

```ts
const [epubOpen, setEpubOpen] = useState(false);
```

- [ ] **Step 2: Add the button to the empty-state block**

In the empty-state JSX (around line 187), add a third `<Button>` after the NovelAI button:

```tsx
<Button variant="outline" onClick={() => setEpubOpen(true)}>
  Import from EPUB
</Button>
```

- [ ] **Step 3: Add the button to the populated-state header**

In the populated-state header (around line 202), add:

```tsx
<Button size="sm" variant="outline" onClick={() => setEpubOpen(true)}>
  Import from EPUB
</Button>
```

- [ ] **Step 4: Mount the dialog**

After the `<NewStoryFromNovelAIDialog ... />` line (around line 226), add:

```tsx
{/* ── Import from EPUB dialog ───────────────────────────────────── */}
<NewStoryFromEpubDialog open={epubOpen} onOpenChange={setEpubOpen} />
```

- [ ] **Step 5: Verify lint + typecheck**

Run: `npm run lint && npm run typecheck`

Expected: pass.

- [ ] **Step 6: Manual smoke test — start dev server and click through the flow**

Run: `npm run dev`

Open http://127.0.0.1:3000/. The "Import from EPUB" button should appear in both the empty state (if no stories exist) and the populated header. Clicking it opens the dialog. Drop `lib/epub/__fixtures__/sample-kdp.epub` and confirm the preview renders with metadata, cover thumbnail, and 6 chapter rows (3 with "skipped" badge).

(Don't commit yet — the manual smoke is for confidence, not part of the deliverable.)

- [ ] **Step 7: Commit**

```bash
git add components/library/LibraryList.tsx
git commit -m "feat(epub): wire 'Import from EPUB' button into LibraryList"
```

### Task 6.3: Component test for the dialog

Mirrors the NovelAI dialog's manual React 19 harness (no @testing-library — see `tests/components/import/NewStoryFromNovelAIDialog.test.tsx`).

**Files:**
- Create: `tests/components/import/NewStoryFromEpubDialog.test.tsx`

- [ ] **Step 1: Write the test file**

Create `tests/components/import/NewStoryFromEpubDialog.test.tsx`:

```tsx
// @vitest-environment jsdom
/**
 * Manual React 19 harness — mirrors NewStoryFromNovelAIDialog.test.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SWRConfig } from "swr";
import { NewStoryFromEpubDialog } from "@/components/import/NewStoryFromEpubDialog";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

type Mounted = { container: HTMLDivElement; unmount: () => void };
function mount(el: React.ReactElement): Mounted {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root!: Root;
  const wrapped = React.createElement(
    SWRConfig,
    { value: { provider: () => new Map() } },
    el,
  );
  act(() => {
    root = createRoot(container);
    root.render(wrapped);
  });
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function fakeParseResponse(over: Partial<{ hasCover: boolean; coverPreview: string | null; sessionId: string }> = {}) {
  return {
    ok: true,
    data: {
      parsed: {
        metadata: { title: "T", creator: "Jane", description: "", subjects: [], language: "en" },
        chapters: [
          { navTitle: "Copyright", body: "© 2026", wordCount: 2, source: "nav" as const, skippedByDefault: true, skipReason: "Matched 'copyright' rule" },
          { navTitle: "Chapter 1", body: "Real prose here.", wordCount: 3, source: "nav" as const, skippedByDefault: false },
          { navTitle: "Chapter 2", body: "More prose here.", wordCount: 3, source: "nav" as const, skippedByDefault: false },
        ],
        epubVersion: 3 as const,
        hasCover: over.hasCover ?? true,
      },
      proposed: {
        story: { title: "T", description: "", keywords: [], authorPenName: "" },
        bible: { characters: [], setting: "", pov: "third-limited", tone: "", styleNotes: "", nsfwPreferences: "" },
        chapters: [
          { navTitle: "Copyright", body: "© 2026", wordCount: 2, source: "nav" as const, skippedByDefault: true, skipReason: "Matched 'copyright' rule" },
          { navTitle: "Chapter 1", body: "Real prose here.", wordCount: 3, source: "nav" as const, skippedByDefault: false },
          { navTitle: "Chapter 2", body: "More prose here.", wordCount: 3, source: "nav" as const, skippedByDefault: false },
        ],
        penNameMatch: "none" as const,
        hasCover: over.hasCover ?? true,
      },
      coverPreview: over.coverPreview ?? "data:image/jpeg;base64,xxx",
      sessionId: over.sessionId ?? "sess-1",
    },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  push.mockReset();
});
afterEach(() => {
  // Safe DOM cleanup — replaceChildren() with no args clears children.
  document.body.replaceChildren();
});

describe("NewStoryFromEpubDialog", () => {
  it("uploads a file, transitions to preview, and shows chapter rows", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      if (typeof url === "string" && url.includes("/api/import/epub/parse")) {
        return new Response(JSON.stringify(fakeParseResponse()), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, data: { penNameProfiles: {} } }), { status: 200 });
    });

    const m = mount(
      React.createElement(NewStoryFromEpubDialog, {
        open: true,
        onOpenChange: () => undefined,
      }),
    );
    await flush();

    const input = m.container.ownerDocument.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();

    const file = new File([new Uint8Array([0x50, 0x4b])], "x.epub", { type: "application/epub+zip" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await flush();

    const docText = m.container.ownerDocument.body.textContent ?? "";
    expect(docText).toContain("Copyright");
    expect(docText).toContain("Chapter 1");
    expect(docText).toContain("Chapter 2");

    fetchMock.mockRestore();
    m.unmount();
  });

  it("commits with only checked chapters and routes to /s/<slug> on success", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (url, init) => {
      if (typeof url === "string" && url.includes("/api/import/epub/parse")) {
        return new Response(JSON.stringify(fakeParseResponse()), { status: 200 });
      }
      if (typeof url === "string" && url.includes("/api/import/epub/commit")) {
        const body = JSON.parse((init?.body as string) ?? "{}") as {
          chapters: Array<{ title: string }>;
        };
        // Only Chapter 1 + Chapter 2 — Copyright was unchecked by default.
        expect(body.chapters.map((c) => c.title)).toEqual(["Chapter 1", "Chapter 2"]);
        return new Response(
          JSON.stringify({ ok: true, data: { slug: "t", chapterIds: ["a", "b"] } }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 });
    });

    const m = mount(
      React.createElement(NewStoryFromEpubDialog, {
        open: true,
        onOpenChange: () => undefined,
      }),
    );
    await flush();
    const input = m.container.ownerDocument.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([0x50, 0x4b])], "x.epub", { type: "application/epub+zip" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await flush();

    const buttons = Array.from(
      m.container.ownerDocument.querySelectorAll("button"),
    ) as HTMLButtonElement[];
    const createBtn = buttons.find((b) => /create story/i.test(b.textContent ?? ""))!;
    expect(createBtn).toBeTruthy();
    await act(async () => createBtn.click());
    await flush();

    expect(push).toHaveBeenCalledWith("/s/t");

    fetchMock.mockRestore();
    m.unmount();
  });

  it("shows error panel + reset button on parse failure", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      if (typeof url === "string" && url.includes("/api/import/epub/parse")) {
        return new Response(JSON.stringify({ ok: false, error: "DRM-protected" }), {
          status: 400,
        });
      }
      return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 });
    });

    const m = mount(
      React.createElement(NewStoryFromEpubDialog, {
        open: true,
        onOpenChange: () => undefined,
      }),
    );
    await flush();
    const input = m.container.ownerDocument.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([0x50, 0x4b])], "x.epub");
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await flush();

    const docText = m.container.ownerDocument.body.textContent ?? "";
    expect(docText).toContain("DRM-protected");

    const buttons = Array.from(
      m.container.ownerDocument.querySelectorAll("button"),
    ) as HTMLButtonElement[];
    const resetBtn = buttons.find((b) => /choose a different file/i.test(b.textContent ?? ""))!;
    await act(async () => resetBtn.click());
    await flush();

    expect(m.container.ownerDocument.querySelector('input[type="file"]')).toBeTruthy();

    fetchMock.mockRestore();
    m.unmount();
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run tests/components/import/NewStoryFromEpubDialog.test.tsx`

Expected: all 3 tests pass. If they fail because the dialog uses Radix portals (Dialog content rendered outside the test container), the tests already query `m.container.ownerDocument.body` for text content and `m.container.ownerDocument.querySelectorAll("button")` for buttons — both reach into `document.body`, so portal-mounted nodes are found.

- [ ] **Step 3: Commit**

```bash
git add tests/components/import/NewStoryFromEpubDialog.test.tsx
git commit -m "test(epub): NewStoryFromEpubDialog component tests"
```

### Task 6.4: Playwright e2e

**Files:**
- Create: `tests/e2e/epub-import.spec.ts`

- [ ] **Step 1: Write the e2e spec**

Create `tests/e2e/epub-import.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { join } from "node:path";
import { rm } from "node:fs/promises";

const FIXTURE = join(
  __dirname,
  "..",
  "..",
  "lib",
  "epub",
  "__fixtures__",
  "sample-kdp.epub",
);

test.describe("EPUB import", () => {
  // Match novelai-import.spec.ts: wipe e2e data dir before the run so slug
  // derivation is deterministic across reruns.
  test.beforeAll(async () => {
    await rm("/tmp/scriptr-e2e", { recursive: true, force: true });
  });

  test("imports a KDP-shaped EPUB into a new story with cover and 3 chapters", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /import from epub/i }).first().click();

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(FIXTURE);

    // Preview renders. Three "real" chapters + three "skipped" boilerplate.
    await expect(page.locator('input[value="The Garden Wall"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/copyright/i).first()).toBeVisible();
    await expect(page.getByText(/about the author/i).first()).toBeVisible();
    await expect(page.locator('img[alt="Cover"]')).toBeVisible();

    // Click "Create story". Default-skipped chapters stay unchecked → 3 imported.
    await page.getByRole("button", { name: /create story/i }).click();

    await expect(page).toHaveURL(/\/s\/the-garden-wall(\?.*)?$/, { timeout: 15_000 });

    // Editor opens; fixture-specific prose is visible on the first real chapter.
    await expect(page.getByText(/Mira stepped through the gate/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
```

- [ ] **Step 2: Ensure fixtures are built before e2e runs**

Run: `npm run build:fixtures`

Expected: prints the four fixture lines and exits 0. The Playwright config doesn't run `pretest`; the fixtures must exist on disk before the e2e dev server boots.

- [ ] **Step 3: Run the e2e suite**

Run: `npm run e2e -- tests/e2e/epub-import.spec.ts`

Expected: passes. Playwright spins up its own dev server on port 3001 with `SCRIPTR_DATA_DIR=/tmp/scriptr-e2e`, so this never touches the user's real `data/` directory.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/epub-import.spec.ts
git commit -m "test(epub): e2e happy-path import of KDP fixture"
```

### Task 6.5: Final full-suite verification

- [ ] **Step 1: Run the entire test matrix**

Run: `npm run lint && npm run typecheck && npm test && npm run e2e`

Expected: every gate passes:
- ESLint: zero errors, no `scriptr/no-telemetry` violations.
- tsc: clean.
- Vitest: every `lib/epub/`, `tests/api/import-epub-*`, `tests/components/import/NewStoryFromEpubDialog`, and the privacy egress test all green.
- Playwright: `epub-import.spec.ts` happy path passes.

- [ ] **Step 2: Manual smoke test with a real published EPUB**

The user has stated their motivation is bundling previously-published books. Before declaring done, take one of those real EPUBs (provided locally, **not committed**) and run it through the importer end to end:

1. `npm run dev`
2. Open http://127.0.0.1:3000/, click "Import from EPUB", drop the real file.
3. Confirm the preview shows the right title, cover, description, keywords, and chapter list with sensible default-skip flags.
4. Click "Create story".
5. From the new story, build a Bundle that includes it, export the bundle EPUB, and verify the bundled output contains the imported chapters.

Anything unexpected (chapter splits in the wrong place, missing prose, broken cover) is a real-data finding to record before merge — write it up in the PR description rather than silently patching, so the user can decide whether to ship as-is or hold for a fix.

- [ ] **Step 3: Final integration commit (optional)**

If any small adjustments emerged from the manual smoke test, commit them now with a `fix(epub):` prefix. If none, no action required — the previous task commits are the deliverable.

---



