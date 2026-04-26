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

const URI_CONTROL_OR_SPACE_RE = /[\u0000-\u001F\u007F\s]/u;
const URI_BIDI_RE = /[\u202A-\u202E\u2066-\u2069]/u;

function normalizeUriValue(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (URI_CONTROL_OR_SPACE_RE.test(trimmed) || URI_BIDI_RE.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function uriRegexAllows(uriRegex: RegExp, value: string): boolean {
  uriRegex.lastIndex = 0;
  return uriRegex.test(value);
}

function extraUriChecks(value: string): boolean {
  const lower = value.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://")) {
    try {
      const parsed = new URL(value);
      return (
        (parsed.protocol === "http:" || parsed.protocol === "https:")
        && parsed.hostname.length > 0
      );
    } catch {
      return false;
    }
  }
  if (lower.startsWith("mailto:")) {
    const addr = value.slice("mailto:".length);
    return addr.length > 0 && addr.includes("@");
  }
  if (lower.startsWith("data:image/png;base64,")) {
    const payload = value.slice("data:image/png;base64,".length);
    return payload.length > 0 && /^[A-Za-z0-9+/=]+$/.test(payload);
  }
  // Unknown schemes are governed by the caller's regex only.
  return true;
}

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
    try {
      const attr = data.attrName.toLowerCase();
      if (!URI_ATTRS.has(attr)) return;
      const normalized = normalizeUriValue(data.attrValue);
      if (!normalized) {
        data.keepAttr = false;
        return;
      }
      if (!uriRegexAllows(uriRegex, normalized) || !extraUriChecks(normalized)) {
        data.keepAttr = false;
        return;
      }
      data.attrValue = normalized;
    } catch {
      // Fail closed on any unexpected parser/regex error.
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
