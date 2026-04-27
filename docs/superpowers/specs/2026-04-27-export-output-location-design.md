# scriptr — Custom EPUB Output Location & Visible Build Feedback Design Spec

**Date:** 2026-04-27
**Author:** Chase (with Claude)
**Status:** Draft

## Summary

Two related fixes to the EPUB export experience:

1. **Custom output location.** Let the author choose where built EPUBs land (a global default in `data/config.json`). Defaults to today's `data/stories/<slug>/exports/` if unset. In the Electron app, a native folder-picker button is available; in dev/web, a text input is the only path.
2. **Visible build feedback.** Today's client swallows route failures silently (`res.json()` throws on a 500's HTML body, no `catch`). The export page shows nothing when the route 500s — which is what's currently happening in the packaged Electron app. Wrap the fetch in proper error handling so any failure surfaces as a toast.

A small Electron preload + IPC layer is added so the renderer can call `dialog.showOpenDialog`, `shell.showItemInFolder`, and `shell.openPath`. The renderer→main surface is intentionally tiny (three string-only methods, all path-validated).

## Goals

1. Author picks a single global export folder (e.g. `~/Books/scriptr-out/`) and every subsequent build lands there with the existing slug+version filename.
2. Build success and failure are visible in every supported environment — dev (browser), packaged Electron, and the (untested-by-us) Linux deb/AppImage variants.
3. Native desktop affordances on the success card: "Reveal in folder" highlights the file in Finder/Explorer; "Open file" opens it in the OS's default EPUB reader.
4. No regression to today's behavior when the user hasn't chosen a folder.
5. No new outbound network surface. The new IPC channels are local-process only and the existing privacy egress test stays green.

## Non-goals

- **Diagnosing why the route currently 500s in packaged Electron.** Once the client surfaces the actual error string, the cause (likely sharp's native binding or an `epub-gen-memory` transitive dep failing to load from the Next standalone bundle) will be visible. Fixing it is a follow-up. This spec deliberately does not investigate native-module bundling without evidence.
- **Per-story output overrides.** A single global default is sufficient for the publish-to-one-place workflow. Adding `outputDir` to `Story` is easy to do later if a real need surfaces.
- **Custom filenames.** Stays `<slug>-epub<version>.epub`. The path being user-controlled is enough — the filename naming convention is load-bearing for collision behavior across rebuilds.
- **Filename-collision UI** (overwrite confirm, increment, etc.). Today's behavior overwrites silently; that stays.
- **File System Access API path.** `showDirectoryPicker()` was considered and rejected — it forces the renderer to do the file write (bypassing `writeEpub`), needs IndexedDB-backed handle persistence, and forks the architecture from "all I/O server-side" to "Electron one way, web another." The IPC path keeps the server-side write pattern.
- **Filename-customization UI on a per-build basis.** The design saves the folder, not the file.
- **Surfacing the data-dir copy alongside the user's chosen location.** When `defaultExportDir` is set, only the user's chosen path receives the EPUB. Writing two copies risks silently diverging if one write fails.

## Architecture

```
ExportPage (renderer, Next client component)
  Output location section
    text input  ← user types/pastes path                          ↘ PUT /api/settings { defaultExportDir }
    "Choose folder…"  visible iff window.scriptr?.pickFolder    →  ↗
       → window.scriptr.pickFolder()
            → ipcRenderer.invoke("dialog:pickFolder")
                → ipcMain.handle dialog:pickFolder (electron/main.ts)
                → dialog.showOpenDialog({ properties: ['openDirectory'] })
                → returns absolute path or null
       → fills input, fires save

  Build button
    → POST /api/stories/[slug]/export/epub  { version, outputDir? }
       → effective outputDir = body.outputDir ?? config.defaultExportDir ?? data-dir/exports
       → validate: absolute, exists, is dir, writable
       → buildEpubBytes / validateEpub  (unchanged)
       → writeEpub(dataDir, slug, version, bytes, { outputDir })
       → returns { path, bytes, version, warnings }
    → handleBuild has real try/catch:
        - if !res.ok, read text, toast.error with status + first 200 chars
        - if body.ok, set last-build state + toast.success with path
        - any thrown error → toast.error with message

  Success card (per-version)
    Path text + three buttons:
      Reveal     visible iff window.scriptr?.revealInFolder   → window.scriptr.revealInFolder(path)
      Open       visible iff window.scriptr?.openFile         → window.scriptr.openFile(path)
      Copy path  always                                       → navigator.clipboard.writeText(path)
```

### New module: `electron/preload.ts`

```ts
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("scriptr", {
  pickFolder: (): Promise<string | null> =>
    ipcRenderer.invoke("dialog:pickFolder"),
  revealInFolder: (path: string): Promise<void> =>
    ipcRenderer.invoke("shell:revealInFolder", path),
  openFile: (path: string): Promise<void> =>
    ipcRenderer.invoke("shell:openFile", path),
});
```

The renderer sees only these three methods. No filesystem access, no node primitives, no arbitrary IPC. `contextIsolation: true` keeps the bridge as the only renderer→main surface.

### Wired into `electron/main.ts`

- BrowserWindow `webPreferences` gains `preload: join(__dirname, "preload.js")`. All other security flags unchanged (`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`).
- Three new `ipcMain.handle` registrations, set up once at app start (before the window is created so the channels exist by the time preload fires):
  - `dialog:pickFolder` — calls `dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'], title: 'Choose EPUB output folder' })`. Returns `result.canceled ? null : result.filePaths[0] ?? null`.
  - `shell:revealInFolder` — string-validated path, must be absolute. Calls `shell.showItemInFolder(path)`.
  - `shell:openFile` — string-validated path, must be absolute. Calls `shell.openPath(path)` (returns a string error message on failure; we surface as a thrown error so the renderer's `await` rejects).

**Path validation in main.** For `revealInFolder` and `openFile`, the main process restricts paths to two roots: the active data dir (`appDataDir` from the existing main-process state) and `config.defaultExportDir` (read at handler invocation, so it tracks user changes). Any path outside both is rejected with a thrown error. This means a compromised renderer cannot ask Electron to reveal `/etc/passwd` or open `~/.ssh/id_rsa` in the system editor.

### Server-side: storage + route

**`lib/storage/paths.ts`** — add a small helper:

```ts
export function customEpubPath(outputDir: string, storySlug: string, version: EpubVersion): string {
  return join(outputDir, `${storySlug}-epub${version}.epub`);
}
```

Same filename convention as `epubPath()` so the user moving their override on/off doesn't change the filename.

**`lib/publish/epub-storage.ts`** — `writeEpub` gains an optional `outputDir`:

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

The `mkdir` switches from `exportsDir(...)` to `dirname(finalPath)` so it works for either branch. `dirname(epubPath(...))` is `exportsDir(...)`, so the unset case is byte-equivalent.

**`lib/config.ts`** — Config gains `defaultExportDir?: string`. Normalized in `normalizeConfigFromFile` (string check + ignore empty), persisted via `mergeConfig`. `null` from the API clears it.

**`app/api/settings/route.ts`** — PUT accepts `defaultExportDir`:
- `null` or `""` → clear (`patch.defaultExportDir = undefined`).
- string → must be absolute (`path.isAbsolute`); must exist, be a directory, and be writable (validated server-side via `fs.stat` + `fs.access(W_OK)`). Failures: `fail("...", 400)` with a precise reason.
- Anything else: `fail("defaultExportDir must be a string or null", 400)`.

Validation lives in the route, not in `lib/config.ts`, because filesystem-touching validation isn't appropriate for the pure-config layer (which has unit tests that don't expect to touch disk). The route is the boundary that knows it's running where the filesystem matters.

**`app/api/stories/[slug]/export/epub/route.ts`** — body grows optional `outputDir`:
- Resolution: `body.outputDir ?? config.defaultExportDir ?? undefined` → passed as `opts?.outputDir` to `writeEpub`.
- If a value resolves, validate the same way the settings route does (absolute / exists / dir / writable). Failures → 400 with the actual reason ("output directory does not exist", "output directory is not writable", etc.).
- Response shape is unchanged. `path` reflects the actual write location.

GET on `/api/settings` already returns `isElectron`; we can extend it to also return `defaultExportDir` so the export page can render the saved value on first load.

### Client: `components/publish/ExportPage.tsx`

New section between Cover and Build:

```tsx
<section>
  <h2 className="text-sm font-semibold mb-1">Output location</h2>
  <Input
    type="text"
    placeholder="Default: <data-dir>/stories/<slug>/exports/"
    value={outputDirDraft}
    onChange={(e) => setOutputDirDraft(e.target.value)}
    onBlur={() => saveOutputDir(outputDirDraft.trim() || null)}
  />
  {isElectron && (
    <Button variant="secondary" onClick={async () => {
      const picked = await window.scriptr!.pickFolder();
      if (picked) {
        setOutputDirDraft(picked);
        await saveOutputDir(picked);
      }
    }}>Choose folder…</Button>
  )}
  {outputDirDraft && (
    <button onClick={() => { setOutputDirDraft(""); void saveOutputDir(null); }}>
      Reset to default
    </button>
  )}
  {!outputDirDraft && (
    <p className="text-xs text-muted-foreground">
      Default: <code>{defaultPath}</code>
    </p>
  )}
</section>
```

`isElectron` comes from `GET /api/settings`. We don't sniff `navigator.userAgent`. The feature flag is server-side, set once in `electron/main.ts` boot, and matches reality: only Electron exposes the picker.

`saveOutputDir(value)` PUTs `/api/settings`. On 400, surfaces the validation message as a toast and rolls back the draft to the previously-saved value (so the user sees both the bad input and the explanation before deciding what to fix).

`handleBuild` is rewritten to surface failures (full version in spec discussion above):

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
      const text = await res.text();
      toast.error(`Build failed (${res.status}): ${text.slice(0, 200)}`);
      return;
    }
    const body = await res.json();
    if (!body.ok) { toast.error(body.error ?? "Build failed"); return; }
    const built: LastBuild = body.data;
    setLastBuildByVersion((p) => ({ ...p, [built.version]: built }));
    toast.success(`EPUB ${built.version} saved to ${built.path}`);
  } catch (err) {
    toast.error(`Build failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    setBuilding(false);
  }
};
```

Three changes from today: outer `try/catch`, `res.ok` check before JSON parse, error toast includes status + body text on HTTP failures. This is the load-bearing fix for the silent-failure symptom — independent of whether the user ever uses the new output-location feature.

Success card gains the three action buttons, all calling either the IPC bridge or `navigator.clipboard.writeText`. Reveal/Open visible only when `window.scriptr` exists; Copy path always visible.

## Data model

**`Config`** in [lib/config.ts](lib/config.ts):

```ts
export type Config = {
  // ... existing fields
  defaultExportDir?: string;  // absolute path; undefined = use data-dir/exports
};
```

No migration: missing field is interpreted as undefined by the existing normalizer pattern.

## Testing

- **`lib/storage/paths.test.ts`** — `customEpubPath` produces `<outputDir>/<slug>-epub<v>.epub`.
- **`lib/publish/epub-storage.test.ts`** (extending existing) — `writeEpub` with `opts.outputDir` writes to the override and skips `exportsDir`. Atomic temp/rename still works for the override path.
- **`tests/api/settings.test.ts`** (or wherever the existing settings test lives) — PUT `defaultExportDir`: valid absolute writable dir saves; relative path 400s; nonexistent path 400s; non-directory 400s; non-writable 400s; `null` clears.
- **`tests/api/export.epub.test.ts`** (extending) — POST with explicit `outputDir` writes there; with config-set default writes there; with neither falls back to data-dir; invalid outputDir 400s.
- **`tests/components/publish/ExportPage.test.tsx`** (extending) — Choose folder button hidden when `isElectron === false`; visible and callable when true; Reveal/Open buttons visibility matches `window.scriptr`. Build failure toast fires on 500 HTML response.
- **`tests/privacy/no-external-egress.test.ts`** — Add a PUT to `/api/settings` with `defaultExportDir` to the route exercise list. Already exercised by the settings test, but the egress test verifies no fetch fired.
- **`tests/electron/preload-bridge.test.ts`** (new, small) — Verify `electron/preload.ts` only exposes the three methods. Pure unit-level — instantiate the contextBridge mock and assert the surface.
- **Electron e2e** — out of scope for this spec; the existing test suite doesn't exercise the packaged Electron build, and adding that infra is its own project.

## Privacy

- No new outbound origins. CSP `connect-src` unchanged.
- `data/.last-payload.json` unchanged — output-dir choice doesn't enter the prompt audit trail.
- New IPC channels are local-process only. The egress test continues to pass.
- Path validation in main prevents the renderer from steering the system editor at arbitrary files (e.g. `~/.ssh/id_rsa`) via reveal/open.

## Open questions

None blocking; happy to revise during implementation if the validation messaging in the settings route turns out to be awkward (e.g. "writable" check semantics on Windows differ from POSIX — `fs.access(W_OK)` is best-effort on Windows and may need a fallback to "try to create a temp file in the dir").
