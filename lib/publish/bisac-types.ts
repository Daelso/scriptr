// lib/publish/bisac-types.ts

/**
 * One BISAC subject heading entry.
 *
 * Keys are short (`c`/`l`) to keep public/bisac-codes.json compact.
 * `c`: BISAC code, format /^[A-Z]{3}\d{6}$/ (e.g. "FIC027000").
 * `l`: hierarchical label, top-level subject in ALL CAPS,
 *      levels separated by " / " (e.g. "FICTION / Romance / Erotica").
 */
export type BisacEntry = {
  c: string;
  l: string;
};
