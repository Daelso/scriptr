// lib/publish/bisac-types.ts

/**
 * One BISAC subject heading entry.
 *
 * Keys are short (`c`/`l`) to keep public/bisac-codes.json compact.
 * `c`: BISAC code, format /^[A-Z]{3}\d{6}$/ (e.g. "FIC005000").
 * `l`: hierarchical label as published by the upstream source,
 *      levels separated by " / " (e.g. "Fiction / Erotica / General").
 *      Casing is whatever the source provides; consumers must compare
 *      case-insensitively.
 */
export type BisacEntry = {
  c: string;
  l: string;
};
