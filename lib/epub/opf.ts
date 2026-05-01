import { XMLParser } from "fast-xml-parser";
import { dirname, posix } from "node:path";
import type { EpubArchive } from "@/lib/epub/unzip";
import { EpubParseError } from "@/lib/epub/types";

export type ManifestEntry = {
  id: string;
  href: string;
  mediaType: string;
  properties?: string;
};

export type ParsedOpf = {
  epubVersion: 2 | 3;
  metadata: {
    title: string;
    creator: string;
    description: string;
    subjects: string[];
    language: string;
  };
  manifest: Map<string, ManifestEntry>;
  spine: string[];
  coverManifestId: string | null;
  /** Directory the OPF lives in (zip path), used by callers to resolve hrefs. */
  opfDir: string;
};

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  isArray: (name) =>
    [
      "subject",
      "item",
      "itemref",
      "meta",
      "rootfile",
    ].includes(name),
  textNodeName: "#text",
  parseAttributeValue: false,
});

export async function findOpfPath(archive: EpubArchive): Promise<string> {
  if (!archive.has("META-INF/container.xml")) {
    throw new EpubParseError("Missing container.xml — not an EPUB.");
  }
  const xml = await archive.readText("META-INF/container.xml");
  const parsed = xmlParser.parse(xml) as Record<string, unknown>;
  const container = parsed["container"] as Record<string, unknown> | undefined;
  const rootfiles = container?.["rootfiles"] as Record<string, unknown> | undefined;
  const rfList = (rootfiles?.["rootfile"] ?? []) as Array<Record<string, unknown>>;
  const fullPath = rfList[0]?.["@_full-path"] as string | undefined;
  if (!fullPath) {
    throw new EpubParseError("Could not find content.opf in this EPUB.");
  }
  return fullPath;
}

function joinZip(opfDir: string, href: string): string {
  return posix.join(opfDir, href);
}

function flatString(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node.trim();
  if (typeof node === "object" && node !== null) {
    const o = node as Record<string, unknown>;
    if (typeof o["#text"] === "string") return (o["#text"] as string).trim();
  }
  return "";
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

export function parseOpf(xml: string, opfPath: string): ParsedOpf {
  const parsed = xmlParser.parse(xml) as Record<string, unknown>;
  const pkg = parsed["package"] as Record<string, unknown> | undefined;
  if (!pkg) throw new EpubParseError("Could not find content.opf in this EPUB.");

  const versionRaw = String(pkg["@_version"] ?? "");
  let epubVersion: 2 | 3;
  if (/^3(\.|$)/.test(versionRaw)) epubVersion = 3;
  else if (/^2(\.|$)/.test(versionRaw)) epubVersion = 2;
  else {
    throw new EpubParseError(
      `Unsupported EPUB version: got ${versionRaw || "unknown"}, expected 2.x or 3.x.`
    );
  }

  const opfDir = dirname(opfPath);

  const metaBlock = (pkg["metadata"] ?? {}) as Record<string, unknown>;
  const title = flatString(asArray(metaBlock["title"])[0] ?? metaBlock["title"]);
  if (!title) throw new EpubParseError("This EPUB has no title in its metadata.");

  const creator = flatString(asArray(metaBlock["creator"])[0] ?? metaBlock["creator"]);
  const description = flatString(metaBlock["description"]);
  const language = flatString(metaBlock["language"]);
  const subjects = asArray(metaBlock["subject"])
    .map((s) => flatString(s))
    .filter((s) => s.length > 0);

  const manifestBlock = (pkg["manifest"] ?? {}) as Record<string, unknown>;
  const manifest = new Map<string, ManifestEntry>();
  for (const item of asArray<Record<string, unknown>>(
    manifestBlock["item"] as Record<string, unknown>[] | undefined
  )) {
    const id = String(item["@_id"] ?? "");
    const hrefRaw = String(item["@_href"] ?? "");
    const mediaType = String(item["@_media-type"] ?? "");
    const properties = item["@_properties"] as string | undefined;
    if (!id || !hrefRaw) continue;
    manifest.set(id, {
      id,
      href: joinZip(opfDir, hrefRaw),
      mediaType,
      properties,
    });
  }

  const spineBlock = (pkg["spine"] ?? {}) as Record<string, unknown>;
  const spine: string[] = asArray<Record<string, unknown>>(
    spineBlock["itemref"] as Record<string, unknown>[] | undefined
  )
    .map((ir) => String(ir["@_idref"] ?? ""))
    .filter((s) => s.length > 0);

  let coverManifestId: string | null = null;
  for (const entry of manifest.values()) {
    if (entry.properties && /(?:^|\s)cover-image(?:\s|$)/.test(entry.properties)) {
      coverManifestId = entry.id;
      break;
    }
  }
  if (!coverManifestId) {
    for (const m of asArray<Record<string, unknown>>(
      metaBlock["meta"] as Record<string, unknown>[] | undefined
    )) {
      if (m["@_name"] === "cover" && typeof m["@_content"] === "string") {
        const candidate = m["@_content"] as string;
        if (manifest.has(candidate)) {
          coverManifestId = candidate;
          break;
        }
      }
    }
  }

  return {
    epubVersion,
    metadata: { title, creator, description, subjects, language },
    manifest,
    spine,
    coverManifestId,
    opfDir,
  };
}
