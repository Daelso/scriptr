// lib/publish/sanitize-client.ts
"use client";

import DOMPurify from "dompurify";
import type { Config as DOMPurifyConfig } from "dompurify";

/**
 * Client-side HTML sanitizer. Uses plain `dompurify` against the browser's
 * native `window` -- no DOM emulation needed, since this only runs in the
 * browser. The server-side equivalent lives in `lib/publish/sanitize-server.ts`
 * and is what the EPUB build path uses.
 *
 * Splitting client and server like this lets us drop `isomorphic-dompurify`
 * (and the jsdom dep chain it pulls in on Node) entirely from the
 * production runtime -- see docs/superpowers/plans/2026-04-28-replace-isomorphic-dompurify.md.
 */

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
  return true;
}

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
