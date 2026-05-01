import * as cheerio from "cheerio";
import { htmlToMarkdown } from "@/lib/publish/html-to-markdown";
import { logger } from "@/lib/logger";
import type { EpubArchive } from "@/lib/epub/unzip";
import type { ParsedOpf } from "@/lib/epub/opf";
import type { ChapterDraft, NavEntry } from "@/lib/epub/types";

// Known limitation: anchor slicing assumes anchored elements are siblings
// inside <body>. If a real-world EPUB nests anchors under <section>/<div>
// wrappers, the walker will overshoot to end-of-body for the affected
// chapter. Documented in the spec's "Edge cases" section.

/** Minimal shape for a parsed DOM node as returned by cheerio/domhandler. */
interface DomNode {
  type: string;
  attribs?: Record<string, string>;
  next: DomNode | null;
}

function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function makeDraft(opts: {
  title: string;
  body: string;
  href: string;
  source: "nav" | "spine";
}): ChapterDraft {
  const wordCount = countWords(opts.body);
  const empty = wordCount === 0;
  return {
    navTitle: opts.title,
    body: opts.body,
    wordCount,
    sourceHref: opts.href,
    source: opts.source,
    skippedByDefault: empty,
    ...(empty ? { skipReason: "Empty chapter" } : {}),
  };
}

type FileGroup = {
  file: string;
  entries: Array<{ title: string; anchor?: string; href: string }>;
};

function groupByFile(nav: NavEntry[]): FileGroup[] {
  const groups: FileGroup[] = [];
  for (const e of nav) {
    const prev = groups[groups.length - 1];
    if (prev && prev.file === e.file) {
      prev.entries.push({ title: e.title, anchor: e.anchor, href: e.file });
    } else {
      groups.push({
        file: e.file,
        entries: [{ title: e.title, anchor: e.anchor, href: e.file }],
      });
    }
  }
  return groups;
}

function bodyHtml($: cheerio.CheerioAPI): string {
  const body = $("body").first();
  if (body.length === 0) return "";
  return body.html() ?? "";
}

function sliceFromNode(
  $: cheerio.CheerioAPI,
  startNode: DomNode | null,
  endId: string | null
): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let node: DomNode | null = startNode ?? (($("body").children().first()[0] as any) ?? null);
  if (!node) return "";
  const collected: DomNode[] = [];
  while (node) {
    if (endId && node.type === "tag" && node.attribs?.id === endId) {
      break;
    }
    collected.push(node);
    node = node.next;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return collected.map((n) => $.html(n as any)).join("");
}

async function walkFromNav(
  archive: EpubArchive,
  nav: NavEntry[]
): Promise<ChapterDraft[]> {
  const groups = groupByFile(nav);
  const out: ChapterDraft[] = [];
  for (const group of groups) {
    if (!archive.has(group.file)) {
      logger.warn(`[epub/walk] nav target missing: ${group.file}`);
      continue;
    }
    const xml = await archive.readText(group.file);
    const $ = cheerio.load(xml, { xml: false });

    if (group.entries.length === 1 && !group.entries[0].anchor) {
      out.push(
        makeDraft({
          title: group.entries[0].title,
          body: htmlToMarkdown(bodyHtml($)),
          href: group.file,
          source: "nav",
        })
      );
      continue;
    }

    for (let i = 0; i < group.entries.length; i++) {
      const cur = group.entries[i];
      const next = group.entries[i + 1];
      let startNode: DomNode | null;
      if (cur.anchor) {
        const found = $(`#${cur.anchor}`).first()[0];
        if (!found) {
          // Anchor specified but not present in the document — emit empty
          // chapter (will be skippedByDefault) rather than silently consuming
          // content meant for another chapter.
          logger.warn(`[epub/walk] nav anchor #${cur.anchor} not found in ${group.file}`);
          out.push(makeDraft({ title: cur.title, body: "", href: group.file, source: "nav" }));
          continue;
        }
        startNode = found as unknown as DomNode;
      } else {
        startNode = null; // legitimate anchorless first entry
      }
      const endId = next?.anchor ?? null;
      const slice = sliceFromNode($, startNode, endId);
      out.push(
        makeDraft({
          title: cur.title,
          body: htmlToMarkdown(slice),
          href: group.file,
          source: "nav",
        })
      );
    }
  }
  return out;
}

async function walkFromSpine(
  archive: EpubArchive,
  opf: ParsedOpf
): Promise<ChapterDraft[]> {
  const out: ChapterDraft[] = [];
  let nthChapter = 0;
  for (const idref of opf.spine) {
    const entry = opf.manifest.get(idref);
    if (!entry) continue;
    if (!archive.has(entry.href)) {
      logger.warn(`[epub/walk] spine target missing: ${entry.href}`);
      continue;
    }
    nthChapter += 1;
    const xml = await archive.readText(entry.href);
    const $ = cheerio.load(xml, { xml: false });
    const heading = $("h1").first().text().trim() || $("h2").first().text().trim();
    const title = heading || `Chapter ${nthChapter}`;
    out.push(
      makeDraft({
        title,
        body: htmlToMarkdown(bodyHtml($)),
        href: entry.href,
        source: "spine",
      })
    );
  }
  return out;
}

export async function walkChapters(
  archive: EpubArchive,
  opf: ParsedOpf,
  nav: NavEntry[]
): Promise<ChapterDraft[]> {
  if (nav.length > 0) return walkFromNav(archive, nav);
  return walkFromSpine(archive, opf);
}
