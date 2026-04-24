import { Decoder } from "@msgpack/msgpack";
import type { ParsedStory, LorebookEntry } from "@/lib/novelai/types";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const MIN_PROSE_LEN = 60;

export class NovelAIDecodeError extends Error {
  userMessage: string;
  constructor(userMessage: string) {
    super(userMessage);
    this.name = "NovelAIDecodeError";
    this.userMessage = userMessage;
  }
}

type RawEnvelope = {
  storyContainerVersion?: unknown;
  metadata?: {
    title?: unknown;
    description?: unknown;
    textPreview?: unknown;
    tags?: unknown;
  };
  content?: {
    document?: unknown;
    context?: unknown;
    lorebook?: unknown;
  };
};

export async function decodeNovelAIStory(buf: Buffer): Promise<ParsedStory> {
  if (buf.byteLength > MAX_BYTES) {
    throw new NovelAIDecodeError("File too large (limit 10MB).");
  }

  let env: RawEnvelope;
  try {
    env = JSON.parse(buf.toString("utf-8")) as RawEnvelope;
  } catch {
    throw new NovelAIDecodeError("File is not a valid NovelAI .story file.");
  }

  if (env.storyContainerVersion !== 1) {
    const got =
      typeof env.storyContainerVersion === "number" ||
      typeof env.storyContainerVersion === "string"
        ? env.storyContainerVersion
        : "unknown";
    throw new NovelAIDecodeError(
      `Unsupported NovelAI format version: got ${got}, expected 1.`
    );
  }

  const md = env.metadata ?? {};
  const title = typeof md.title === "string" ? md.title : "";
  const description = typeof md.description === "string" ? md.description : "";
  const textPreview = typeof md.textPreview === "string" ? md.textPreview : "";
  const tags = Array.isArray(md.tags)
    ? md.tags.filter((t): t is string => typeof t === "string")
    : [];

  const contextBlocks = extractContextBlocks(env.content?.context);
  const lorebookEntries = extractLorebookEntries(env.content?.lorebook);

  const filterSet = buildFilterSet(description, textPreview, contextBlocks, lorebookEntries);
  const docField = env.content?.document;
  const prose = extractProse(docField, filterSet);
  if (!prose && typeof docField === "string" && docField.length > 0) {
    throw new NovelAIDecodeError(
      "No AI-generated prose found — did you import before running any AI turns?"
    );
  }

  return {
    title,
    description,
    tags,
    textPreview,
    contextBlocks,
    lorebookEntries,
    prose,
  };
}

function buildFilterSet(
  description: string,
  textPreview: string,
  contextBlocks: string[],
  lorebookEntries: LorebookEntry[]
): Set<string> {
  const set = new Set<string>();
  const add = (s: string | undefined) => {
    if (!s) return;
    const t = s.trim();
    if (t) set.add(t);
  };
  add(description);
  add(textPreview);
  for (const c of contextBlocks) add(c);
  for (const e of lorebookEntries) add(e.text);
  return set;
}

// Permissive map-key converter for real NovelAI files: their CRDT maps can
// have non-string/number keys (arrays, ext types). The default converter
// throws on those, so we stringify anything unusual. Only the VALUES matter
// for prose extraction — keys are walked-through but we never interpret them.
function permissiveMapKey(k: unknown): string | number {
  if (typeof k === "string") return k;
  if (typeof k === "number") return k;
  try {
    return JSON.stringify(k);
  } catch {
    return String(k);
  }
}

function extractProse(doc: unknown, filter: Set<string>): string {
  if (typeof doc !== "string" || doc.length === 0) return "";

  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(Buffer.from(doc, "base64"));
  } catch {
    throw new NovelAIDecodeError(
      "Could not read the document inside this .story file."
    );
  }
  if (bytes.byteLength === 0) {
    throw new NovelAIDecodeError(
      "Could not read the document inside this .story file."
    );
  }

  let objects: unknown[];
  try {
    const decoder = new Decoder({ mapKeyConverter: permissiveMapKey });
    objects = [...decoder.decodeMulti(bytes)];
  } catch {
    throw new NovelAIDecodeError(
      "Could not read the document inside this .story file."
    );
  }

  // Walk every top-level object depth-first, collecting every string of
  // length >= MIN_PROSE_LEN (whether it appears as a value or as a dict
  // key). Dedup while preserving order of first encounter.
  const seen = new Set<string>();
  const segments: string[] = [];

  const visit = (node: unknown): void => {
    if (typeof node === "string") {
      const trimmed = node.trim();
      if (
        trimmed.length >= MIN_PROSE_LEN &&
        !seen.has(trimmed) &&
        !filter.has(trimmed)
      ) {
        seen.add(trimmed);
        segments.push(trimmed);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const v of node) visit(v);
      return;
    }
    // v3.1.3 of @msgpack/msgpack never returns Map, but keep this branch as
    // defensive future-proofing in case that changes or a custom codec is added.
    if (node instanceof Map) {
      for (const [k, v] of node) {
        visit(k);
        visit(v);
      }
      return;
    }
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        visit(k);
        visit(v);
      }
    }
    // primitives (number, boolean, null, undefined, ext-tagged opaque objects) — skip
  };

  for (const obj of objects) visit(obj);

  return segments.join("\n\n");
}

function extractContextBlocks(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string") {
      const t = (item as { text: string }).text.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

function extractLorebookEntries(raw: unknown): LorebookEntry[] {
  if (!raw || typeof raw !== "object") return [];
  const entries = (raw as { entries?: unknown }).entries;
  const categories = (raw as { categories?: unknown }).categories;

  // Build a categoryId → categoryName lookup from lorebook.categories if present.
  // Real NovelAI files typically keep category *names* on each entry already,
  // but some older formats use category ids. We defensively handle both.
  const catNames: Map<string, string> = new Map();
  if (Array.isArray(categories)) {
    for (const c of categories) {
      if (c && typeof c === "object") {
        const cat = c as { id?: unknown; name?: unknown };
        if (typeof cat.id === "string" && typeof cat.name === "string") {
          catNames.set(cat.id, cat.name);
        }
      }
    }
  }

  if (!Array.isArray(entries)) return [];
  const out: LorebookEntry[] = [];
  for (const e of entries) {
    if (!e || typeof e !== "object") continue;
    const entry = e as {
      displayName?: unknown;
      text?: unknown;
      keys?: unknown;
      category?: unknown;
    };
    const displayName =
      typeof entry.displayName === "string" ? entry.displayName : "";
    const text = typeof entry.text === "string" ? entry.text : "";
    const keys = Array.isArray(entry.keys)
      ? entry.keys.filter((k): k is string => typeof k === "string")
      : [];
    let category: string | undefined;
    if (typeof entry.category === "string") {
      category = catNames.get(entry.category) ?? entry.category;
    }
    // Drop entries with no name/keys AND no text — nothing to import.
    if (!displayName && keys.length === 0 && !text) continue;
    out.push({ displayName, text, keys, category });
  }
  return out;
}
