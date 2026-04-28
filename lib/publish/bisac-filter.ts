// lib/publish/bisac-filter.ts
import type { BisacEntry } from "./bisac-types";

/**
 * Filter BISAC entries by a free-form query.
 *
 * Rules (case-insensitive):
 *   1. Empty query → return all entries unchanged.
 *   2. Code-prefix branch: if the first whitespace-separated token is a
 *      prefix of the entry's code, the entry matches. Other tokens are
 *      ignored on this branch.
 *   3. Label-tokens branch: if every whitespace-separated token appears
 *      as a substring of the entry's label, the entry matches.
 *   4. An entry is included if EITHER branch matches.
 *
 * Input order is preserved. The function does not deduplicate or sort.
 */
export function bisacFilter(
  entries: readonly BisacEntry[],
  query: string,
): BisacEntry[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed === "") return [...entries];

  const tokens = trimmed.split(/\s+/);
  const firstToken = tokens[0];

  return entries.filter((e) => {
    const codeLower = e.c.toLowerCase();
    if (codeLower.startsWith(firstToken)) return true;

    const labelLower = e.l.toLowerCase();
    return tokens.every((t) => labelLower.includes(t));
  });
}
