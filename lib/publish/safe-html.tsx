"use client";

import DOMPurify from "isomorphic-dompurify";

type Props = {
  html: string;
  className?: string;
};

/**
 * Render trusted HTML through DOMPurify as a defense-in-depth layer. The
 * HTML arriving here is already produced by renderChapterPreviewHtml, which
 * entity-escapes raw text before adding tags — so the sanitizer should
 * never actually remove anything in normal operation. Its job is to catch
 * regressions: if a future transformer bug emits a <script> or onclick
 * attribute, the sanitizer strips it before it reaches the DOM.
 */
export function SafeHtml({ html, className }: Props) {
  const clean = DOMPurify.sanitize(html, {
    // Allowlist: the exact set of tags and classes the transformer emits.
    ALLOWED_TAGS: ["div", "h1", "p", "strong", "em", "span"],
    ALLOWED_ATTR: ["class"],
  });
  return (
    <div
      className={className}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
