import { describe, it, expect } from "vitest";
import { mapToProposedWrite } from "@/lib/epub/map";
import type { ParsedEpub } from "@/lib/epub/types";
import type { PenNameProfile } from "@/lib/config";

function fakeParsed(over: Partial<ParsedEpub> = {}): ParsedEpub {
  return {
    metadata: {
      title: "Test Book",
      creator: "Jane Author",
      description: "<p>A <em>test</em> book.</p>",
      subjects: ["FIC027010", "  ", "romance"],
      language: "en",
    },
    cover: null,
    chapters: [],
    epubVersion: 3,
    ...over,
  };
}

const profiles: Record<string, PenNameProfile> = {
  "Jane Author": { displayName: "Jane Author" } as unknown as PenNameProfile,
};

describe("mapToProposedWrite — story metadata", () => {
  it("trims title and passes it through", () => {
    const out = mapToProposedWrite(fakeParsed({ metadata: { title: "  Test Book  ", creator: "", description: "", subjects: [], language: "en" } }), {});
    expect(out.story.title).toBe("Test Book");
  });

  it("converts description HTML to markdown via htmlToMarkdown", () => {
    const out = mapToProposedWrite(fakeParsed(), {});
    expect(out.story.description).toBe("A *test* book.");
  });

  it("drops empty keyword entries", () => {
    const out = mapToProposedWrite(fakeParsed(), {});
    expect(out.story.keywords).toEqual(["FIC027010", "romance"]);
  });
});

describe("mapToProposedWrite — pen-name match", () => {
  it("exact match", () => {
    const out = mapToProposedWrite(fakeParsed(), profiles);
    expect(out.story.authorPenName).toBe("Jane Author");
    expect(out.penNameMatch).toBe("exact");
  });

  it("case-insensitive match uses the profile's casing", () => {
    const out = mapToProposedWrite(
      fakeParsed({ metadata: { title: "X", creator: "JANE AUTHOR", description: "", subjects: [], language: "en" } }),
      profiles
    );
    expect(out.story.authorPenName).toBe("Jane Author");
    expect(out.penNameMatch).toBe("case-insensitive");
  });

  it("no match returns empty string + 'none'", () => {
    const out = mapToProposedWrite(
      fakeParsed({ metadata: { title: "X", creator: "Stranger", description: "", subjects: [], language: "en" } }),
      profiles
    );
    expect(out.story.authorPenName).toBe("");
    expect(out.penNameMatch).toBe("none");
  });

  it("empty creator returns empty + 'none' (no spurious match against empty profile key)", () => {
    const out = mapToProposedWrite(
      fakeParsed({ metadata: { title: "X", creator: "", description: "", subjects: [], language: "en" } }),
      profiles
    );
    expect(out.story.authorPenName).toBe("");
    expect(out.penNameMatch).toBe("none");
  });
});

describe("mapToProposedWrite — empty Bible defaults", () => {
  it("returns the documented empty Bible shape", () => {
    const out = mapToProposedWrite(fakeParsed(), {});
    expect(out.bible).toEqual({
      characters: [],
      setting: "",
      pov: "third-limited",
      tone: "",
      styleNotes: "",
      nsfwPreferences: "",
    });
  });
});

describe("mapToProposedWrite — pass-through", () => {
  it("passes cover and chapters through untouched", () => {
    const cover = { mimeType: "image/png", bytes: new Uint8Array([1]) };
    const chapters = [
      { navTitle: "Ch1", body: "x", wordCount: 1, sourceHref: "x.xhtml", skippedByDefault: false, source: "nav" as const },
    ];
    const out = mapToProposedWrite(fakeParsed({ cover, chapters }), {});
    expect(out.cover).toBe(cover);
    expect(out.chapters).toBe(chapters);
  });
});
