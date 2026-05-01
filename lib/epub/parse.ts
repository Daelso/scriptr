import { XMLParser } from "fast-xml-parser";
import { openEpubArchive } from "@/lib/epub/unzip";
import { findOpfPath, parseOpf } from "@/lib/epub/opf";
import { parseNav } from "@/lib/epub/nav";
import { walkChapters } from "@/lib/epub/walk";
import { applyBoilerplateFlags } from "@/lib/epub/boilerplate";
import { extractCover } from "@/lib/epub/cover";
import { EpubParseError } from "@/lib/epub/types";
import type { ParsedEpub } from "@/lib/epub/types";

const MAX_BYTES = 50 * 1024 * 1024;
const MAX_CHAPTERS = 200;
const FONT_OBFUSCATION_ALGS = new Set([
  "http://www.idpf.org/2008/embedding",
  "http://ns.adobe.com/pdf/enc#RC",
]);

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => ["EncryptedData"].includes(name),
});

function checkEncryption(xml: string): "ok" | "drm" {
  const parsed = xmlParser.parse(xml) as Record<string, unknown>;
  const enc = parsed["encryption"] as Record<string, unknown> | undefined;
  if (!enc) return "ok";
  const items = (enc["EncryptedData"] ?? []) as Array<Record<string, unknown>>;
  if (items.length === 0) return "ok";
  for (const item of items) {
    const method = item["EncryptionMethod"] as Record<string, unknown> | undefined;
    const alg = method?.["@_Algorithm"] as string | undefined;
    if (!alg || !FONT_OBFUSCATION_ALGS.has(alg)) {
      return "drm";
    }
  }
  return "ok";
}

export async function parseEpub(buf: Buffer): Promise<ParsedEpub> {
  if (buf.byteLength === 0) throw new EpubParseError("No file uploaded.");
  if (buf.byteLength > MAX_BYTES) throw new EpubParseError("File too large (limit 50MB).");

  const archive = await openEpubArchive(buf);

  if (archive.has("META-INF/encryption.xml")) {
    const xml = await archive.readText("META-INF/encryption.xml");
    if (checkEncryption(xml) === "drm") {
      throw new EpubParseError("This EPUB is DRM-protected and cannot be imported.");
    }
  }

  const opfPath = await findOpfPath(archive);
  const opfXml = await archive.readText(opfPath);
  const opf = parseOpf(opfXml, opfPath);

  if (opf.spine.length === 0) {
    throw new EpubParseError("This EPUB has no readable content (empty spine).");
  }
  if (opf.spine.length > MAX_CHAPTERS) {
    throw new EpubParseError(
      "This EPUB has more than 200 chapters — please split it before importing."
    );
  }

  const nav = await parseNav(archive, opf);
  const rawChapters = await walkChapters(archive, opf, nav);

  if (rawChapters.length === 0) {
    throw new EpubParseError("No chapters with prose were found in this EPUB.");
  }
  if (rawChapters.length > MAX_CHAPTERS) {
    throw new EpubParseError(
      "This EPUB has more than 200 chapters — please split it before importing."
    );
  }

  const chapters = applyBoilerplateFlags(rawChapters);
  const cover = await extractCover(archive, opf);

  return {
    metadata: opf.metadata,
    cover,
    chapters,
    epubVersion: opf.epubVersion,
  };
}
