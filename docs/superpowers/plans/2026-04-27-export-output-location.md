# Custom EPUB Output Location & Visible Build Feedback Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let authors choose where built EPUBs land (a global default in `data/config.json`, configurable from the export page with a native folder picker in Electron) and surface route failures as toasts so build success/failure is visible everywhere — fixing the silent-failure symptom in the Electron app.

**Architecture:** A small Electron preload + 3 IPC handlers (`dialog:pickFolder`, `shell:revealInFolder`, `shell:openFile`) extend the renderer with desktop affordances. A new `defaultExportDir` field in `Config` flows through `PUT /api/settings`; the export route accepts an optional `outputDir` body field and resolves: explicit body → config default → `data/<slug>/exports/`. Writability is verified server-side via a temp-file probe (Windows-safe). Client `handleBuild` gets a real `try/catch` so HTTP 500s and parse errors become toasts.

**Tech Stack:** Next.js 16 (App Router, React 19), Electron 33 (contextBridge IPC), TypeScript, Vitest (vitest with jsdom for component tests), Sonner toasts, Tailwind 4 + shadcn/ui.

**Spec:** [docs/superpowers/specs/2026-04-27-export-output-location-design.md](../specs/2026-04-27-export-output-location-design.md)

---

## File map

| File | Action | Responsibility |
|------|--------|---------------|
| `lib/storage/paths.ts` | modify | Add `customEpubPath(outputDir, slug, version)` helper |
| `lib/storage/dir-probe.ts` | **create** | Temp-file writability probe shared by both routes |
| `lib/config.ts` | modify | Add `defaultExportDir?: string` to `Config`; normalize + merge |
| `lib/publish/epub-storage.ts` | modify | `writeEpub` accepts optional `{ outputDir }` |
| `app/api/settings/route.ts` | modify | PUT accepts/validates `defaultExportDir`; GET returns it; PUT response returns persisted value |
| `app/api/stories/[slug]/export/epub/route.ts` | modify | Body accepts optional `outputDir`; resolve effective dir; validate via probe |
| `electron/preload.ts` | **create** | `contextBridge` exposing `pickFolder` / `revealInFolder` / `openFile` |
| `electron/main.ts` | modify | Register `preload`, install 3 `ipcMain.handle`s with path validation |
| `components/publish/ExportPage.tsx` | modify | Output-location section, `try/catch` rewrite of `handleBuild`, success-card buttons |
| `tests/lib/storage/paths.test.ts` | modify | Cover `customEpubPath` |
| `tests/lib/storage/dir-probe.test.ts` | **create** | Probe happy + sad paths |
| `tests/lib/publish-epub-storage.test.ts` | modify | Cover `writeEpub` with `outputDir` override |
| `tests/api/settings.test.ts` | modify | Cover `defaultExportDir` validation matrix |
| `tests/api/export.epub.test.ts` | modify | Cover `outputDir` in body, fallback to config default, validation errors |
| `tests/components/publish/ExportPage.test.tsx` | modify | Cover output-location UI, error-toast on 500, picker visibility, success-card buttons |
| `tests/electron/preload-bridge.test.ts` | **create** | Verify preload exposes only the three documented methods |
| `tests/privacy/no-external-egress.test.ts` | modify | Add `PUT /api/settings { defaultExportDir: null }` to the route exercise list |

---

## Chunk 1: Storage primitives & config schema

Foundation layer. No HTTP, no UI. Each task is fully testable with vitest in `node` env.

### Task 1: Add `customEpubPath` helper

**Files:**
- Modify: `lib/storage/paths.ts`
- Modify: `tests/lib/storage/paths.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/storage/paths.test.ts` inside the existing `describe("storage paths", ...)` block:

```ts
import {
  // ... existing imports
  customEpubPath,
} from "@/lib/storage/paths";

it("customEpubPath joins output dir with the slug+version filename", () => {
  expect(customEpubPath("/Users/chase/Books", "the-meeting", 3)).toBe(
    "/Users/chase/Books/the-meeting-epub3.epub",
  );
  expect(customEpubPath("/Users/chase/Books", "the-meeting", 2)).toBe(
    "/Users/chase/Books/the-meeting-epub2.epub",
  );
});

it("customEpubPath uses the same filename pattern as epubPath", () => {
  // The two helpers diverge only in their parent dir, never in the filename.
  // This guards against future code switching between override and default
  // and producing a different filename.
  const dataDir = "/tmp/data";
  const slug = "x";
  expect(customEpubPath("/out", slug, 3).split("/").pop())
    .toBe(epubPath(dataDir, slug, 3).split("/").pop());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/storage/paths.test.ts -t "customEpubPath"`
Expected: FAIL with "customEpubPath is not a function" or similar import error.

- [ ] **Step 3: Implement `customEpubPath`**

In `lib/storage/paths.ts`, add immediately after `epubPath`:

```ts
export function customEpubPath(outputDir: string, storySlug: string, version: EpubVersion) {
  return join(outputDir, `${storySlug}-epub${version}.epub`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/storage/paths.test.ts -t "customEpubPath"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/storage/paths.ts tests/lib/storage/paths.test.ts
git commit -m "feat(storage): add customEpubPath helper for user-chosen export dirs"
```

---

### Task 2: Add `dir-probe.ts` writability probe

**Files:**
- Create: `lib/storage/dir-probe.ts`
- Create: `tests/lib/storage/dir-probe.test.ts`

The probe writes a uniquely-named 0-byte file to the target dir, then unlinks it. This is the only reliable cross-platform check (`fs.access(W_OK)` is unreliable on Windows). Returns a typed result so callers can map it to API errors directly.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/storage/dir-probe.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, chmod, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeWritableDir } from "@/lib/storage/dir-probe";

describe("probeWritableDir", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "scriptr-probe-"));
  });
  afterEach(async () => {
    await chmod(tmp, 0o755).catch(() => {});
    await rm(tmp, { recursive: true, force: true });
  });

  it("returns ok for an absolute, existing, writable directory", async () => {
    const result = await probeWritableDir(tmp);
    expect(result).toEqual({ ok: true });
  });

  it("returns 'not-absolute' for a relative path", async () => {
    const result = await probeWritableDir("./relative/path");
    expect(result).toEqual({ ok: false, reason: "not-absolute" });
  });

  it("returns 'not-found' when the directory does not exist", async () => {
    const result = await probeWritableDir(join(tmp, "missing"));
    expect(result).toEqual({ ok: false, reason: "not-found" });
  });

  it("returns 'not-a-directory' when the path is a file", async () => {
    const file = join(tmp, "afile");
    await writeFile(file, "x");
    const result = await probeWritableDir(file);
    expect(result).toEqual({ ok: false, reason: "not-a-directory" });
  });

  it("returns 'not-writable' when chmod 555 makes the dir read-only (POSIX)", async () => {
    if (process.platform === "win32") return; // chmod semantics differ on Windows
    const ro = join(tmp, "readonly");
    await mkdir(ro);
    await chmod(ro, 0o555);
    const result = await probeWritableDir(ro);
    expect(result).toEqual({ ok: false, reason: "not-writable" });
  });

  it("cleans up the probe file even on success (no leftover .scriptr-write-probe-* files)", async () => {
    await probeWritableDir(tmp);
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(tmp);
    expect(entries.filter((e) => e.startsWith(".scriptr-write-probe-"))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/storage/dir-probe.test.ts`
Expected: FAIL with "Cannot find module '@/lib/storage/dir-probe'".

- [ ] **Step 3: Implement `dir-probe.ts`**

Create `lib/storage/dir-probe.ts`:

```ts
import { isAbsolute, join } from "node:path";
import { stat, writeFile, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";

export type ProbeResult =
  | { ok: true }
  | { ok: false; reason: "not-absolute" | "not-found" | "not-a-directory" | "not-writable" };

/**
 * Verify that `dir` is an absolute, existing, writable directory by writing
 * and unlinking a uniquely-named 0-byte file. fs.access(W_OK) is unreliable
 * on Windows (it reads the read-only attribute, not effective ACLs); the
 * temp-file probe is the only check that's correct on every supported OS.
 */
export async function probeWritableDir(dir: string): Promise<ProbeResult> {
  if (!isAbsolute(dir)) return { ok: false, reason: "not-absolute" };
  let s;
  try {
    s = await stat(dir);
  } catch {
    return { ok: false, reason: "not-found" };
  }
  if (!s.isDirectory()) return { ok: false, reason: "not-a-directory" };
  const probePath = join(dir, `.scriptr-write-probe-${randomBytes(8).toString("hex")}`);
  try {
    await writeFile(probePath, "");
  } catch {
    return { ok: false, reason: "not-writable" };
  }
  try {
    await unlink(probePath);
  } catch {
    // Probe file written but couldn't be unlinked. Best-effort cleanup
    // failure shouldn't fail the probe — leaving a stray dotfile is
    // strictly preferable to telling the user the dir is unwritable when
    // it isn't.
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/storage/dir-probe.test.ts`
Expected: PASS (6 tests; the chmod test self-skips on Windows).

- [ ] **Step 5: Commit**

```bash
git add lib/storage/dir-probe.ts tests/lib/storage/dir-probe.test.ts
git commit -m "feat(storage): add probeWritableDir for export-location validation"
```

---

### Task 3: Add `defaultExportDir` to Config schema

**Files:**
- Modify: `lib/config.ts`
- Modify: `tests/lib/config.test.ts`

The route tests in Task 5 cover end-to-end persistence; this task adds a small unit test for the normalize/merge layer in `lib/config.ts` so a future refactor of the normalizer doesn't silently drop the field.

- [ ] **Step 1: Add the field to the `Config` type**

In `lib/config.ts`, modify the `Config` type at the top:

```ts
export type Config = {
  apiKey?: string;
  defaultModel: string;
  bindHost: "127.0.0.1" | "0.0.0.0";
  theme: "light" | "dark" | "system";
  autoRecap: boolean;
  includeLastChapterFullText: boolean;
  styleDefaults?: StyleRules;
  updates?: UpdatesConfig;
  penNameProfiles?: Record<string, PenNameProfile>;
  defaultExportDir?: string;  // absolute path; undefined = data-dir/<slug>/exports
};
```

- [ ] **Step 2: Update `normalizeConfigFromFile`**

In `lib/config.ts`, inside `normalizeConfigFromFile`, after the `penNameProfiles` block:

```ts
  if (typeof value.defaultExportDir === "string" && value.defaultExportDir.trim().length > 0) {
    out.defaultExportDir = value.defaultExportDir;
  }
```

(Empty strings are treated as "not set" — same shape as the unset case.)

- [ ] **Step 3: Update `mergeConfig`**

In `lib/config.ts`, inside `mergeConfig`, after the `penNameProfiles` block:

```ts
  if (hasOwn(partial, "defaultExportDir")) {
    next.defaultExportDir = partial.defaultExportDir;
  }
```

(Direct copy, mirroring `apiKey`'s shape: `undefined` clears, string sets.)

- [ ] **Step 4: Add a unit test in `tests/lib/config.test.ts`**

Inside the existing `describe("config", ...)` block, add:

```ts
it("loadConfig reads defaultExportDir from disk when present", async () => {
  await withTemp(async (dir) => {
    await writeFile(
      join(dir, "config.json"),
      JSON.stringify({ defaultExportDir: "/Users/chase/Books" }),
    );
    const cfg = await loadConfig(dir);
    expect(cfg.defaultExportDir).toBe("/Users/chase/Books");
  });
});

it("loadConfig treats empty-string defaultExportDir as unset", async () => {
  await withTemp(async (dir) => {
    await writeFile(
      join(dir, "config.json"),
      JSON.stringify({ defaultExportDir: "" }),
    );
    const cfg = await loadConfig(dir);
    expect(cfg.defaultExportDir).toBeUndefined();
  });
});

it("saveConfig persists defaultExportDir; clearing with undefined drops the field", async () => {
  await withTemp(async (dir) => {
    await saveConfig(dir, { defaultExportDir: "/Users/chase/Books" });
    expect((await loadConfig(dir)).defaultExportDir).toBe("/Users/chase/Books");
    await saveConfig(dir, { defaultExportDir: undefined });
    expect((await loadConfig(dir)).defaultExportDir).toBeUndefined();
  });
});
```

(`writeFile` is already imported at the top of the file.)

- [ ] **Step 5: Run config tests**

Run: `npx vitest run tests/lib/config.test.ts`
Expected: PASS — all tests including the three new defaultExportDir cases.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: PASS — no new errors.

- [ ] **Step 7: Commit**

```bash
git add lib/config.ts tests/lib/config.test.ts
git commit -m "feat(config): add defaultExportDir field to Config schema"
```

---

### Task 4: `writeEpub` accepts optional `outputDir`

**Files:**
- Modify: `lib/publish/epub-storage.ts`
- Modify: `tests/lib/publish-epub-storage.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/publish-epub-storage.test.ts` inside the existing `describe("epub-storage", ...)` block:

```ts
it("writeEpub with opts.outputDir writes to the override dir, not exports/", async () => {
  const story = await createStory(dir, { title: "Book" });
  const overrideDir = await mkdtemp(join(tmpdir(), "scriptr-override-"));
  try {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
    const path = await writeEpub(dir, story.slug, 3, bytes, { outputDir: overrideDir });
    expect(path).toBe(join(overrideDir, `${story.slug}-epub3.epub`));
    const stats = await stat(path);
    expect(stats.size).toBe(bytes.length);
    // The default exports/ dir must NOT have a stray file.
    const defaultPath = join(dir, "stories", story.slug, "exports", `${story.slug}-epub3.epub`);
    await expect(stat(defaultPath)).rejects.toThrow();
  } finally {
    await rm(overrideDir, { recursive: true, force: true });
  }
});

it("writeEpub with opts.outputDir creates the dir if it doesn't exist yet", async () => {
  const story = await createStory(dir, { title: "Book" });
  const overrideRoot = await mkdtemp(join(tmpdir(), "scriptr-override-"));
  const nested = join(overrideRoot, "nested", "subdir");
  try {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9]);
    const path = await writeEpub(dir, story.slug, 2, bytes, { outputDir: nested });
    expect(path).toBe(join(nested, `${story.slug}-epub2.epub`));
    const stats = await stat(path);
    expect(stats.size).toBe(bytes.length);
  } finally {
    await rm(overrideRoot, { recursive: true, force: true });
  }
});

it("writeEpub without opts.outputDir writes to exports/ as today (regression)", async () => {
  const story = await createStory(dir, { title: "Book" });
  const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1]);
  const path = await writeEpub(dir, story.slug, 3, bytes);
  expect(path.endsWith(`/exports/${story.slug}-epub3.epub`)).toBe(true);
});
```

(`mkdtemp` and `rm` are already imported at the top of the file — see existing imports.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/publish-epub-storage.test.ts -t "outputDir"`
Expected: FAIL — `writeEpub` doesn't yet accept the option, so the call signature is wrong (or option is ignored and file lands at the default path).

- [ ] **Step 3: Modify `writeEpub` to accept `opts.outputDir`**

In `lib/publish/epub-storage.ts`, make **two additive changes** — do NOT rewrite the file's full import list:

a. In the existing import block (currently `import { coverPath, epubPath, exportsDir, type EpubVersion } from "@/lib/storage/paths";`), add `customEpubPath` to the names. Add `dirname` to the existing `node:path` import (it's already there for the cover-related code, but if not, add `import { dirname } from "node:path";`):

```ts
import { coverPath, customEpubPath, epubPath, exportsDir, type EpubVersion } from "@/lib/storage/paths";
```

(Leave all other imports — `mkdir`, `writeFile`, `rename`, `stat`, `sharp` — untouched. They're used by other functions in this file.)

b. Replace ONLY the body of `writeEpub` (signature gains `opts?`):

```ts
export async function writeEpub(
  dataDir: string,
  slug: string,
  version: EpubVersion,
  bytes: Uint8Array,
  opts?: { outputDir?: string },
): Promise<string> {
  const finalPath = opts?.outputDir
    ? customEpubPath(opts.outputDir, slug, version)
    : epubPath(dataDir, slug, version);
  const tempPath = `${finalPath}.tmp`;
  await mkdir(dirname(finalPath), { recursive: true });
  await writeFile(tempPath, bytes);
  await rename(tempPath, finalPath);
  return finalPath;
}
```

(`dirname(epubPath(dataDir, slug, version))` is byte-equivalent to `exportsDir(dataDir, slug)`, so the unset case still mkdir's the same path. The existing `exportsDir` import remains used by other code paths in the file — leave it.)

If `dirname` is not yet imported in this file, add it to the existing `node:path` import block; otherwise leave that block alone.

- [ ] **Step 4: Run tests to verify all writeEpub cases pass**

Run: `npx vitest run tests/lib/publish-epub-storage.test.ts`
Expected: PASS — including the new outputDir tests AND existing tests.

- [ ] **Step 5: Commit**

```bash
git add lib/publish/epub-storage.ts tests/lib/publish-epub-storage.test.ts
git commit -m "feat(publish): writeEpub accepts opts.outputDir for user-chosen paths"
```

---

## Chunk 2: API routes — settings + export

### Task 5: Settings PUT/GET handle `defaultExportDir`

**Files:**
- Modify: `app/api/settings/route.ts`
- Modify: `tests/api/settings.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/api/settings.test.ts` inside the existing `describe("/api/settings", ...)` block. (`mkdir` and `chmod` need adding to the top imports.)

Add to top imports:
```ts
import { mkdir, chmod } from "node:fs/promises";
```

Add the test cases:
```ts
it("PUT { defaultExportDir: <valid abs writable dir> } persists, GET returns it", async () => {
  const out = await mkdtemp(join(tmpdir(), "scriptr-out-"));
  try {
    const putRes = await PUT(new Request("http://localhost/api/settings", {
      method: "PUT",
      body: JSON.stringify({ defaultExportDir: out }),
      headers: { "content-type": "application/json" },
    }) as unknown as NextRequest);
    expect(putRes.status).toBe(200);
    const putBody = await putRes.json();
    expect(putBody.ok).toBe(true);
    expect(putBody.data.defaultExportDir).toBe(out);

    const getRes = await GET();
    const getBody = await getRes.json();
    expect(getBody.data.defaultExportDir).toBe(out);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

it("PUT { defaultExportDir: null } clears the setting", async () => {
  const out = await mkdtemp(join(tmpdir(), "scriptr-out-"));
  try {
    // First, set it.
    await PUT(new Request("http://localhost/api/settings", {
      method: "PUT",
      body: JSON.stringify({ defaultExportDir: out }),
      headers: { "content-type": "application/json" },
    }) as unknown as NextRequest);
    // Then clear.
    const clearRes = await PUT(new Request("http://localhost/api/settings", {
      method: "PUT",
      body: JSON.stringify({ defaultExportDir: null }),
      headers: { "content-type": "application/json" },
    }) as unknown as NextRequest);
    expect(clearRes.status).toBe(200);
    const clearBody = await clearRes.json();
    expect(clearBody.data.defaultExportDir).toBeNull();

    const getRes = await GET();
    const getBody = await getRes.json();
    expect(getBody.data.defaultExportDir).toBeUndefined();
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

it("PUT rejects relative paths with 400", async () => {
  const res = await PUT(new Request("http://localhost/api/settings", {
    method: "PUT",
    body: JSON.stringify({ defaultExportDir: "./relative" }),
    headers: { "content-type": "application/json" },
  }) as unknown as NextRequest);
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error).toMatch(/absolute/i);
});

it("PUT rejects nonexistent paths with 400", async () => {
  const res = await PUT(new Request("http://localhost/api/settings", {
    method: "PUT",
    body: JSON.stringify({ defaultExportDir: join(tmpDir, "does-not-exist") }),
    headers: { "content-type": "application/json" },
  }) as unknown as NextRequest);
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error).toMatch(/not exist|not found|enoent/i);
});

it("PUT rejects non-directory paths (file) with 400", async () => {
  const f = join(tmpDir, "regular-file");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(f, "x");
  const res = await PUT(new Request("http://localhost/api/settings", {
    method: "PUT",
    body: JSON.stringify({ defaultExportDir: f }),
    headers: { "content-type": "application/json" },
  }) as unknown as NextRequest);
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error).toMatch(/directory/i);
});

it("PUT rejects non-string non-null with 400", async () => {
  const res = await PUT(new Request("http://localhost/api/settings", {
    method: "PUT",
    body: JSON.stringify({ defaultExportDir: 42 }),
    headers: { "content-type": "application/json" },
  }) as unknown as NextRequest);
  expect(res.status).toBe(400);
});

it("GET on fresh install returns defaultExportDir as undefined", async () => {
  const res = await GET();
  const body = await res.json();
  expect(body.data.defaultExportDir).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/api/settings.test.ts -t "defaultExportDir"`
Expected: All 7 tests FAIL — the field isn't handled yet.

- [ ] **Step 3: Implement validation in the settings route**

In `app/api/settings/route.ts`, add at the top of the `PUT` body parsing (after existing `penNameProfiles` block, just before `const next = await saveConfig(...)`):

```ts
import { probeWritableDir } from "@/lib/storage/dir-probe";

// ... within PUT handler, after the penNameProfiles block:

  if (hasOwn(body, "defaultExportDir")) {
    if (body.defaultExportDir === null || body.defaultExportDir === "") {
      patch.defaultExportDir = undefined;
    } else if (typeof body.defaultExportDir === "string") {
      const probe = await probeWritableDir(body.defaultExportDir);
      if (!probe.ok) {
        const detail =
          probe.reason === "not-absolute"
            ? "must be an absolute path"
            : probe.reason === "not-found"
            ? "directory does not exist"
            : probe.reason === "not-a-directory"
            ? "path is not a directory"
            : "directory is not writable";
        return fail(`defaultExportDir ${detail}`, 400);
      }
      patch.defaultExportDir = body.defaultExportDir;
    } else {
      return fail("defaultExportDir must be a string or null", 400);
    }
  }
```

Update the `GET` response to include the field:

```ts
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
    styleDefaults: cfg.styleDefaults,
    updates: cfg.updates,
    penNameProfiles: cfg.penNameProfiles,
    defaultExportDir: cfg.defaultExportDir,
    isElectron: Boolean(process.versions.electron),
  });
}
```

Update the `PUT` response to also include `defaultExportDir`. **Preserve the existing returned fields exactly**; only add the new key:

```ts
  const next = await saveConfig(effectiveDataDir(), patch);
  return ok({
    hasKey: Boolean(next.apiKey),
    keyPreview: mask(next.apiKey),
    defaultExportDir: next.defaultExportDir ?? null,
  });
```

(The existing PUT response shape is `{ hasKey, keyPreview }`; adding one more key is a backwards-compatible additive change — existing consumers ignore unknown keys. Confirm by skimming `tests/api/settings.test.ts` for any assertion of the form `expect(body.data).toEqual({ ... })` — if that exists, the test must be updated to allow the new key. As of today, the existing tests only assert specific fields with `expect(body.data.<field>).toBe(...)`, so the change is safe.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/api/settings.test.ts`
Expected: PASS — all settings tests, new + existing.

- [ ] **Step 5: Commit**

```bash
git add app/api/settings/route.ts tests/api/settings.test.ts
git commit -m "feat(settings): persist & validate defaultExportDir in /api/settings"
```

---

### Task 6: Export route accepts `outputDir`, resolves effective dir

**Files:**
- Modify: `app/api/stories/[slug]/export/epub/route.ts`
- Modify: `tests/api/export.epub.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/api/export.epub.test.ts` inside the existing `describe("/api/stories/[slug]/export/epub POST", ...)` block. Add `mkdtemp` to the imports if not already there (it is).

```ts
it("writes to body.outputDir when provided", async () => {
  const out = await mkdtemp(join(tmpdir(), "scriptr-out-"));
  try {
    const story = await createStory(tmpDir, { title: "Book" });
    await createImportedChapter(tmpDir, story.slug, {
      title: "One",
      sectionContents: ["Hello, world."],
    });
    const res = await callPost(story.slug, { version: 3, outputDir: out });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.path).toBe(join(out, `${story.slug}-epub3.epub`));
    const s = await stat(body.data.path);
    expect(s.isFile()).toBe(true);
    // Default location must NOT have been written.
    await expect(stat(epubPath(tmpDir, story.slug, 3))).rejects.toThrow();
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

it("falls back to config.defaultExportDir when body.outputDir absent", async () => {
  const out = await mkdtemp(join(tmpdir(), "scriptr-out-"));
  try {
    await saveConfig(tmpDir, { defaultExportDir: out });
    const story = await createStory(tmpDir, { title: "Book" });
    await createImportedChapter(tmpDir, story.slug, {
      title: "One",
      sectionContents: ["Hello, world."],
    });
    const res = await callPost(story.slug, { version: 3 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.path).toBe(join(out, `${story.slug}-epub3.epub`));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

it("body.outputDir takes precedence over config.defaultExportDir", async () => {
  const cfgOut = await mkdtemp(join(tmpdir(), "scriptr-cfg-"));
  const bodyOut = await mkdtemp(join(tmpdir(), "scriptr-body-"));
  try {
    await saveConfig(tmpDir, { defaultExportDir: cfgOut });
    const story = await createStory(tmpDir, { title: "Book" });
    await createImportedChapter(tmpDir, story.slug, {
      title: "One",
      sectionContents: ["Hi"],
    });
    const res = await callPost(story.slug, { version: 3, outputDir: bodyOut });
    const body = await res.json();
    expect(body.data.path).toBe(join(bodyOut, `${story.slug}-epub3.epub`));
    await expect(stat(join(cfgOut, `${story.slug}-epub3.epub`))).rejects.toThrow();
  } finally {
    await rm(cfgOut, { recursive: true, force: true });
    await rm(bodyOut, { recursive: true, force: true });
  }
});

it("returns 400 when body.outputDir is invalid", async () => {
  const story = await createStory(tmpDir, { title: "Book" });
  await createImportedChapter(tmpDir, story.slug, {
    title: "One",
    sectionContents: ["Hi"],
  });
  const res = await callPost(story.slug, { version: 3, outputDir: "./nope" });
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error).toMatch(/absolute/i);
});

it("with no outputDir set anywhere, falls back to data-dir/exports/ (regression)", async () => {
  const story = await createStory(tmpDir, { title: "Book" });
  await createImportedChapter(tmpDir, story.slug, {
    title: "One",
    sectionContents: ["Hi"],
  });
  const res = await callPost(story.slug, { version: 3 });
  const body = await res.json();
  expect(body.data.path).toBe(epubPath(tmpDir, story.slug, 3));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/api/export.epub.test.ts -t "outputDir|defaultExportDir|fallback"`
Expected: FAIL — route ignores `outputDir`, file lands at default location.

- [ ] **Step 3: Implement in the route**

In `app/api/stories/[slug]/export/epub/route.ts`, make three small additive edits.

a. Add to the existing imports block:
```ts
import { probeWritableDir } from "@/lib/storage/dir-probe";
```

b. Add a `bodyOutputDir` variable + parse step inside the existing body-parsing block. Find this block (currently in the route):

```ts
    if (body.version !== undefined) {
      if (body.version !== 2 && body.version !== 3) {
        return fail("version must be 2 or 3", 400);
      }
      version = body.version as EpubVersion;
    }
  }
```

Replace with:

```ts
    if (body.version !== undefined) {
      if (body.version !== 2 && body.version !== 3) {
        return fail("version must be 2 or 3", 400);
      }
      version = body.version as EpubVersion;
    }
    if (body.outputDir !== undefined && body.outputDir !== null) {
      if (typeof body.outputDir !== "string") {
        return fail("outputDir must be a string", 400);
      }
      bodyOutputDir = body.outputDir;
    }
  }
```

Also: the body cast must include the new field. Find the line `const body = parsed as { version?: unknown };` and change it to:

```ts
    const body = parsed as { version?: unknown; outputDir?: unknown };
```

And declare `bodyOutputDir` at the same scope as `version`. Find `let version: EpubVersion = 3;` and add immediately below:

```ts
  let bodyOutputDir: string | undefined;
```

After the existing `const cfg = await loadConfig(dataDir);` line, resolve the effective output dir and validate:

```ts
  // Effective output dir: explicit body → config default → data-dir fallback (undefined here).
  const effectiveOutputDir = bodyOutputDir ?? cfg.defaultExportDir;
  if (effectiveOutputDir !== undefined) {
    const probe = await probeWritableDir(effectiveOutputDir);
    if (!probe.ok) {
      const detail =
        probe.reason === "not-absolute"
          ? "must be an absolute path"
          : probe.reason === "not-found"
          ? "directory does not exist"
          : probe.reason === "not-a-directory"
          ? "path is not a directory"
          : "directory is not writable";
      return fail(`outputDir ${detail}`, 400);
    }
  }
```

Replace the `writeEpub` call:

```ts
  const path = await writeEpub(dataDir, slug, version, bytes, {
    outputDir: effectiveOutputDir,
  });
```

(`writeEpub` already handles `outputDir: undefined` as "use default" from Task 4.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/api/export.epub.test.ts`
Expected: PASS — all tests including new `outputDir`/fallback cases AND existing tests.

- [ ] **Step 5: Commit**

```bash
git add 'app/api/stories/[slug]/export/epub/route.ts' tests/api/export.epub.test.ts
git commit -m "feat(export): route accepts outputDir, falls back to config default"
```

---

### Task 7: Extend privacy egress test

**Files:**
- Modify: `tests/privacy/no-external-egress.test.ts`

- [ ] **Step 1: Add the new route call to the test**

In `tests/privacy/no-external-egress.test.ts`, locate the existing `// ── PUT /api/settings ──` section. After the existing PUT call there, add a second PUT that exercises the `defaultExportDir: null` clear path:

```ts
    // ── PUT /api/settings { defaultExportDir: null } (no fs touched on clear) ──
    {
      const { PUT } = await import("@/app/api/settings/route");
      const req = new Request("http://localhost/api/settings", {
        method: "PUT",
        body: JSON.stringify({ defaultExportDir: null }),
        headers: { "content-type": "application/json" },
      }) as unknown as NextRequest;
      const res = await PUT(req);
      expect(res.status).toBe(200);
    }
```

(Using `null` avoids needing the test's mock data dir to contain a real writable directory; the validation short-circuits and the route still runs end-to-end. The point of the egress test is to verify no `fetch` fires, not to exercise every input shape.)

Also update the documentation block at the top of the file to mention this new exercise. Find the `/api/settings` line in the "ROUTES EXERCISED" comment and adjust:

```ts
 *   GET  /api/settings
 *   PUT  /api/settings  (×2: one with apiKey/style fields, one to clear defaultExportDir)
```

- [ ] **Step 2: Run the egress test**

Run: `npx vitest run tests/privacy/no-external-egress.test.ts`
Expected: PASS — `recorded` array still empty.

- [ ] **Step 3: Commit**

```bash
git add tests/privacy/no-external-egress.test.ts
git commit -m "test(privacy): exercise defaultExportDir clear in egress test"
```

---

## Chunk 3: Electron preload + IPC

This chunk introduces a tiny preload script and three IPC handlers. The preload is the renderer's only privileged surface — keep it minimal.

### Task 8: Create `electron/preload.ts`

**Files:**
- Create: `electron/preload.ts`
- Create: `tests/electron/preload-bridge.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/electron/preload-bridge.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Verify that electron/preload.ts exposes ONLY the three documented methods
 * via contextBridge. The renderer's privileged surface is the preload bridge
 * — anything exposed here is reachable from a compromised renderer.
 */
describe("electron/preload bridge", () => {
  let exposed: Record<string, unknown> = {};

  beforeEach(() => {
    exposed = {};
    vi.resetModules();
    vi.doMock("electron", () => ({
      contextBridge: {
        exposeInMainWorld: (key: string, value: unknown) => {
          exposed[key] = value;
        },
      },
      ipcRenderer: {
        invoke: vi.fn(),
      },
    }));
  });

  it("exposes only `scriptr` to the main world, with three methods", async () => {
    await import("../../electron/preload");
    expect(Object.keys(exposed)).toEqual(["scriptr"]);
    const api = exposed.scriptr as Record<string, unknown>;
    expect(typeof api.pickFolder).toBe("function");
    expect(typeof api.revealInFolder).toBe("function");
    expect(typeof api.openFile).toBe("function");
    expect(Object.keys(api).sort()).toEqual([
      "openFile",
      "pickFolder",
      "revealInFolder",
    ]);
  });

  it("each method invokes its expected IPC channel", async () => {
    const electron = await import("electron");
    const invoke = (electron.ipcRenderer.invoke as ReturnType<typeof vi.fn>);
    invoke.mockResolvedValue("ok");

    await import("../../electron/preload");
    const api = exposed.scriptr as {
      pickFolder: () => Promise<unknown>;
      revealInFolder: (p: string) => Promise<unknown>;
      openFile: (p: string) => Promise<unknown>;
    };

    await api.pickFolder();
    expect(invoke).toHaveBeenCalledWith("dialog:pickFolder");

    invoke.mockClear();
    await api.revealInFolder("/abs/path/file.epub");
    expect(invoke).toHaveBeenCalledWith("shell:revealInFolder", "/abs/path/file.epub");

    invoke.mockClear();
    await api.openFile("/abs/path/file.epub");
    expect(invoke).toHaveBeenCalledWith("shell:openFile", "/abs/path/file.epub");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/electron/preload-bridge.test.ts`
Expected: FAIL — `electron/preload.ts` does not exist.

- [ ] **Step 3: Implement `electron/preload.ts`**

Create `electron/preload.ts`:

```ts
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("scriptr", {
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke("dialog:pickFolder"),
  revealInFolder: (path: string): Promise<void> =>
    ipcRenderer.invoke("shell:revealInFolder", path),
  openFile: (path: string): Promise<void> =>
    ipcRenderer.invoke("shell:openFile", path),
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/electron/preload-bridge.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run electron compile to confirm preload builds**

Run: `npm run build:electron`
Expected: PASS — `dist/electron/preload.js` and its `.map` are produced. Confirm:

```bash
ls dist/electron/preload.js
```

- [ ] **Step 6: Commit**

```bash
git add electron/preload.ts tests/electron/preload-bridge.test.ts
git commit -m "feat(electron): preload exposing pickFolder/revealInFolder/openFile"
```

---

### Task 9: Wire preload + IPC handlers in `electron/main.ts`

**Files:**
- Modify: `electron/main.ts`

This task wires the preload into the BrowserWindow and adds three `ipcMain.handle` registrations with path validation.

The validation policy: `revealInFolder` and `openFile` accept absolute paths under either the active data dir (`appDataDir`) or the user's configured `defaultExportDir` (read fresh per invocation so it tracks user changes). Anything outside both roots is rejected — a compromised renderer cannot ask Electron to reveal `/etc/passwd` or open `~/.ssh/id_rsa`.

- [ ] **Step 1: Add imports**

In `electron/main.ts`, update the existing electron import line:

```ts
import { app, BrowserWindow, Menu, dialog, shell, session, ipcMain } from "electron";
```

Add to the imports section:

```ts
import { isAbsolute, resolve as resolvePath, sep } from "node:path";
```

- [ ] **Step 2: Add preload to BrowserWindow webPreferences**

In `createMainWindow`, modify the `webPreferences` block to add `preload`:

```ts
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      devTools: isDev,
      spellcheck: false,
    },
```

- [ ] **Step 3: Add IPC handlers**

After the existing `app.on("web-contents-created", ...)` block (around line 81 in the current file), add a new section:

```ts
// ─── IPC handlers (renderer → main) ──────────────────────────────────────────
//
// Three handlers expose folder picking and shell-level reveal/open so the
// export page can offer desktop-native UX. All renderer→main inputs are
// validated here. Path-accepting handlers restrict targets to roots the user
// has already chosen (the data dir or their configured defaultExportDir) so
// a compromised renderer can't ask Electron to reveal/open arbitrary system
// files. Registered globally; harmless when scriptr's own renderer isn't the
// caller because no other origin can reach ipcMain.

ipcMain.handle("dialog:pickFolder", async () => {
  const targetWindow = mainWindow ?? undefined;
  const result = await (targetWindow
    ? dialog.showOpenDialog(targetWindow, {
        properties: ["openDirectory", "createDirectory"],
        title: "Choose EPUB output folder",
      })
    : dialog.showOpenDialog({
        properties: ["openDirectory", "createDirectory"],
        title: "Choose EPUB output folder",
      }));
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

async function pathIsUnderAllowedRoot(target: string): Promise<boolean> {
  if (typeof target !== "string" || !isAbsolute(target)) return false;
  // appDataDir is set once during `main()` after `resolveDataDir(...)` resolves.
  // If a renderer somehow calls reveal/open BEFORE that — there should be no
  // window yet, so this would only fire for an unexpected pre-window IPC —
  // we conservatively reject. Once the window is open, appDataDir is always
  // populated, so this is effectively a tightening for an impossible case.
  if (!appDataDir) return false;
  const normalized = resolvePath(target);
  const roots: string[] = [resolvePath(appDataDir)];
  // Re-read config every call so a freshly-saved defaultExportDir is honored
  // without requiring the renderer to reload.
  try {
    const cfg = await loadConfig(appDataDir);
    if (cfg.defaultExportDir) roots.push(resolvePath(cfg.defaultExportDir));
  } catch {
    // Config read failures fall through; only data-dir is allowed.
  }
  return roots.some((root) => normalized === root || normalized.startsWith(root + sep));
}

ipcMain.handle("shell:revealInFolder", async (_e, target: unknown) => {
  if (typeof target !== "string") throw new Error("path must be a string");
  if (!(await pathIsUnderAllowedRoot(target))) {
    throw new Error("path is outside allowed roots");
  }
  shell.showItemInFolder(target);
});

ipcMain.handle("shell:openFile", async (_e, target: unknown) => {
  if (typeof target !== "string") throw new Error("path must be a string");
  if (!(await pathIsUnderAllowedRoot(target))) {
    throw new Error("path is outside allowed roots");
  }
  const errMsg = await shell.openPath(target);
  // shell.openPath returns "" on success and an error message string on failure.
  if (errMsg !== "") throw new Error(errMsg);
});
```

(The `loadConfig` import already exists at the top of the file.)

- [ ] **Step 4: Run electron compile**

Run: `npm run build:electron`
Expected: PASS — `dist/electron/main.js` rebuilds without errors.

- [ ] **Step 5: Run typecheck on the whole project**

Run: `npm run typecheck`
Expected: PASS — no new errors.

- [ ] **Step 6: Commit**

```bash
git add electron/main.ts
git commit -m "feat(electron): preload + IPC handlers for folder picker / reveal / open"
```

---

## Chunk 4: ExportPage UI

The renderer changes — output-location input + picker, error-handling rewrite, success-card buttons.

### Task 10: handleBuild visibility rewrite

**Files:**
- Modify: `components/publish/ExportPage.tsx`
- Modify: `tests/components/publish/ExportPage.test.tsx`

This is the load-bearing fix for the silent-failure symptom. Independent of the new feature.

- [ ] **Step 1: Write the failing tests**

Add to `tests/components/publish/ExportPage.test.tsx`. The file already mocks `sonner` and `fetch` at the top — reuse those.

```ts
import { toast } from "sonner";

describe("ExportPage — handleBuild error visibility", () => {
  beforeEach(() => {
    mockFetch.mockClear();
    (toast.error as ReturnType<typeof vi.fn>).mockClear();
    (toast.success as ReturnType<typeof vi.fn>).mockClear();
  });

  it("toasts an error when the export route returns 500 with an HTML body", async () => {
    // First call(s): /api/settings GET fired by the new output-location section.
    // Then the build POST: 500.
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true, data: { isElectron: false, defaultExportDir: undefined } }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve("<html>boom: epub-gen-memory exploded</html>"),
      } as unknown as Response);

    const { container, unmount } = mount(
      <ExportPage story={baseStory} chapterCount={1} wordCount={500} />,
    );
    try {
      const buildBtn = container.querySelector<HTMLButtonElement>(
        '[data-testid="export-build"]',
      );
      expect(buildBtn).not.toBeNull();
      await act(async () => {
        buildBtn!.click();
      });
      // sonner is mocked; check that toast.error fired with status + body excerpt
      const errCalls = (toast.error as ReturnType<typeof vi.fn>).mock.calls;
      expect(errCalls.length).toBeGreaterThan(0);
      expect(String(errCalls[0][0])).toMatch(/500/);
      expect(String(errCalls[0][0])).toMatch(/boom/);
      expect((toast.success as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    } finally {
      unmount();
    }
  });

  it("toasts an error when fetch itself rejects (network failure)", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true, data: { isElectron: false, defaultExportDir: undefined } }),
      } as unknown as Response)
      .mockRejectedValueOnce(new Error("Failed to fetch"));

    const { container, unmount } = mount(
      <ExportPage story={baseStory} chapterCount={1} wordCount={500} />,
    );
    try {
      const buildBtn = container.querySelector<HTMLButtonElement>(
        '[data-testid="export-build"]',
      );
      await act(async () => {
        buildBtn!.click();
      });
      const errCalls = (toast.error as ReturnType<typeof vi.fn>).mock.calls;
      expect(errCalls.length).toBeGreaterThan(0);
      expect(String(errCalls[0][0])).toMatch(/Failed to fetch/);
    } finally {
      unmount();
    }
  });

  it("toasts success with the saved path when the route returns ok", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true, data: { isElectron: false, defaultExportDir: undefined } }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          ok: true,
          data: { path: "/Users/chase/Books/x-epub3.epub", bytes: 12345, version: 3, warnings: [] },
        }),
      } as unknown as Response);

    const { container, unmount } = mount(
      <ExportPage story={baseStory} chapterCount={1} wordCount={500} />,
    );
    try {
      const buildBtn = container.querySelector<HTMLButtonElement>(
        '[data-testid="export-build"]',
      );
      await act(async () => {
        buildBtn!.click();
      });
      const succCalls = (toast.success as ReturnType<typeof vi.fn>).mock.calls;
      expect(succCalls.length).toBe(1);
      expect(String(succCalls[0][0])).toMatch(/x-epub3\.epub/);
    } finally {
      unmount();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/publish/ExportPage.test.tsx -t "error visibility"`
Expected: FAIL — current code throws on `res.json()` for HTML 500 (no error toast); fetch-rejection test fails because there's no `catch`.

(Tests may also fail because the new `/api/settings` GET call doesn't yet exist in the component. That's fine — Task 11 adds it. For now, the test mocks the call so the assertion still works.)

- [ ] **Step 3: Rewrite `handleBuild`**

In `components/publish/ExportPage.tsx`, replace the entire `handleBuild` function (currently lines 90-109):

```ts
  const handleBuild = async () => {
    setBuilding(true);
    try {
      const res = await fetch(`/api/stories/${story.slug}/export/epub`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: selectedVersion }),
      });
      if (!res.ok) {
        // Tolerate HTML 500 bodies. The server returns JSON for 4xx errors;
        // a 500 from an unhandled exception comes back as Next's error HTML.
        const text = await res.text();
        toast.error(`Build failed (${res.status}): ${text.slice(0, 200)}`);
        return;
      }
      const body = await res.json();
      if (!body.ok) {
        toast.error(body.error ?? "Build failed");
        return;
      }
      const built: LastBuild = body.data;
      setLastBuildByVersion((prev) => ({ ...prev, [built.version]: built }));
      toast.success(`EPUB ${built.version} saved to ${built.path}`);
    } catch (err) {
      toast.error(`Build failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBuilding(false);
    }
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/components/publish/ExportPage.test.tsx -t "error visibility"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add components/publish/ExportPage.tsx tests/components/publish/ExportPage.test.tsx
git commit -m "fix(export-ui): surface build failures as toasts (no more silent 500s)"
```

---

### Task 11: Add Output Location section to ExportPage

**Files:**
- Modify: `components/publish/ExportPage.tsx`
- Modify: `tests/components/publish/ExportPage.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `tests/components/publish/ExportPage.test.tsx`:

```ts
describe("ExportPage — output location section", () => {
  beforeEach(() => {
    mockFetch.mockClear();
    (toast.error as ReturnType<typeof vi.fn>).mockClear();
    (toast.success as ReturnType<typeof vi.fn>).mockClear();
    // Clean up window.scriptr between tests
    delete (window as unknown as { scriptr?: unknown }).scriptr;
  });

  it("shows the current default export dir from /api/settings on mount", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        data: { isElectron: true, defaultExportDir: "/Users/chase/Books" },
      }),
    } as unknown as Response);

    let result!: ReturnType<typeof mount>;
    await act(async () => {
      result = mount(<ExportPage story={baseStory} chapterCount={1} wordCount={500} />);
    });
    try {
      const input = result.container.querySelector<HTMLInputElement>(
        '[data-testid="export-output-dir"]',
      );
      expect(input).not.toBeNull();
      expect(input!.value).toBe("/Users/chase/Books");
    } finally {
      result.unmount();
    }
  });

  it("hides the 'Choose folder…' button when isElectron is false", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        data: { isElectron: false, defaultExportDir: undefined },
      }),
    } as unknown as Response);

    let result!: ReturnType<typeof mount>;
    await act(async () => {
      result = mount(<ExportPage story={baseStory} chapterCount={1} wordCount={500} />);
    });
    try {
      expect(
        result.container.querySelector('[data-testid="export-pick-folder"]'),
      ).toBeNull();
    } finally {
      result.unmount();
    }
  });

  it("shows the 'Choose folder…' button when isElectron and window.scriptr exist", async () => {
    (window as unknown as { scriptr: unknown }).scriptr = {
      pickFolder: vi.fn().mockResolvedValue(null),
      revealInFolder: vi.fn(),
      openFile: vi.fn(),
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        data: { isElectron: true, defaultExportDir: undefined },
      }),
    } as unknown as Response);

    let result!: ReturnType<typeof mount>;
    await act(async () => {
      result = mount(<ExportPage story={baseStory} chapterCount={1} wordCount={500} />);
    });
    try {
      expect(
        result.container.querySelector('[data-testid="export-pick-folder"]'),
      ).not.toBeNull();
    } finally {
      result.unmount();
    }
  });

  it("clicking 'Choose folder…' calls window.scriptr.pickFolder and saves on selection", async () => {
    const pickFolder = vi.fn().mockResolvedValue("/picked/dir");
    (window as unknown as { scriptr: unknown }).scriptr = {
      pickFolder,
      revealInFolder: vi.fn(),
      openFile: vi.fn(),
    };
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: { isElectron: true, defaultExportDir: undefined },
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: { defaultExportDir: "/picked/dir" },
        }),
      } as unknown as Response);

    let result!: ReturnType<typeof mount>;
    await act(async () => {
      result = mount(<ExportPage story={baseStory} chapterCount={1} wordCount={500} />);
    });
    try {
      const btn = result.container.querySelector<HTMLButtonElement>(
        '[data-testid="export-pick-folder"]',
      );
      await act(async () => {
        btn!.click();
      });
      expect(pickFolder).toHaveBeenCalledTimes(1);
      // PUT call to /api/settings with the picked dir
      const putCall = mockFetch.mock.calls.find(
        (c) => String(c[0]).includes("/api/settings") && (c[1] as RequestInit | undefined)?.method === "PUT",
      );
      expect(putCall).toBeTruthy();
      expect(JSON.parse(String((putCall![1] as RequestInit).body))).toEqual({
        defaultExportDir: "/picked/dir",
      });
      const input = result.container.querySelector<HTMLInputElement>(
        '[data-testid="export-output-dir"]',
      );
      expect(input!.value).toBe("/picked/dir");
    } finally {
      result.unmount();
    }
  });

  it("PUT 400 rolls input back to last-saved value and toasts the error", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: { isElectron: false, defaultExportDir: "/saved/dir" },
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ ok: false, error: "defaultExportDir directory does not exist" }),
      } as unknown as Response);

    let result!: ReturnType<typeof mount>;
    await act(async () => {
      result = mount(<ExportPage story={baseStory} chapterCount={1} wordCount={500} />);
    });
    // Wait one extra microtask tick so the mount-effect's GET .then() runs and
    // savedOutputDirRef is populated BEFORE we type into the input. Without
    // this, blur would compare against an empty saved value and the test
    // could pass for the wrong reason.
    await act(async () => { await Promise.resolve(); });
    try {
      const input = result.container.querySelector<HTMLInputElement>(
        '[data-testid="export-output-dir"]',
      );
      // Pre-condition: GET populated the input with the saved value.
      expect(input!.value).toBe("/saved/dir");

      // Simulate user typing a bad value, then blur.
      await act(async () => {
        // React-controlled input: dispatch a real input event so React's
        // synthetic event system observes the new value.
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        )!.set!;
        setter.call(input, "/does/not/exist");
        input!.dispatchEvent(new Event("input", { bubbles: true }));
        input!.dispatchEvent(new Event("blur", { bubbles: true }));
      });
      // Drain the PUT's .then() chain so the rollback setState lands.
      await act(async () => { await Promise.resolve(); });
      // After the failing PUT, value should roll back to "/saved/dir".
      expect(input!.value).toBe("/saved/dir");
      expect((toast.error as ReturnType<typeof vi.fn>).mock.calls[0][0])
        .toMatch(/does not exist/);
    } finally {
      result.unmount();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/publish/ExportPage.test.tsx -t "output location"`
Expected: FAIL — `data-testid="export-output-dir"` doesn't exist yet.

- [ ] **Step 3: Implement the section in `ExportPage.tsx`**

Add new state, mount-effect for `/api/settings`, and the section markup. The full edit is long; the contract:

1. On mount, `GET /api/settings` to read `isElectron` and `defaultExportDir`. Store both. Use a `useEffect`. Initialize `outputDirDraft` from the GET response and a `savedOutputDir` ref to track the last-good value.
2. Render the new section after Cover, before Build.
3. On input blur (and on picker success), call `saveOutputDir(value)` which PUTs `/api/settings` with `{ defaultExportDir: value || null }`. On 400, toast error and roll back the draft to `savedOutputDir`. On 200, update `savedOutputDir` from the response.
4. The picker button is rendered iff `isElectron && typeof window !== 'undefined' && window.scriptr?.pickFolder`.
5. Reset button rendered iff `outputDirDraft` is non-empty.

Concrete patches:

a. Add to top imports:

```ts
import { useEffect, useState, useRef, type KeyboardEvent } from "react";
```

(`useEffect` and `useRef` are new; the other two already exist.)

b. Add a TS declaration block at the top of the file (after imports, before `type Props`):

```ts
declare global {
  interface Window {
    scriptr?: {
      pickFolder: () => Promise<string | null>;
      revealInFolder: (path: string) => Promise<void>;
      openFile: (path: string) => Promise<void>;
    };
  }
}
```

c. Add new state inside the component body, after the existing `useState` calls:

```ts
  const [isElectron, setIsElectron] = useState(false);
  const [outputDirDraft, setOutputDirDraft] = useState<string>("");
  const savedOutputDirRef = useRef<string>("");

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/settings")
      .then((r) => r.json())
      .then((body) => {
        if (cancelled || !body?.ok) return;
        setIsElectron(Boolean(body.data?.isElectron));
        const initial: string = body.data?.defaultExportDir ?? "";
        setOutputDirDraft(initial);
        savedOutputDirRef.current = initial;
      })
      .catch(() => {
        // First-load failure is non-fatal; user can still build EPUBs into
        // the data-dir default. No toast — the page is otherwise usable.
      });
    return () => { cancelled = true; };
  }, []);

  const saveOutputDir = async (value: string | null) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ defaultExportDir: value }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        toast.error(body.error ?? "Failed to save output directory");
        // Roll back input to last-good value
        setOutputDirDraft(savedOutputDirRef.current);
        return;
      }
      const persisted: string = body.data?.defaultExportDir ?? "";
      savedOutputDirRef.current = persisted;
      // If server normalized (e.g. trimmed), reflect it in the input
      setOutputDirDraft(persisted);
    } catch (err) {
      toast.error(`Failed to save output directory: ${err instanceof Error ? err.message : String(err)}`);
      setOutputDirDraft(savedOutputDirRef.current);
    }
  };

  const handleOutputDirBlur = () => {
    const trimmed = outputDirDraft.trim();
    if (trimmed === savedOutputDirRef.current) return;
    void saveOutputDir(trimmed === "" ? null : trimmed);
  };

  const handlePickFolder = async () => {
    if (!window.scriptr?.pickFolder) return;
    const picked = await window.scriptr.pickFolder();
    if (picked) {
      setOutputDirDraft(picked);
      await saveOutputDir(picked);
    }
  };

  const handleResetOutputDir = () => {
    setOutputDirDraft("");
    void saveOutputDir(null);
  };
```

d. Add the new section in the JSX. Locate the existing right-column structure inside the `ExportPage` component's return:

```tsx
      <div className="flex flex-col gap-5">
        <div>
          <h2 className="text-sm font-semibold mb-2">Cover image</h2>
          ...
        </div>

        <div className="border-t border-border pt-4">       {/* ← THIS IS THE EXISTING "Build" SECTION */}
          <h2 className="text-sm font-semibold mb-1">Build</h2>
          ...
```

Insert the snippet below as a NEW SIBLING between the Cover-image div and the existing Build div. The snippet's outer `<div className="border-t border-border pt-4">` is its OWN wrapper (matching the Build section's styling) — there are now TWO divs with that class side-by-side, which is the intended layout (one per section, separated by the top border):

```tsx
        <div className="border-t border-border pt-4">
          <h2 className="text-sm font-semibold mb-1">Output location</h2>
          <Input
            type="text"
            data-testid="export-output-dir"
            placeholder="Default: <data dir>/stories/<slug>/exports/"
            value={outputDirDraft}
            onChange={(e) => setOutputDirDraft(e.target.value)}
            onBlur={handleOutputDirBlur}
            className="text-xs font-mono"
          />
          <div className="flex items-center gap-2 mt-2">
            {isElectron && typeof window !== "undefined" && window.scriptr?.pickFolder && (
              <Button
                variant="secondary"
                size="sm"
                data-testid="export-pick-folder"
                onClick={() => void handlePickFolder()}
              >
                Choose folder…
              </Button>
            )}
            {outputDirDraft && (
              <Button
                variant="ghost"
                size="sm"
                data-testid="export-reset-output-dir"
                onClick={handleResetOutputDir}
              >
                Reset to default
              </Button>
            )}
          </div>
          {!outputDirDraft && (
            <p className="text-xs text-muted-foreground mt-2">
              Files land in the story's <code>exports/</code> folder by default.
            </p>
          )}
        </div>
```

(`Button` is already imported. `Input` is already imported. After this insertion the right column contains, in order: Cover image / Output location / Build / success cards.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/components/publish/ExportPage.test.tsx`
Expected: PASS — all tests including new output-location tests AND existing roving-tabindex tests.

- [ ] **Step 5: Run lint and typecheck**

Run: `npm run lint && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/publish/ExportPage.tsx tests/components/publish/ExportPage.test.tsx
git commit -m "feat(export-ui): output-location section with optional native picker"
```

---

### Task 12: Add Reveal/Open/Copy path buttons to success card

**Files:**
- Modify: `components/publish/ExportPage.tsx`
- Modify: `tests/components/publish/ExportPage.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `tests/components/publish/ExportPage.test.tsx`:

```ts
describe("ExportPage — success card actions", () => {
  beforeEach(() => {
    mockFetch.mockClear();
    (toast.error as ReturnType<typeof vi.fn>).mockClear();
    (toast.success as ReturnType<typeof vi.fn>).mockClear();
    delete (window as unknown as { scriptr?: unknown }).scriptr;
  });

  async function buildOnce(buildPath: string) {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: { isElectron: true, defaultExportDir: undefined },
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          ok: true,
          data: { path: buildPath, bytes: 12345, version: 3, warnings: [] },
        }),
      } as unknown as Response);

    let result!: ReturnType<typeof mount>;
    await act(async () => {
      result = mount(<ExportPage story={baseStory} chapterCount={1} wordCount={500} />);
    });
    const buildBtn = result.container.querySelector<HTMLButtonElement>(
      '[data-testid="export-build"]',
    );
    await act(async () => {
      buildBtn!.click();
    });
    return result;
  }

  it("Reveal/Open buttons are hidden when window.scriptr is absent", async () => {
    const result = await buildOnce("/Users/chase/Books/x-epub3.epub");
    try {
      expect(result.container.querySelector('[data-testid="export-reveal-3"]')).toBeNull();
      expect(result.container.querySelector('[data-testid="export-open-3"]')).toBeNull();
      // Copy path is always present
      expect(result.container.querySelector('[data-testid="export-copy-path-3"]')).not.toBeNull();
    } finally {
      result.unmount();
    }
  });

  it("Reveal/Open buttons are present when window.scriptr exists, and call the bridge", async () => {
    const revealInFolder = vi.fn().mockResolvedValue(undefined);
    const openFile = vi.fn().mockResolvedValue(undefined);
    (window as unknown as { scriptr: unknown }).scriptr = {
      pickFolder: vi.fn(),
      revealInFolder,
      openFile,
    };
    const result = await buildOnce("/Users/chase/Books/x-epub3.epub");
    try {
      const reveal = result.container.querySelector<HTMLButtonElement>(
        '[data-testid="export-reveal-3"]',
      );
      const open = result.container.querySelector<HTMLButtonElement>(
        '[data-testid="export-open-3"]',
      );
      expect(reveal).not.toBeNull();
      expect(open).not.toBeNull();
      await act(async () => { reveal!.click(); });
      expect(revealInFolder).toHaveBeenCalledWith("/Users/chase/Books/x-epub3.epub");
      await act(async () => { open!.click(); });
      expect(openFile).toHaveBeenCalledWith("/Users/chase/Books/x-epub3.epub");
    } finally {
      result.unmount();
    }
  });

  it("Copy path writes to clipboard and toasts", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const result = await buildOnce("/Users/chase/Books/x-epub3.epub");
    try {
      const copy = result.container.querySelector<HTMLButtonElement>(
        '[data-testid="export-copy-path-3"]',
      );
      await act(async () => { copy!.click(); });
      expect(writeText).toHaveBeenCalledWith("/Users/chase/Books/x-epub3.epub");
      expect((toast.success as ReturnType<typeof vi.fn>).mock.calls.some(
        (c) => /[Cc]opied/.test(String(c[0])),
      )).toBe(true);
    } finally {
      result.unmount();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/publish/ExportPage.test.tsx -t "success card actions"`
Expected: FAIL — buttons don't exist yet.

- [ ] **Step 3: Implement the buttons in the success card**

In `components/publish/ExportPage.tsx`, locate the success card render block (currently lines 285-310, the `([3, 2] as const).map((v) => { ... })` section). Replace the inner JSX of each card:

```tsx
        {([3, 2] as const).map((v) => {
          const build = lastBuildByVersion[v];
          if (!build) return null;
          return (
            <div
              key={v}
              data-testid={`export-lastbuild-epub${v}`}
              className="rounded border border-green-700 bg-green-950/40 p-3 text-xs text-green-200"
            >
              <div>✓ EPUB {v} · {(build.bytes / 1024).toFixed(0)} KB</div>
              <div className="font-mono text-green-300 break-all mt-1">
                {build.path}
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {isElectron && typeof window !== "undefined" && window.scriptr?.revealInFolder && (
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid={`export-reveal-${v}`}
                    onClick={() => {
                      void window.scriptr!.revealInFolder(build.path).catch((err) => {
                        toast.error(`Reveal failed: ${err instanceof Error ? err.message : String(err)}`);
                      });
                    }}
                  >
                    Reveal
                  </Button>
                )}
                {isElectron && typeof window !== "undefined" && window.scriptr?.openFile && (
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid={`export-open-${v}`}
                    onClick={() => {
                      void window.scriptr!.openFile(build.path).catch((err) => {
                        toast.error(`Open failed: ${err instanceof Error ? err.message : String(err)}`);
                      });
                    }}
                  >
                    Open
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid={`export-copy-path-${v}`}
                  onClick={() => {
                    void navigator.clipboard.writeText(build.path).then(() => {
                      toast.success("Copied path");
                    });
                  }}
                >
                  Copy path
                </Button>
              </div>
              {build.warnings.length > 0 && (
                <details className="mt-2">
                  <summary>{build.warnings.length} warning(s)</summary>
                  <ul className="mt-1 text-green-300">
                    {build.warnings.map((w, i) => (
                      <li key={i}>· {w}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          );
        })}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/components/publish/ExportPage.test.tsx`
Expected: PASS — all tests including new success-card tests AND prior tests.

- [ ] **Step 5: Run lint + typecheck**

Run: `npm run lint && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/publish/ExportPage.tsx tests/components/publish/ExportPage.test.tsx
git commit -m "feat(export-ui): Reveal/Open/Copy path buttons on success card"
```

---

## Chunk 5: Verification & manual smoke

### Task 13: Full quality gauntlet

- [ ] **Step 1: Run lint**

Run: `npm run lint`
Expected: PASS — including the `scriptr/no-telemetry` rule.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS — all suites including new tests, with no regressions.

- [ ] **Step 4: Run the egress test in isolation as a final privacy gate**

Run: `npx vitest run tests/privacy/no-external-egress.test.ts`
Expected: PASS — confirming no new fetches were introduced.

- [ ] **Step 5: Build the Electron app and confirm preload ships**

Run: `npm run build:electron`
Then: `ls dist/electron/preload.js dist/electron/main.js`
Expected: Both files exist.

- [ ] **Step 6: If any step failed, return to the failing chunk's task and fix before proceeding**

---

### Task 14: Manual smoke test (developer step)

This is a manual checklist; not automated. Run `npm run build && npm run dev:electron` for the cleanest test path (it spawns Electron against the standalone bundle, with a real OS folder picker).

- [ ] **Step 1: Verify visibility fix in the broken state path**

In a clean run, force a route failure to confirm error visibility. Pick any way that produces a 500 (e.g. corrupt a chapter's JSON temporarily, or set body `outputDir` to `/root/forbidden` if you can). Click Build. Expect a red toast with the actual error string. Revert the corruption.

- [ ] **Step 2: Verify happy path with default location**

Reset Output Location to default (click "Reset to default"). Click Build EPUB 3. Expect:
- Green toast: "EPUB 3 saved to /…/data/stories/<slug>/exports/<slug>-epub3.epub"
- Green success card with the path + Reveal / Open / Copy path buttons.

- [ ] **Step 3: Verify native folder picker**

Click "Choose folder…". A native folder dialog should open. Pick a folder (e.g. `~/Desktop`). The input updates. Click Build EPUB 3. Expect the file to land in `~/Desktop/<slug>-epub3.epub` (verify with `ls`).

- [ ] **Step 4: Verify Reveal and Open**

Click Reveal — your file manager opens the folder with the file selected. Click Open — your default EPUB reader (or whatever is registered for `.epub`) opens the file.

- [ ] **Step 5: Verify path-validation safeguard**

(Manual via browser devtools console, with `isDev` build) Try `await window.scriptr.revealInFolder("/etc/passwd")`. Expect the promise to reject with "path is outside allowed roots". Confirm via OS file manager that nothing was opened.

- [ ] **Step 6: Verify validation errors surface cleanly**

Type a relative path like `./nope` into the Output Location input and tab away. Expect a red toast naming the validation error and the input rolling back to the last-saved value.

---

## Done

When all tasks are checked, the work covered by [docs/superpowers/specs/2026-04-27-export-output-location-design.md](../specs/2026-04-27-export-output-location-design.md) is complete:

- Authors can pick a global default export folder via a native picker (Electron) or text input (web).
- EPUB builds visibly succeed or fail with toasts in every environment.
- Reveal / Open / Copy path actions on the success card.
- The privacy egress test continues to pass; no new outbound origins; the new IPC surface is path-validated.

The underlying "why does the route 500 in packaged Electron" question — if it actually was 500ing, which we couldn't confirm — is now self-diagnosing: the user clicks Build, the toast tells us, we fix it in a follow-up.
