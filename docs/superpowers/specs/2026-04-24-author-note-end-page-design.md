# scriptr — Author Note End Page Design Spec

**Date:** 2026-04-24
**Author:** Chase (with Claude)
**Status:** Draft

## Summary

Add a per-pen-name "author note" that scriptr appends as a final section to every story's EPUB export and to the in-app reader page. The note carries a rich-text message, a `mailto:` email link, and a QR code that encodes a mailing-list URL. Pen-name profiles (email, mailing-list URL, default message) live in `data/config.json` keyed by the existing `Story.authorPenName` string, so the user — who writes under several pen names — can configure once per persona and override the message per book.

No new network surface. The QR is rendered server-side via the pure-JS `qrcode` package and embedded as a base64 PNG data URL, so privacy enforcement (egress test, CSP, no-telemetry rule) needs no changes beyond extending the existing egress test to cover the export route with a profile configured.

## Goals

1. Per-pen-name profile holding email, mailing-list URL, and a default message (rich-text HTML).
2. Per-story override of the message text plus a toggle to skip the note for samples/freebies.
3. Note rendered in EPUB2, EPUB3, and the in-app reader from a single source of truth so all three stay in sync.
4. QR code encoding the mailing-list URL, generated entirely in-process (no external service), embeds reliably across modern Kindle, Smashwords-targeted EPUB2 readers, and the in-app reader.
5. Preserve scriptr's privacy pillar: zero new outbound network calls, no new `connect-src` origins, no new telemetry-flavored deps.
6. Ship without regressing the existing EPUB export behavior for stories with no profile / disabled note (byte-identical EPUB output for those cases).

## Non-goals

- Multiple links / multiple QR codes per note (one mailing-list URL is enough; "also a Patreon QR, also a Discord QR" is deferred).
- Variable substitution in the message (`{title}`, `{pen_name}`, etc.) — the per-story override field is hand-written prose.
- Configurable section heading — "A note from the author" is hard-coded for v1.
- First-class pen-name entities — no `data/pen-names/<slug>.json`, no IDs. Pen-name string from `Story.authorPenName` is the key.
- Different note per export format — same HTML on EPUB2, EPUB3, and reader. No "Smashwords-only message" vs "Kindle-only message".
- A dedicated "preview the note" tab — the in-app reader IS the preview.
- Lists / headings / images in the message TipTap toolbar — bold, italic, link, paragraphs only for v1.
- Promoting `authorPenName` from free-text string to a dropdown — leaves existing flow untouched.
- Packaging the QR as a separate `OEBPS/images/qr.png` asset inside the EPUB — base64 PNG data URL is enough for v1.
- Localization of the note title or footer captions — single-language for v1.
- Migration of existing stories — `Story.authorNote` is optional and absent on every existing story; UI defaults handle the empty case.

## Architecture

One new module, one new dep (`qrcode`), one new reusable UI component, two existing-type extensions (`Config`, `Story`), and integration points in the EPUB builder and the reader page.

```
Settings page
  "Pen Name Profiles" section ──► PATCH /api/config { penNameProfiles: { ... } }
                                   └► data/config.json

Story metadata pane
  "Author Note" card        ──► PATCH /api/stories/[slug] { authorNote: { ... } }
                                   └► data/stories/<slug>/story.json

EPUB export                  ──► lib/publish/author-note.ts
  lib/publish/epub.ts             buildAuthorNoteHtml(...)
  └ append final content entry    ├ resolves message (story override → profile default)
                                  ├ renders QR via qrcode.toDataURL(url)
                                  └ returns sanitized HTML chapter

In-app reader                ──► same buildAuthorNoteHtml(...)
  app/s/[slug]/read/              rendered server-side at the bottom of the page
                                  via the existing SafeHtml component
```

### Data model

`Config` in [lib/config.ts:5](lib/config.ts#L5) gains an optional field:

```ts
export type PenNameProfile = {
  email?: string;
  mailingListUrl?: string;
  defaultMessageHtml?: string;  // TipTap-produced HTML, sanitized at render time
};

export type Config = {
  // existing fields …
  penNameProfiles?: Record<string, PenNameProfile>;  // keyed by Story.authorPenName
};
```

`Story` in [lib/types.ts:1](lib/types.ts#L1) gains an optional field:

```ts
export type Story = {
  // existing fields …
  authorNote?: {
    enabled: boolean;          // default true at the UI level if profile exists
    messageHtml?: string;      // when blank/missing, falls back to profile.defaultMessageHtml
  };
};
```

Lookup logic (pure function in `lib/publish/author-note.ts`):

```ts
function resolveAuthorNote(
  story: Story,
  profile: PenNameProfile | undefined
): { messageHtml: string; email?: string; mailingListUrl?: string } | null {
  if (!profile) return null;
  if (story.authorNote?.enabled === false) return null;
  const messageHtml = story.authorNote?.messageHtml?.trim()
    || profile.defaultMessageHtml?.trim();
  if (!messageHtml && !profile.email && !profile.mailingListUrl) return null;
  return {
    messageHtml: messageHtml ?? "",
    email: profile.email,
    mailingListUrl: profile.mailingListUrl,
  };
}
```

The "all three empty → null" guard prevents a totally-blank profile from emitting a degenerate note.

### Rendering

New module `lib/publish/author-note.ts`:

```ts
export async function buildAuthorNoteHtml(opts: {
  messageHtml: string;
  email?: string;
  mailingListUrl?: string;
}): Promise<string>;
```

Output structure (this is the *pre-sanitization* HTML the builder produces; the sanitizer at the consumer side then enforces the allowlist):

```html
<div class="author-note">
  <h2>A note from the author</h2>
  <div class="author-note-message">{messageHtml}</div>      <!-- already sanitized before concat -->
  <div class="author-note-footer">
    <p><a href="mailto:{email}">{email}</a></p>             <!-- omitted if no email -->
    <p>Join the mailing list:</p>                            <!-- omitted block if no URL -->
    <p><a href="{mailingListUrl}">{mailingListUrl}</a></p>
    <img src="data:image/png;base64,{base64}" alt="QR code linking to the mailing list" width="200" height="200" />
  </div>
</div>
```

QR generation: `QRCode.toDataURL(url, { type: 'image/png', width: 200 })` from the `qrcode` package — pure JS, no network. PNG data URL chosen over inline SVG because EPUB2 (Smashwords) reader compatibility for inline SVG is inconsistent; PNG via `<img>` works uniformly across EPUB2, EPUB3, Kindle, and HTML.

#### Sanitization (XSS defense)

The author note is rendered via React's `dangerouslySetInnerHTML`, which is a known XSS surface. The codebase already has the right primitive: [lib/publish/safe-html.tsx](lib/publish/safe-html.tsx) wraps `dangerouslySetInnerHTML` and pipes its input through `isomorphic-dompurify` first. We reuse `SafeHtml` for the reader-side render of the author note.

`SafeHtml`'s current allowlist is tuned to chapter prose: `ALLOWED_TAGS: ["div", "h1", "p", "strong", "em", "span"]`, `ALLOWED_ATTR: ["class"]`. The author note needs:

- `a` (with `href`)
- `br`
- `h2`
- `img` (with `src`, `alt`, `width`, `height`)

To avoid loosening the chapter-content sanitizer globally, `SafeHtml` is extended to accept an optional `extra` config so callers can opt into a wider allowlist:

```ts
type SafeHtmlProps = {
  html: string;
  className?: string;
  extra?: { ALLOWED_TAGS?: string[]; ALLOWED_ATTR?: string[]; ALLOWED_URI_REGEXP?: RegExp };
};
```

The author-note caller passes:

```ts
extra: {
  ALLOWED_TAGS: ["a", "br", "h2", "img"],
  ALLOWED_ATTR: ["href", "src", "alt", "width", "height"],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|data:image\/png;base64,)/i,
}
```

Specifically, the `ALLOWED_URI_REGEXP` constrains the `href` and `src` schemes to only what the author note legitimately uses: `http(s):` for the mailing-list link, `mailto:` for the email link, and `data:image/png;base64,` for the embedded QR. Any other scheme (`javascript:`, `vbscript:`, `data:text/html`, etc.) is stripped by DOMPurify.

`messageHtml` from the user (TipTap output) is sanitized as part of this same pass — DOMPurify operates on the assembled HTML, so a malicious `<script>` injected into the message would be stripped before it reaches the DOM. This applies to both the in-app reader and the settings/metadata preview surfaces.

For the EPUB build path, the same `DOMPurify.sanitize(html, opts)` call runs server-side via `isomorphic-dompurify` (which provides a JSDOM-backed implementation in Node). The sanitized HTML is what gets handed to `epub-gen-memory`. EPUB readers don't execute JS in any modern, mainstream client, but sanitizing keeps a single source of truth and protects the in-app reader (which absolutely does execute JS) from regressions.

#### Styling

A `.author-note { … }` block is appended to `EPUB_STYLESHEET` in [lib/publish/epub-preview.ts](lib/publish/epub-preview.ts) so EPUB and reader render identically. Styles include sensible margin separating the note from the last chapter, centered QR image, slightly muted footer text.

### EPUB integration

In `buildEpubBytes` ([lib/publish/epub.ts:58](lib/publish/epub.ts#L58)), after the existing `chapters.map(...)` loop:

```ts
if (input.authorNote) {
  content.push({
    title: "A note from the author",
    content: await buildAuthorNoteHtml(input.authorNote),
  });
}
```

This requires `EpubInput` ([lib/publish/epub.ts:25](lib/publish/epub.ts#L25)) to grow an optional `authorNote?: { messageHtml: string; email?: string; mailingListUrl?: string }` field — already-resolved. The export route handler ([app/api/stories/[slug]/export/epub/route.ts](app/api/stories/[slug]/export/epub/route.ts)) calls `resolveAuthorNote(story, profile)` itself and passes the result through. This keeps `lib/publish/epub.ts` agnostic of `Config` shape — it just receives the resolved bundle or undefined.

EPUB2 and EPUB3 receive the same final content entry. The note appears as the last entry in the package's reading order and shows up in the table of contents.

### Reader integration

[app/s/[slug]/read/](app/s/[slug]/read/) is a server component that already loads the story + chapters. It additionally loads config, calls `resolveAuthorNote`, and if non-null renders the author-note block at the end via the extended `SafeHtml` component (which performs the DOMPurify sanitization client-side on hydration; the *first* paint is the server-rendered sanitized HTML).

Server-side QR generation means the PNG data URL is computed once per page load on the server — never on the client, never via fetch. This also keeps the heavy `qrcode` dep out of any client bundle.

### UI: Settings — Pen Name Profiles

New section in [app/settings/](app/settings/). For each pen-name string that exists on at least one story OR has a profile entry, render a card with:

- Pen name (read-only label)
- Email (text input)
- Mailing list URL (text input, validated as `http(s)://…` on save — same regex as the sanitizer's `ALLOWED_URI_REGEXP` minus `mailto:` / `data:`)
- Default message (TipTap rich-text editor, toolbar: bold, italic, link, paragraphs)
- "Save" button (PATCH config) and "Delete profile" button (removes the key from `penNameProfiles`)

An "Add profile for new pen name" row at the bottom takes a free-text pen-name string. Two pen names that differ only by capitalization or whitespace are treated as distinct keys (matches the underlying `Record<string, PenNameProfile>` semantics) — this is intentional and not validated.

### UI: Story metadata — Author Note card

New collapsible card in [components/editor/MetadataPane.tsx](components/editor/MetadataPane.tsx):

- "Include author note in this story" checkbox.
  - When the matching pen-name profile exists: defaults to `true` if `story.authorNote` is undefined.
  - When no profile exists: checkbox is disabled with helper text linking to settings: "Set up a pen-name profile for *{pen name}* to enable."
- TipTap rich-text editor for the per-story override message (same toolbar as the settings editor).
  - Placeholder text shows the profile's `defaultMessageHtml` rendered dimly: "Default for *{pen name}*: …".
  - Empty editor → fall back to profile default at render time.

### UI: New reusable component

New `components/editor/RichTextEditor.tsx`, extracted from [SectionEditor.tsx](components/editor/SectionEditor.tsx). Same TipTap StarterKit + a small toolbar ribbon. Emits HTML rather than plain text. Used in the settings profile editor and the story author-note editor.

The existing `SectionEditor` round-trips plain text and is *not* refactored — it's optimized for in-place section editing with autosave on blur, which is a different shape from "edit a small HTML field in a form". Sharing the underlying TipTap setup but not the wrapper component keeps both concerns clean.

### Storage / API surface

- **Config:** `Config` type extension. Existing config PATCH route accepts the new field via partial-merge — verify in implementation that `saveConfig` ([lib/config.ts:38](lib/config.ts#L38)) preserves nested `penNameProfiles` correctly when other fields are PATCHed. (Single-user app, so race conditions across tabs are out of scope.)
- **Story:** `Story` type extension. Existing story PATCH route accepts the new field; storage helper [lib/storage/stories.ts](lib/storage/stories.ts) writes the merged JSON. No route changes.
- **No new disk locations.** Profiles in `data/config.json`, per-story override in `data/stories/<slug>/story.json`.
- **No new API routes.**

### Privacy

- `qrcode` is a pure-JS encoder with no network code path. Egress test [tests/privacy/no-external-egress.test.ts](tests/privacy/no-external-egress.test.ts) gets a new case that exercises the EPUB export route with a configured author note and asserts `recorded === []` for non-generate routes. Belt-and-suspenders against `qrcode` ever growing a network code path in a future version.
- No CSP changes — no new origins. PNG data URLs are inline.
- The `scriptr/no-telemetry` ESLint rule has no quarrel with `qrcode`. No rule changes.
- `.last-payload.json` is unaffected — author notes are not part of the generation prompt.

## Testing

### Unit — `lib/publish/author-note.ts`

- `resolveAuthorNote` returns `null` when no profile.
- `resolveAuthorNote` returns `null` when `story.authorNote.enabled === false`.
- `resolveAuthorNote` returns story override when `messageHtml` is non-empty.
- `resolveAuthorNote` falls back to `profile.defaultMessageHtml` when story override is empty/missing.
- `resolveAuthorNote` returns `null` when message AND email AND mailingListUrl are all empty (degenerate guard).
- `buildAuthorNoteHtml` produces structurally stable HTML (assert presence of the major blocks, not full string equality).
- `buildAuthorNoteHtml` embeds the QR as `<img src="data:image/png;base64,…">` when `mailingListUrl` is set.
- `buildAuthorNoteHtml` omits the email block when `email` is missing.
- `buildAuthorNoteHtml` omits the QR + mailing-list block when `mailingListUrl` is missing.
- Sanitization parity: passing the builder output through `DOMPurify.sanitize` with the author-note allowlist yields a non-empty result; a `<script>` injected via `messageHtml` is stripped; a `javascript:` URL in a forged `<a href>` is stripped; `data:text/html` is stripped; only the legitimate `data:image/png;base64,…` survives in the QR `<img src>`.

### Integration — EPUB export

- Build a fixture story + matching pen-name profile, call the EPUB export route handler directly (same pattern as [tests/privacy/no-external-egress.test.ts](tests/privacy/no-external-egress.test.ts)), unzip the resulting bytes in-memory, assert that a final `.xhtml` exists with the note title text, the QR `<img>` tag, and the `mailto:` link.
- Same fixture but `authorNote.enabled = false` → that final XHTML is absent and the byte stream is byte-identical to the no-note path (regression guard).
- Same fixture but no profile registered → no note appears.
- Verify on both `version: 2` and `version: 3` EPUBs.

### Integration — reader page

- Render the reader page server component with a fixture story+profile, assert the rendered HTML contains the note block at the bottom (note title, QR `<img>` with non-empty `src`, mailto link).
- Render with `enabled: false` → block absent.
- Render with no profile → block absent.

### Privacy — egress

- Extend [tests/privacy/no-external-egress.test.ts](tests/privacy/no-external-egress.test.ts) to exercise the EPUB export route with a configured author note and assert `recorded === []` for non-generate routes.

### E2E — Playwright

New `e2e/author-note.spec.ts` alongside [publishing-kit.spec.ts](e2e/publishing-kit.spec.ts):

1. Create a story with a known `authorPenName`.
2. Navigate to the settings page, fill in the pen-name profile (email, mailing list URL, default message — bold a word in the TipTap editor to confirm rich-text round-trip).
3. Open the story's metadata pane, verify the "Include author note" toggle is on by default and the placeholder shows the profile default.
4. Type a per-story override message, save.
5. Open the in-app reader, scroll to the bottom, assert: note block is present, the per-story message text is shown (not the default), the mailto link is present, the QR `<img>` has a non-empty `src` starting with `data:image/png;base64,`.
6. Trigger EPUB export, read the EPUB bytes back from the e2e data dir (`SCRIPTR_DATA_DIR=/tmp/scriptr-e2e`), unzip in-memory, assert the same elements appear in the final XHTML.
7. Toggle "Include author note" off, re-export, assert that final XHTML is absent.

## Risk and Open Questions

- **EPUBCheck warnings on data URLs:** strict validators occasionally flag `data:` URLs. Acceptable for v1 (warnings are non-blocking; Smashwords accepts data-URL images in practice). If this becomes a real issue we revisit by packaging the QR as a real OEBPS image asset.
- **Pen-name string keying edge cases:** trimming and unicode-normalizing pen names could prevent invisible-duplicate profiles ("Jane Doe " vs "Jane Doe"), but it's also a footgun (changes existing keys silently). v1 keeps verbatim string equality; revisit if a user reports collisions.
- **Config PATCH semantics:** verify during implementation that the existing config PATCH route does a deep merge of `penNameProfiles` rather than a whole-object replace, so adding a new pen name doesn't clobber an existing one. If it's a shallow replace, the settings UI sends the full `penNameProfiles` object on save (single-user, single-tab, so no race window matters).
- **Reader page caching:** if the reader page caches HTML between requests, profile/override edits won't reflect immediately. Verify SWR / Next caching behavior for that route during implementation; force `revalidate: 0` on that segment if needed.
