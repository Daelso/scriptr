import type { ParsedStory, LorebookEntry } from "@/lib/novelai/types";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

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

  // TODO (next task): decode content.document (msgpack), extract prose.
  return {
    title,
    description,
    tags,
    textPreview,
    contextBlocks,
    lorebookEntries,
    prose: "",
  };
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
