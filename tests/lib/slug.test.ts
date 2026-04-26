import { describe, it, expect } from "vitest";
import { toSlug, uniqueSlug, isValidSlugSegment } from "@/lib/slug";

describe("toSlug", () => {
  it("lowercases and dasherizes", () => {
    expect(toSlug("The Meeting")).toBe("the-meeting");
  });
  it("strips punctuation", () => {
    expect(toSlug("What!? A Story?")).toBe("what-a-story");
  });
  it("collapses whitespace", () => {
    expect(toSlug("  many   spaces  ")).toBe("many-spaces");
  });
  it("handles unicode by stripping it", () => {
    expect(toSlug("café naïve")).toBe("cafe-naive");
  });
  it("returns 'untitled' for empty input", () => {
    expect(toSlug("")).toBe("untitled");
    expect(toSlug("!!!")).toBe("untitled");
  });
});

describe("uniqueSlug", () => {
  it("returns slug unchanged if not taken", () => {
    expect(uniqueSlug("the-meeting", ["other"])).toBe("the-meeting");
  });
  it("appends -2, -3 when collisions exist", () => {
    expect(uniqueSlug("the-meeting", ["the-meeting"])).toBe("the-meeting-2");
    expect(uniqueSlug("the-meeting", ["the-meeting", "the-meeting-2"])).toBe("the-meeting-3");
  });
});

describe("isValidSlugSegment", () => {
  it("accepts canonical lowercase dash-separated slugs", () => {
    expect(isValidSlugSegment("story-a")).toBe(true);
    expect(isValidSlugSegment("story-2")).toBe(true);
    expect(isValidSlugSegment("a")).toBe(true);
  });

  it("rejects traversal and malformed segments", () => {
    expect(isValidSlugSegment("")).toBe(false);
    expect(isValidSlugSegment("../etc")).toBe(false);
    expect(isValidSlugSegment("story/a")).toBe(false);
    expect(isValidSlugSegment("StoryA")).toBe(false);
    expect(isValidSlugSegment("story_a")).toBe(false);
  });
});
