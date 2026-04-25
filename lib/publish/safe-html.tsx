"use client";

import DOMPurify from "isomorphic-dompurify";
import type { Config as DOMPurifyConfig } from "dompurify";

type Props = {
  html: string;
  className?: string;
  extra?: {
    ALLOWED_TAGS?: string[];
    ALLOWED_ATTR?: string[];
    ALLOWED_URI_REGEXP?: RegExp;
  };
};

const BASE_TAGS = ["div", "h1", "p", "strong", "em", "span"];
const BASE_ATTR = ["class"];

// Attributes that carry URIs and must therefore be re-checked against
// `extra.ALLOWED_URI_REGEXP`. DOMPurify lets `data:` URIs through on its
// built-in DATA_URI_TAGS (img/audio/video/source/image/track) regardless of
// `ALLOWED_URI_REGEXP`, so when callers opt in to a strict regex we enforce
// it ourselves via a temporary `uponSanitizeAttribute` hook.
const URI_ATTRS = new Set(["src", "href", "xlink:href"]);

/**
 * Render trusted HTML through DOMPurify as a defense-in-depth layer. The
 * HTML arriving here is already produced by renderChapterPreviewHtml, which
 * entity-escapes raw text before adding tags — so the sanitizer should
 * never actually remove anything in normal operation. Its job is to catch
 * regressions: if a future transformer bug emits a <script> or onclick
 * attribute, the sanitizer strips it before it reaches the DOM.
 *
 * The optional `extra` prop lets specific surfaces (e.g. the author-note
 * end-page) opt in to a wider allowlist on top of the tight base set —
 * additional tags, additional attributes, and an optional URI regex.
 */
export function SafeHtml({ html, className, extra }: Props) {
  const config: DOMPurifyConfig = {
    ALLOWED_TAGS: extra?.ALLOWED_TAGS ? [...BASE_TAGS, ...extra.ALLOWED_TAGS] : BASE_TAGS,
    ALLOWED_ATTR: extra?.ALLOWED_ATTR ? [...BASE_ATTR, ...extra.ALLOWED_ATTR] : BASE_ATTR,
  };
  if (extra?.ALLOWED_URI_REGEXP) {
    config.ALLOWED_URI_REGEXP = extra.ALLOWED_URI_REGEXP;
  }

  let clean: ReturnType<typeof DOMPurify.sanitize>;
  const regex = extra?.ALLOWED_URI_REGEXP;
  if (regex) {
    const hook = (_node: Element, data: { attrName: string; attrValue: string; keepAttr: boolean }) => {
      if (URI_ATTRS.has(data.attrName) && !regex.test(data.attrValue)) {
        data.keepAttr = false;
      }
    };
    DOMPurify.addHook("uponSanitizeAttribute", hook);
    try {
      clean = DOMPurify.sanitize(html, config);
    } finally {
      DOMPurify.removeHook("uponSanitizeAttribute", hook);
    }
  } else {
    clean = DOMPurify.sanitize(html, config);
  }

  return (
    <div
      className={className}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
