"use client";

import type { Config as DOMPurifyConfig } from "dompurify";
import { sanitizeWith } from "@/lib/publish/sanitize-html";

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

  const clean = sanitizeWith(html, config, extra?.ALLOWED_URI_REGEXP);

  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
