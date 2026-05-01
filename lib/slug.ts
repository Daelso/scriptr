// Cap slug length so <dataDir>/stories/<slug>/chapters/NNN-<slug>.json stays
// under Windows' default MAX_PATH (260) even when source titles are long
// (e.g. EPUB chapters whose <h1> contains a full content-warning paragraph).
const MAX_SLUG_LEN = 80;

export function toSlug(input: string, maxLen: number = MAX_SLUG_LEN): string {
  let s = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (s.length > maxLen) s = s.slice(0, maxLen).replace(/-+$/g, "");
  return s || "untitled";
}

export function uniqueSlug(base: string, existing: string[]): string {
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

const SLUG_SEGMENT_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlugSegment(input: string): boolean {
  return SLUG_SEGMENT_RE.test(input);
}
