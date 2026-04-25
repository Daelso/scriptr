import DOMPurify from "isomorphic-dompurify";
import type { Config as DOMPurifyConfig } from "dompurify";

/**
 * Attributes that carry URIs and must therefore be re-checked against
 * `ALLOWED_URI_REGEXP`. DOMPurify lets `data:` URIs through on its built-in
 * DATA_URI_TAGS (img/audio/video/source/image/track) regardless of
 * `ALLOWED_URI_REGEXP`, so we enforce it ourselves via a temporary
 * `uponSanitizeAttribute` hook.
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
