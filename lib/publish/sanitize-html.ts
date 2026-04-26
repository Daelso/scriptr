import DOMPurify from "isomorphic-dompurify";
import type { Config as DOMPurifyConfig } from "dompurify";

/**
 * URI-bearing attributes that DOMPurify lets through on tags currently in
 * `AUTHOR_NOTE_SANITIZE_OPTS.ALLOWED_TAGS`. The `uponSanitizeAttribute` hook
 * re-checks these against `ALLOWED_URI_REGEXP` because DOMPurify's built-in
 * DATA_URI_TAGS allowlist (img/audio/video/source/image/track) would
 * otherwise let `data:` URIs through regardless of the regex.
 *
 * IMPORTANT: this set is scoped to URI-bearing attributes that the CURRENT
 * allowlists (`AUTHOR_NOTE_SANITIZE_OPTS.ALLOWED_TAGS`) can produce. It is
 * NOT an exhaustive list of every URI-bearing HTML attribute. When widening
 * `ALLOWED_TAGS` (e.g. to include `<source>`, `<video>`, `<form>`,
 * `<object>`, `<embed>`, `<iframe>`, ...), audit this set against the new
 * tags' URI-bearing attributes (`srcset`, `poster`, `formaction`, `action`,
 * `data`, `archive`, ...) and add anything missing.
 */
export const URI_ATTRS = new Set([
  "src",
  "href",
  "xlink:href",
  "srcset",
  "poster",
  "cite",
  "formaction",
  "action",
  "background",
  "longdesc",
  "usemap",
]);

/**
 * Run DOMPurify with an optional URI allowlist regex that is also enforced
 * on URI-bearing attributes (see `URI_ATTRS`). The hook is added/removed
 * around a single `sanitize` call so this helper is safe to call from
 * concurrent code paths — we never leave a global hook installed.
 *
 * Centralized so that both the EPUB build path (`buildAuthorNoteHtml`) and
 * the reader's `SafeHtml` component apply the same belt-and-suspenders
 * treatment to `data:` URIs without duplicating the hook implementation.
 */
export function sanitizeWith(
  html: string,
  config: DOMPurifyConfig,
  uriRegex?: RegExp,
): string {
  if (!uriRegex) {
    return DOMPurify.sanitize(html, config) as string;
  }
  const hook = (
    _node: Element,
    data: { attrName: string; attrValue: string; keepAttr: boolean },
  ) => {
    if (URI_ATTRS.has(data.attrName) && !uriRegex.test(data.attrValue)) {
      data.keepAttr = false;
    }
  };
  DOMPurify.addHook("uponSanitizeAttribute", hook);
  try {
    return DOMPurify.sanitize(html, config) as string;
  } finally {
    DOMPurify.removeHook("uponSanitizeAttribute", hook);
  }
}
