import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { decodeNovelAIStory } from "@/lib/novelai/decode";
import { splitProseIntoStories } from "@/lib/novelai/split";
import { mapToProposedWrite } from "@/lib/novelai/map";

const FIXTURE = join(
  __dirname,
  "..",
  "..",
  "..",
  "lib",
  "novelai",
  "__fixtures__",
  "sample.story"
);

describe("novelai pipeline smoke", () => {
  it("decodes → splits → maps the fixture into sensible output", async () => {
    const buf = await readFile(FIXTURE);
    const parsed = await decodeNovelAIStory(buf);

    // Prose must not contain the premise echo that the decoder was asked to filter.
    expect(parsed.prose).not.toContain(
      "A short two-chapter synthetic fixture for tests."
    );

    // The `////` in the fixture is a story-split marker → two separate
    // stories, each typically a single chapter.
    const stories = splitProseIntoStories(parsed.prose);
    expect(stories.length).toBeGreaterThanOrEqual(2);
    for (const story of stories) {
      for (const ch of story.chapters) {
        expect(ch.body).not.toContain(
          "A short two-chapter synthetic fixture for tests."
        );
      }
    }

    const write = mapToProposedWrite(parsed);
    expect(write.story.title).toBe("Garden at Dusk");
    expect(write.story.description).toContain("synthetic fixture");
    expect(write.story.keywords).toEqual(["fixture", "test"]);
    expect(write.bible.characters.map((c) => c.name)).toContain("Mira");
    expect(write.bible.setting).toContain("## The Walled Garden");
    expect(write.bible.styleNotes).toContain("Mira: mid-30s");
  });
});
