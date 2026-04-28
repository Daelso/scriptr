// lib/publish/sanitize-server.ts
import sanitizeHtml from "sanitize-html";

/**
 * Server-side HTML sanitizer for the EPUB build path. Wraps the
 * `sanitize-html` package (htmlparser2, no DOM emulation, no ESM-only
 * transitives) behind the DOMPurify-shape options used elsewhere in the
 * codebase, so callers don't have to learn a second sanitizer config shape.
 *
 * This file MUST NOT import `isomorphic-dompurify`, `dompurify`, `jsdom`,
 * or any DOM emulation. The whole point is that `lib/publish/author-note.ts`
 * (loaded server-side from the EPUB export route) can be rendered inside a
 * packaged Electron build (Electron 33 = Node 20.18) without hitting the
 * `@csstools/css-calc` ERR_REQUIRE_ESM that jsdom 26+ pulls in.
 */

export type SanitizeOpts = {
  ALLOWED_TAGS: string[];
  ALLOWED_ATTR: string[];
  ALLOW_DATA_ATTR?: boolean;
  ALLOW_ARIA_ATTR?: boolean;
};

// Mirror of URI_ATTRS from the old DOMPurify hook. Scoped to attributes the
// current AUTHOR_NOTE_SANITIZE_OPTS allowlist can produce; if/when the
// allowlist widens, audit this set against the new tags' URI-bearing attrs.
const URI_ATTRS = new Set([
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
  return true;
}

function uriRegexAllows(uriRegex: RegExp, value: string): boolean {
  uriRegex.lastIndex = 0;
  return uriRegex.test(value);
}

/**
 * Sanitize HTML with a DOMPurify-shape config and an optional URI allowlist
 * regex that is also enforced on URI-bearing attributes via a transform pass.
 * Mirrors the pre-existing `lib/publish/sanitize-html.ts` API exactly so
 * callers (currently `lib/publish/author-note.ts`) need no behavioral
 * changes.
 *
 * Note: `sanitize-html` does NOT auto-allow `data-*` / `aria-*` attributes,
 * so `ALLOW_DATA_ATTR: false` and `ALLOW_ARIA_ATTR: false` are the natural
 * default and need no special handling. They are accepted in the opts shape
 * for parity with the existing constants.
 */
export function sanitizeWith(
  html: string,
  opts: SanitizeOpts,
  uriRegex?: RegExp,
): string {
  return sanitizeHtml(html, {
    allowedTags: opts.ALLOWED_TAGS,
    allowedAttributes: { "*": opts.ALLOWED_ATTR },
    // Fall back to sanitize-html's default scheme list when no uriRegex is
    // supplied. When one IS supplied, we widen schemes to include `data:`
    // and rely on the transform pass below to do the precise filtering.
    allowedSchemes: uriRegex
      ? ["http", "https", "mailto", "data"]
      : ["http", "https", "ftp", "mailto"],
    allowedSchemesAppliedToAttributes: ["href", "src", "cite"],
    // Drop tags whose attributes don't survive the URI filter? No — we keep
    // the tag and just strip the bad attribute, matching DOMPurify's hook
    // semantics (`data.keepAttr = false`).
    transformTags: uriRegex
      ? {
          "*": (tagName: string, attribs: Record<string, string>) => {
            const out: Record<string, string> = {};
            for (const [name, value] of Object.entries(attribs)) {
              if (URI_ATTRS.has(name.toLowerCase())) {
                const normalized = normalizeUriValue(value);
                if (!normalized) continue;
                if (!uriRegexAllows(uriRegex, normalized)) continue;
                if (!extraUriChecks(normalized)) continue;
                out[name] = normalized;
              } else {
                out[name] = value;
              }
            }
            return { tagName, attribs: out };
          },
        }
      : undefined,
  });
}
