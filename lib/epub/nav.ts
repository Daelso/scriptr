import * as cheerio from "cheerio";
import { XMLParser } from "fast-xml-parser";
import { dirname, posix } from "node:path";
import type { EpubArchive } from "@/lib/epub/unzip";
import type { ParsedOpf } from "@/lib/epub/opf";
import type { NavEntry } from "@/lib/epub/types";

const ncxParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => ["navPoint"].includes(name),
  textNodeName: "#text",
});

function splitHref(href: string, baseDir: string): { file: string; anchor?: string } {
  const [path, anchor] = href.split("#");
  return {
    file: posix.join(baseDir, path),
    anchor: anchor || undefined,
  };
}

async function parseEpub3Nav(
  archive: EpubArchive,
  navHref: string
): Promise<NavEntry[]> {
  const xml = await archive.readText(navHref);
  const $ = cheerio.load(xml, { xml: false });
  let navEl = $("nav[epub\\:type='toc']").first();
  if (navEl.length === 0) navEl = $("nav").first();
  if (navEl.length === 0) return [];

  const entries: NavEntry[] = [];
  const baseDir = dirname(navHref);
  navEl.find("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (!href) return;
    const title = $(el).text().trim();
    const { file, anchor } = splitHref(href, baseDir);
    entries.push({ title, file, ...(anchor ? { anchor } : {}) });
  });
  return entries;
}

async function parseEpub2Ncx(
  archive: EpubArchive,
  ncxHref: string
): Promise<NavEntry[]> {
  const xml = await archive.readText(ncxHref);
  const parsed = ncxParser.parse(xml) as Record<string, unknown>;
  const ncx = parsed["ncx"] as Record<string, unknown> | undefined;
  const navMap = ncx?.["navMap"] as Record<string, unknown> | undefined;
  const navPoints = (navMap?.["navPoint"] ?? []) as Array<Record<string, unknown>>;

  const baseDir = dirname(ncxHref);
  const entries: NavEntry[] = [];

  function visit(point: Record<string, unknown>) {
    const navLabel = point["navLabel"] as Record<string, unknown> | undefined;
    const labelText = navLabel?.["text"];
    let title = "";
    if (typeof labelText === "string") title = labelText.trim();
    else if (labelText && typeof labelText === "object" && "#text" in labelText) {
      title = String((labelText as Record<string, unknown>)["#text"] ?? "").trim();
    }
    const content = point["content"] as Record<string, unknown> | undefined;
    const src = content?.["@_src"];
    if (typeof src === "string" && src.length > 0) {
      const { file, anchor } = splitHref(src, baseDir);
      entries.push({ title, file, ...(anchor ? { anchor } : {}) });
    }
    const children = point["navPoint"];
    if (Array.isArray(children)) {
      for (const child of children) visit(child as Record<string, unknown>);
    } else if (children && typeof children === "object") {
      visit(children as Record<string, unknown>);
    }
  }

  for (const p of navPoints) visit(p);
  return entries;
}

export async function parseNav(
  archive: EpubArchive,
  opf: ParsedOpf
): Promise<NavEntry[]> {
  if (opf.epubVersion === 3) {
    for (const entry of opf.manifest.values()) {
      if (entry.properties && /(?:^|\s)nav(?:\s|$)/.test(entry.properties)) {
        if (archive.has(entry.href)) return parseEpub3Nav(archive, entry.href);
      }
    }
    return [];
  }
  for (const entry of opf.manifest.values()) {
    if (entry.mediaType === "application/x-dtbncx+xml") {
      if (archive.has(entry.href)) return parseEpub2Ncx(archive, entry.href);
    }
  }
  return [];
}
