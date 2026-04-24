import { describe, it, expect } from "vitest";
import { mapToProposedWrite } from "@/lib/novelai/map";
import type { ParsedStory } from "@/lib/novelai/types";

function make(partial: Partial<ParsedStory>): ParsedStory {
  return {
    title: partial.title ?? "T",
    description: partial.description ?? "",
    tags: partial.tags ?? [],
    textPreview: partial.textPreview ?? "",
    contextBlocks: partial.contextBlocks ?? [],
    lorebookEntries: partial.lorebookEntries ?? [],
    prose: partial.prose ?? "",
  };
}

describe("mapToProposedWrite — story-level fields", () => {
  it("prefers description over textPreview for story.description", () => {
    const w = mapToProposedWrite(
      make({ description: "real desc", textPreview: "preview" })
    );
    expect(w.story.description).toBe("real desc");
  });

  it("falls back to textPreview when description is empty", () => {
    const w = mapToProposedWrite(
      make({ description: "", textPreview: "preview text" })
    );
    expect(w.story.description).toBe("preview text");
  });

  it("passes title and tags through", () => {
    const w = mapToProposedWrite(
      make({ title: "My Book", tags: ["a", "b"] })
    );
    expect(w.story.title).toBe("My Book");
    expect(w.story.keywords).toEqual(["a", "b"]);
  });
});

describe("mapToProposedWrite — lorebook classification", () => {
  it("category person/character/people → characters", () => {
    const w = mapToProposedWrite(
      make({
        lorebookEntries: [
          { displayName: "Alice", text: "a woman", keys: [], category: "character" },
          { displayName: "Bob", text: "a man", keys: [], category: "Person" },
          { displayName: "Club", text: "the club", keys: [], category: "People" },
        ],
      })
    );
    expect(w.bible.characters.map((c) => c.name)).toEqual(["Alice", "Bob", "Club"]);
  });

  it("category place/location/setting → setting string", () => {
    const w = mapToProposedWrite(
      make({
        lorebookEntries: [
          { displayName: "Town", text: "a small town", keys: [], category: "location" },
          { displayName: "Castle", text: "stone walls", keys: [], category: "Place" },
        ],
      })
    );
    expect(w.bible.setting).toContain("## Town");
    expect(w.bible.setting).toContain("a small town");
    expect(w.bible.setting).toContain("## Castle");
    expect(w.bible.characters).toHaveLength(0);
  });

  it("no category + pronouns in text → character", () => {
    const w = mapToProposedWrite(
      make({
        lorebookEntries: [
          { displayName: "Mira", text: "She notices the garden and its plants.", keys: [] },
        ],
      })
    );
    expect(w.bible.characters.map((c) => c.name)).toEqual(["Mira"]);
  });

  it("no category + location cues → place", () => {
    const w = mapToProposedWrite(
      make({
        lorebookEntries: [
          { displayName: "Garden", text: "The garden is a city green space.", keys: [] },
        ],
      })
    );
    expect(w.bible.setting).toContain("## Garden");
  });

  it("no category + ambiguous text → character (default)", () => {
    const w = mapToProposedWrite(
      make({
        lorebookEntries: [
          { displayName: "Widget", text: "Just a noun.", keys: [] },
        ],
      })
    );
    expect(w.bible.characters.map((c) => c.name)).toEqual(["Widget"]);
  });

  it("uses first key when displayName is empty", () => {
    const w = mapToProposedWrite(
      make({
        lorebookEntries: [
          { displayName: "", text: "a person", keys: ["fallback-name", "other"] },
        ],
      })
    );
    expect(w.bible.characters[0].name).toBe("fallback-name");
  });

  it("empty lorebook → empty characters and setting", () => {
    const w = mapToProposedWrite(make({ lorebookEntries: [] }));
    expect(w.bible.characters).toEqual([]);
    expect(w.bible.setting).toBe("");
  });
});

describe("mapToProposedWrite — context blocks", () => {
  it("joins context with separator into styleNotes", () => {
    const w = mapToProposedWrite(
      make({ contextBlocks: ["Memory line", "Author's note line"] })
    );
    expect(w.bible.styleNotes).toBe("Memory line\n\n---\n\nAuthor's note line");
  });

  it("empty context → empty styleNotes", () => {
    const w = mapToProposedWrite(make({ contextBlocks: [] }));
    expect(w.bible.styleNotes).toBe("");
  });
});

describe("mapToProposedWrite — defaults", () => {
  it("sets pov/tone/nsfwPreferences to safe defaults", () => {
    const w = mapToProposedWrite(make({}));
    expect(w.bible.pov).toBe("third-limited");
    expect(w.bible.tone).toBe("");
    expect(w.bible.nsfwPreferences).toBe("");
    expect(w.bible.styleOverrides).toBeUndefined();
  });
});
