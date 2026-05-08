export type TitleExtractResult = { title: string | null; body: string };

const BRACKET_LINE = /^\s*\[([^\]]+)\]\s*$/;

/**
 * If the first non-blank line of `body` is a bare bracket-wrapped title
 * (e.g. `[Chosen by the Goddess]`), lift the inner text and strip that
 * line — plus any blank lines immediately following it — from the body.
 *
 * Strict: bracket must span the whole line after trimming. In-line
 * brackets, multi-line bracket spans, and brackets followed by prose on
 * the same line do not match.
 */
export function extractBracketTitle(body: string): TitleExtractResult {
  const lines = body.split(/\r?\n/);

  let firstNonBlank = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().length > 0) {
      firstNonBlank = i;
      break;
    }
  }
  if (firstNonBlank === -1) return { title: null, body };

  const match = lines[firstNonBlank].match(BRACKET_LINE);
  if (!match) return { title: null, body };

  const inner = match[1].trim();
  if (inner.length === 0) return { title: null, body };

  // Skip the matched line and any run of blank lines immediately after it.
  let nextContent = firstNonBlank + 1;
  while (nextContent < lines.length && lines[nextContent].trim().length === 0) {
    nextContent++;
  }

  // Splitting on /\r?\n/ consumes the \r as part of the delimiter, so
  // CRLF input comes back as LF after rejoining. This matches what the
  // surrounding splitter already does (see splitProseIntoStories), and
  // the importer normalizes line endings end-to-end.
  const remaining = lines.slice(nextContent).join("\n");

  return { title: inner, body: remaining };
}
