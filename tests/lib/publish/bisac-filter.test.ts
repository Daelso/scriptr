// tests/lib/publish/bisac-filter.test.ts
import { describe, it, expect } from "vitest";
import { bisacFilter } from "@/lib/publish/bisac-filter";
import type { BisacEntry } from "@/lib/publish/bisac-types";

const ENTRIES: BisacEntry[] = [
  { c: "FIC000000", l: "FICTION / General" },
  { c: "FIC027000", l: "FICTION / Romance / Erotica" },
  { c: "FIC027010", l: "FICTION / Romance / Adult" },
  { c: "JUV000000", l: "JUVENILE FICTION / General" },
  { c: "COO000000", l: "COOKING / General" },
];

describe("bisacFilter", () => {
  it("returns all entries for empty query", () => {
    expect(bisacFilter(ENTRIES, "")).toEqual(ENTRIES);
    expect(bisacFilter(ENTRIES, "   ")).toEqual(ENTRIES);
  });

  it("matches by code prefix (case-insensitive)", () => {
    const out = bisacFilter(ENTRIES, "fic027");
    expect(out.map((e) => e.c)).toEqual(["FIC027000", "FIC027010"]);
  });

  it("matches by single label token", () => {
    const out = bisacFilter(ENTRIES, "erotica");
    expect(out.map((e) => e.c)).toEqual(["FIC027000"]);
  });

  it("requires every label token to appear (AND semantics)", () => {
    const out = bisacFilter(ENTRIES, "romance erot");
    expect(out.map((e) => e.c)).toEqual(["FIC027000"]);
  });

  it("falls back from code-prefix branch to label-tokens branch", () => {
    // "fiction romance" — first token isn't a code prefix, so use label-tokens.
    const out = bisacFilter(ENTRIES, "fiction romance");
    expect(out.map((e) => e.c)).toEqual(["FIC027000", "FIC027010"]);
  });

  it("code-prefix branch ignores remaining tokens", () => {
    // "fic000 fiction" — first token is a code prefix; second token ignored.
    const out = bisacFilter(ENTRIES, "fic000 fiction");
    expect(out.map((e) => e.c)).toEqual(["FIC000000"]);
  });

  it("is case-insensitive on labels", () => {
    expect(bisacFilter(ENTRIES, "FICTION").length).toBeGreaterThan(0);
    expect(bisacFilter(ENTRIES, "fiction").length).toBeGreaterThan(0);
    expect(bisacFilter(ENTRIES, "Fiction").length).toBeGreaterThan(0);
  });

  it("returns empty array on no match", () => {
    expect(bisacFilter(ENTRIES, "biographies")).toEqual([]);
  });

  it("preserves input order", () => {
    const out = bisacFilter(ENTRIES, "general");
    expect(out.map((e) => e.c)).toEqual([
      "FIC000000",
      "JUV000000",
      "COO000000",
    ]);
  });
});
