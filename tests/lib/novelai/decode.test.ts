import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { decodeNovelAIStory, NovelAIDecodeError } from "@/lib/novelai/decode";

const FIXTURE_PATH = join(
  __dirname,
  "..",
  "..",
  "..",
  "lib",
  "novelai",
  "__fixtures__",
  "sample.story"
);

describe("decodeNovelAIStory — outer envelope", () => {
  it("rejects non-JSON input", async () => {
    const buf = Buffer.from("this is not json at all");
    await expect(decodeNovelAIStory(buf)).rejects.toBeInstanceOf(NovelAIDecodeError);
    await expect(decodeNovelAIStory(buf)).rejects.toMatchObject({
      userMessage: "File is not a valid NovelAI .story file.",
    });
  });

  it("rejects input over the 10MB size limit", async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1);
    await expect(decodeNovelAIStory(big)).rejects.toMatchObject({
      userMessage: "File too large (limit 10MB).",
    });
  });

  it("rejects wrong storyContainerVersion", async () => {
    const buf = Buffer.from(
      JSON.stringify({ storyContainerVersion: 99, metadata: {}, content: {} })
    );
    await expect(decodeNovelAIStory(buf)).rejects.toMatchObject({
      userMessage:
        "Unsupported NovelAI format version: got 99, expected 1.",
    });
  });

  it("reads metadata from the fixture", async () => {
    const buf = await readFile(FIXTURE_PATH);
    const parsed = await decodeNovelAIStory(buf);
    expect(parsed.title).toBe("Garden at Dusk");
    expect(parsed.description).toBe(
      "A short two-chapter synthetic fixture for tests."
    );
    expect(parsed.tags).toEqual(["fixture", "test"]);
  });
});

describe("decodeNovelAIStory — context and lorebook", () => {
  it("extracts context blocks from the fixture", async () => {
    const buf = await readFile(FIXTURE_PATH);
    const parsed = await decodeNovelAIStory(buf);
    expect(parsed.contextBlocks).toHaveLength(2);
    expect(parsed.contextBlocks[0]).toContain("Mira: mid-30s");
    expect(parsed.contextBlocks[1]).toContain("spare, image-forward");
  });

  it("extracts lorebook entries from the fixture", async () => {
    const buf = await readFile(FIXTURE_PATH);
    const parsed = await decodeNovelAIStory(buf);
    expect(parsed.lorebookEntries).toHaveLength(2);
    expect(parsed.lorebookEntries[0]).toMatchObject({
      displayName: "Mira",
      category: "character",
    });
    expect(parsed.lorebookEntries[0].text).toContain("gardener");
    expect(parsed.lorebookEntries[0].keys).toEqual(["Mira"]);

    expect(parsed.lorebookEntries[1]).toMatchObject({
      displayName: "The Walled Garden",
      category: "location",
    });
    expect(parsed.lorebookEntries[1].keys).toEqual(["garden", "walled garden"]);
  });

  it("handles missing context/lorebook gracefully", async () => {
    const minimal = Buffer.from(
      JSON.stringify({
        storyContainerVersion: 1,
        metadata: { title: "X" },
        content: {},
      })
    );
    const parsed = await decodeNovelAIStory(minimal);
    expect(parsed.contextBlocks).toEqual([]);
    expect(parsed.lorebookEntries).toEqual([]);
  });
});

describe("decodeNovelAIStory — prose extraction", () => {
  it("extracts long prose segments from the fixture", async () => {
    const buf = await readFile(FIXTURE_PATH);
    const parsed = await decodeNovelAIStory(buf);
    expect(parsed.prose).toContain("The garden at dusk");
    expect(parsed.prose).toContain("Chapter 2: Morning");
  });

  it("filters out strings that duplicate metadata.description", async () => {
    const buf = await readFile(FIXTURE_PATH);
    const parsed = await decodeNovelAIStory(buf);
    // The fixture stuffs "A short two-chapter synthetic fixture for tests."
    // into the CRDT as a long dict key. Decoder must drop it because it
    // exactly matches metadata.description.
    expect(parsed.prose).not.toContain(
      "A short two-chapter synthetic fixture for tests."
    );
  });

  it("preserves paragraph breaks within prose segments", async () => {
    const buf = await readFile(FIXTURE_PATH);
    const parsed = await decodeNovelAIStory(buf);
    // Chapter 1 in the fixture has an internal paragraph break ("\n\n").
    expect(parsed.prose).toMatch(/silver[^]*\n\n[^]*She set her mug/);
  });

  it("throws a user-friendly error when base64/msgpack decode fails", async () => {
    const corrupt = Buffer.from(
      JSON.stringify({
        storyContainerVersion: 1,
        metadata: { title: "X" },
        content: { document: "not-actually-valid-base64-msgpack-bytes" },
      })
    );
    await expect(decodeNovelAIStory(corrupt)).rejects.toMatchObject({
      userMessage: "Could not read the document inside this .story file.",
    });
  });

  it("throws 'no AI prose' when the document has no long strings", async () => {
    const { encode } = await import("@msgpack/msgpack");
    // A valid msgpack document with no strings ≥ MIN_PROSE_LEN.
    const m = new Map();
    m.set(1, "short"); // below threshold
    m.set(2, 42);
    const doc = Buffer.from(encode(m)).toString("base64");
    const env = Buffer.from(
      JSON.stringify({
        storyContainerVersion: 1,
        metadata: { title: "X" },
        content: { document: doc },
      })
    );
    await expect(decodeNovelAIStory(env)).rejects.toMatchObject({
      userMessage:
        "No AI-generated prose found — did you import before running any AI turns?",
    });
  });
});
