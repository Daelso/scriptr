#!/usr/bin/env node
// One-time migration for chapters imported before the walker started
// stripping leading <h1>/<h2> headings from EPUB chapter bodies. The old
// walker piped the chapter HTML through htmlToMarkdown verbatim, which
// strips the heading tag but keeps the text — so each imported chapter's
// body began with a paragraph echoing the chapter title, and that text
// was rendered a second time on EPUB re-export.
//
// This script touches only chapters whose `source` is "imported". For
// each such chapter, if the first non-empty line of its first section
// matches the chapter title (whitespace-and-case normalized, stripping
// leading markdown emphasis), it removes that line (and any blank
// padding after it) and recomputes wordCount.
//
// Usage:
//   # Dry-run (default — prints what would change, writes nothing):
//   node scripts/clean-imported-chapter-bodies.mjs --data="<path>"
//
//   # Apply changes:
//   node scripts/clean-imported-chapter-bodies.mjs --data="<path>" --apply
//
// On Windows the scriptr Electron app stores data at:
//   C:\Users\<you>\AppData\Roaming\scriptr\data
// From WSL, point --data at /mnt/c/Users/<you>/AppData/Roaming/scriptr/data
// (close scriptr before running with --apply).

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

function parseArgs(argv) {
  const apply = argv.includes("--apply");
  const dataArg = argv.find((a) => a.startsWith("--data="));
  if (!dataArg) {
    console.error('Required: --data="/path/to/scriptr/data"');
    process.exit(1);
  }
  return { dataDir: dataArg.slice("--data=".length), apply };
}

function normalize(s) {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function countWords(s) {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

// Returns { body, stripped } — if the first non-empty line of `body`
// matches `title` (after normalisation and trimming markdown emphasis
// chars), drops it plus any trailing blank lines.
export function stripLeadingTitle(body, title) {
  if (!body || !title) return { body, stripped: false };
  const target = normalize(title);
  if (!target) return { body, stripped: false };

  const lines = body.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i >= lines.length) return { body, stripped: false };

  const firstLine = lines[i].replace(/^[*_#\s>]+|[*_#\s>]+$/g, "");
  if (normalize(firstLine) !== target) return { body, stripped: false };

  let j = i + 1;
  while (j < lines.length && lines[j].trim() === "") j++;
  return { body: lines.slice(j).join("\n").replace(/^\n+/, ""), stripped: true };
}

async function listStorySlugs(dataDir) {
  const root = join(dataDir, "stories");
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

async function processStory(dataDir, slug, apply) {
  const chaptersDir = join(dataDir, "stories", slug, "chapters");
  let files;
  try {
    files = await readdir(chaptersDir);
  } catch (err) {
    if (err.code === "ENOENT") return { changed: 0, total: 0 };
    throw err;
  }
  const jsonFiles = files.filter((f) => f.endsWith(".json"));
  let changed = 0;
  for (const file of jsonFiles) {
    const path = join(chaptersDir, file);
    let chapter;
    try {
      const raw = await readFile(path, "utf-8");
      chapter = JSON.parse(raw);
    } catch (err) {
      console.warn(`  ! ${slug}/${file}: skipping (${err.message})`);
      continue;
    }
    if (chapter.source !== "imported") continue;
    if (!Array.isArray(chapter.sections) || chapter.sections.length === 0) continue;

    const firstSection = chapter.sections[0];
    const { body, stripped } = stripLeadingTitle(firstSection?.content ?? "", chapter.title ?? "");
    if (!stripped) continue;

    const newSections = [{ ...firstSection, content: body }, ...chapter.sections.slice(1)];
    const newWordCount = newSections.reduce((n, s) => n + countWords(s.content ?? ""), 0);
    const updated = { ...chapter, sections: newSections, wordCount: newWordCount };

    const titlePreview = chapter.title.length > 60
      ? chapter.title.slice(0, 57) + "..."
      : chapter.title;
    console.log(
      `  - ${slug}/${file}: stripped leading title "${titlePreview}" (wordCount ${chapter.wordCount} → ${newWordCount})`
    );

    if (apply) {
      await writeFile(path, JSON.stringify(updated, null, 2), "utf-8");
    }
    changed++;
  }
  return { changed, total: jsonFiles.length };
}

async function main() {
  const { dataDir, apply } = parseArgs(process.argv.slice(2));
  const slugs = await listStorySlugs(dataDir);
  if (slugs.length === 0) {
    console.log(`No stories found under ${dataDir}/stories.`);
    return;
  }
  console.log(
    `Scanning ${slugs.length} story dir(s) under ${dataDir}${apply ? "" : " (dry-run — pass --apply to write)"}.\n`
  );
  let totalChanged = 0;
  for (const slug of slugs) {
    const { changed, total } = await processStory(dataDir, slug, apply);
    if (changed > 0) {
      console.log(
        `Story "${slug}": ${changed}/${total} chapter(s) ${apply ? "fixed" : "would be fixed"}.`
      );
    }
    totalChanged += changed;
  }
  console.log(
    `\nDone — ${totalChanged} chapter(s) ${apply ? "updated" : "to update (re-run with --apply)"}.`
  );
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
