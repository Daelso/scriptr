#!/usr/bin/env node
/**
 * BISAC codes JSON builder.
 *
 * Source:  scripts/data/bisac-source.csv
 *          (Retrieved from https://raw.githubusercontent.com/bahadirdogru/bisaccodes/main/bisac.csv
 *          on 2026-04-27. License: MIT (https://github.com/bahadirdogru/bisaccodes/blob/main/LICENSE).
 *          That repo's README states the CSV was scraped from the official BISG list at
 *          https://bisg.org/page/bisacedition on 2025-10-10. The committed source CSV in this
 *          repo has the upstream's single non-data preamble row -- `"","Complete BISAC Subject
 *          Headings List","Generated on ..."` -- removed; everything else is byte-identical to
 *          the upstream file. The upstream is three columns, `Code,Description,Comment`; the
 *          parser below reads the first two and ignores the third.)
 * Output:  public/bisac-codes.json
 *
 * Run manually after pulling a new source CSV:
 *   node scripts/build-bisac-codes.mjs
 *
 * The output is committed to git so annual updates produce a reviewable diff.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SRC = resolve(ROOT, "scripts/data/bisac-source.csv");
const OUT = resolve(ROOT, "public/bisac-codes.json");

const CODE_RX = /^[A-Z]{3}\d{6}$/;

function parseCsvLine(line) {
  const out = [];
  let buf = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { buf += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { buf += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ",") { out.push(buf); buf = ""; }
      else { buf += ch; }
    }
  }
  out.push(buf);
  return out;
}

function main() {
  const raw = readFileSync(SRC, "utf8").replace(/^﻿/, ""); // strip BOM
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);

  const firstRowFirstCell = parseCsvLine(lines[0])[0]?.trim() ?? "";
  const dataLines = CODE_RX.test(firstRowFirstCell) ? lines : lines.slice(1);

  const entries = new Map();
  for (let i = 0; i < dataLines.length; i++) {
    const fields = parseCsvLine(dataLines[i]);
    if (fields.length < 2) {
      throw new Error(`Row ${i + 1}: expected at least 2 columns, got ${fields.length}`);
    }
    const code = fields[0].trim();
    const label = fields[1].trim();
    if (!CODE_RX.test(code)) {
      throw new Error(`Row ${i + 1}: invalid code "${code}" (must match ${CODE_RX})`);
    }
    if (label.length === 0) {
      throw new Error(`Row ${i + 1}: empty label for code ${code}`);
    }
    if (entries.has(code)) {
      console.warn(`Duplicate code ${code} on row ${i + 1}; keeping later label.`);
    }
    entries.set(code, label);
  }

  const sorted = [...entries.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([c, l]) => ({ c, l }));

  writeFileSync(OUT, JSON.stringify(sorted, null, 0) + "\n", "utf8");
  console.log(`Wrote ${sorted.length} BISAC entries to ${OUT}`);
}

main();
