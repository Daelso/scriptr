import type { ParsedStory } from "@/lib/novelai/types";

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

  // TODO (next task): decode content.document (msgpack), extract prose.
  // TODO (next task): extract context[], lorebook[].
  return {
    title,
    description,
    tags,
    textPreview,
    contextBlocks: [],
    lorebookEntries: [],
    prose: "",
  };
}
