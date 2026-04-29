# EPUB Export Smoke Checklist

Run after each phase of the dependabot-alert-cleanup plan. The unit/e2e suites do **not** exercise the packaged-app code path, and every historical EPUB regression (sharp DLLs, jsdom ESM, 0-byte covers) only surfaced in production-built artifacts.

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

- **0-byte EPUB** → `epub-gen-memory` cover-path regression. The cover option needs a `file://` URL, not a bare absolute path. See [lib/publish/](../../../lib/publish/) and `pathToFileURL` usage.
- **`Cannot find module '@asamuzakjp/css-color'`** or similar `require()` of an ESM-only module → a dep started pulling jsdom into the packaged Electron runtime. `grep -r '"jsdom"' node_modules/*/package.json` to find the offender. Historical fix: PR #30 dropped `isomorphic-dompurify` for this reason.
- **`dlopen failed`** for sharp on Windows → libvips DLL trace regression. Confirm [next.config.ts](../../../next.config.ts) `outputFileTracingIncludes` glob still matches `node_modules/@img/sharp-*/**/*.dll`. The DLL files must end up next to `sharp-win32-x64.node` in the packaged output.
- **EPUB validation never runs** is **not** a tripwire — `@likecoin/epubcheck-ts` is silently non-functional under Next.js 16 by design. Only flag if it now *crashes loudly*.
