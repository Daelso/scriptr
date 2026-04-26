// Shared, dependency-free constants/types for the author-note feature.
//
// CRITICAL: this module must NOT import `qrcode`, `DOMPurify`, or any other
// runtime dependency. Client components (`AuthorNoteCard`, `ReaderView`)
// import the sanitize allowlist from here so Turbopack can keep the
// `qrcode` package — pulled in by `lib/publish/author-note.ts` — out of the
// editor and reader page client bundles.

export type ResolvedAuthorNote = {
  messageHtml: string;
  email?: string;
  mailingListUrl?: string;
};

export const AUTHOR_NOTE_SANITIZE_OPTS = {
  ALLOWED_TAGS: ["div", "p", "br", "strong", "em", "h2", "a", "img"],
  ALLOWED_ATTR: ["class", "href", "src", "alt", "width", "height"],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|data:image\/png;base64,)/i,
  // DOMPurify defaults `ALLOW_DATA_ATTR` and `ALLOW_ARIA_ATTR` to true,
  // which lets `data-*` and `aria-*` attributes through regardless of the
  // ALLOWED_ATTR list. The author-note feature has no need for either, so
  // turn them off as defense in depth — keeps the attribute surface area
  // tight to exactly what `buildAuthorNoteHtml` produces.
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
};
