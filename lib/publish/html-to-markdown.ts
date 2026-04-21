/**
 * Convert a narrow HTML subset to scriptr's markdown conventions.
 * Whitelisted tags: <strong>/<b>, <em>/<i>, <p>, <br>. Everything else
 * is stripped (inner text preserved). HTML entities are decoded.
 *
 * Used by ImportChapterDialog's paste handler so emphasis from a
 * rich-text source (e.g. Grok web UI, a Word doc) survives the
 * textarea's plain-text paste behavior.
 */

const ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
  "&nbsp;": " ",
};

function decodeEntities(s: string): string {
  // Named entities
  let out = s.replace(/&(?:amp|lt|gt|quot|apos|#39|nbsp);/g, (m) => ENTITY_MAP[m] ?? m);
  // Numeric decimal entities: &#123;
  out = out.replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)));
  // Numeric hex entities: &#x2014;
  out = out.replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)));
  return out;
}

export function htmlToMarkdown(html: string): string {
  if (!html) return "";
  let out = html;

  // Emphasis — non-greedy, can nest (apply twice to catch nesting).
  for (let i = 0; i < 2; i++) {
    out = out.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**");
    out = out.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*");
  }

  // Block-level: paragraphs → double newline
  out = out.replace(/<\/p\s*>\s*<p\b[^>]*>/gi, "\n\n");
  out = out.replace(/<p\b[^>]*>/gi, "");
  out = out.replace(/<\/p\s*>/gi, "");

  // Line breaks
  out = out.replace(/<br\s*\/?>/gi, "\n");

  // Strip any remaining tags
  out = out.replace(/<[^>]+>/g, "");

  // Decode entities
  out = decodeEntities(out);

  // Collapse whitespace runs (but preserve explicit \n).
  out = out
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return out;
}
