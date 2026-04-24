import { describe, it, expect } from "vitest";
import { splitProseIntoStories } from "@/lib/novelai/split";

describe("splitProseIntoStories — story-level //// markers", () => {
  it("returns one story when no //// markers are present", () => {
    const r = splitProseIntoStories("Just one block of prose.\n\nTwo paragraphs.");
    expect(r).toHaveLength(1);
    expect(r[0].splitSource).toBe("none");
    expect(r[0].chapters).toHaveLength(1);
    expect(r[0].chapters[0].body).toContain("Just one block");
    expect(r[0].chapters[0].body).toContain("Two paragraphs");
  });

  it("splits on a //// line into two stories", () => {
    const prose = "first story body\n\n////\n\nsecond story body";
    const r = splitProseIntoStories(prose);
    expect(r).toHaveLength(2);
    expect(r[0].chapters[0].body).toBe("first story body");
    expect(r[1].chapters[0].body).toBe("second story body");
  });

  it("consumes the marker line (does not keep it in output)", () => {
    const r = splitProseIntoStories("a\n\n////\n\nb");
    expect(r[0].chapters[0].body).not.toContain("////");
    expect(r[1].chapters[0].body).not.toContain("////");
  });

  it("splits into three stories on multiple //// markers", () => {
    const r = splitProseIntoStories("one\n\n////\n\ntwo\n\n////\n\nthree");
    expect(r).toHaveLength(3);
    expect(r.map((s) => s.chapters[0].body)).toEqual(["one", "two", "three"]);
  });

  it("accepts 5+ slashes too (//////)", () => {
    const r = splitProseIntoStories("a\n\n//////\n\nb");
    expect(r).toHaveLength(2);
  });

  it("drops empty story chunks from leading/trailing markers", () => {
    const r = splitProseIntoStories("////\n\na\n\n////\n\nb\n\n////");
    expect(r).toHaveLength(2);
    expect(r.map((s) => s.chapters[0].body)).toEqual(["a", "b"]);
  });

  it("returns a single empty story if all chunks end up empty", () => {
    const r = splitProseIntoStories("////\n\n////\n\n////");
    expect(r).toHaveLength(1);
    expect(r[0].chapters).toEqual([{ title: "", body: "" }]);
  });

  it("returns a single empty story for empty input", () => {
    const r = splitProseIntoStories("");
    expect(r).toHaveLength(1);
    expect(r[0].chapters).toEqual([{ title: "", body: "" }]);
  });
});

describe("splitProseIntoStories — chapter headings within a story", () => {
  it("splits on 'Chapter N' headings", () => {
    const r = splitProseIntoStories(
      "Chapter 1\n\nfirst\n\nChapter 2\n\nsecond"
    );
    expect(r).toHaveLength(1);
    expect(r[0].splitSource).toBe("heading");
    expect(r[0].chapters).toHaveLength(2);
    expect(r[0].chapters[0].title).toBe("");
    expect(r[0].chapters[0].body).toBe("first");
    expect(r[0].chapters[1].title).toBe("");
    expect(r[0].chapters[1].body).toBe("second");
  });

  it("captures the title after 'Chapter N:'", () => {
    const prose =
      "Chapter 1: The Beginning\n\nopening text\n\nChapter 2: Middle\n\nmore text";
    const r = splitProseIntoStories(prose);
    expect(r[0].chapters[0].title).toBe("The Beginning");
    expect(r[0].chapters[1].title).toBe("Middle");
  });

  it("recognizes roman numerals", () => {
    const r = splitProseIntoStories(
      "Chapter I\n\nfirst\n\nChapter II\n\nsecond"
    );
    expect(r[0].chapters).toHaveLength(2);
  });

  it("is case-insensitive on 'Chapter'", () => {
    const r = splitProseIntoStories(
      "CHAPTER 1\n\nfoo\n\nchapter 2\n\nbar"
    );
    expect(r[0].chapters).toHaveLength(2);
  });

  it("splits on a single 'Chapter N: Title' heading (1+ threshold)", () => {
    const r = splitProseIntoStories("Chapter 1: Alpha\n\nbody of one");
    expect(r[0].splitSource).toBe("heading");
    expect(r[0].chapters).toHaveLength(1);
    expect(r[0].chapters[0].title).toBe("Alpha");
    expect(r[0].chapters[0].body).toBe("body of one");
  });
});

describe("splitProseIntoStories — horizontal rules within a story", () => {
  it("splits on a single *** line as a chapter break (no 3+ threshold)", () => {
    const prose = "a\n\n***\n\nb";
    const r = splitProseIntoStories(prose);
    expect(r).toHaveLength(1);
    expect(r[0].splitSource).toBe("scenebreak-fallback");
    expect(r[0].chapters).toHaveLength(2);
    expect(r[0].chapters.map((c) => c.body)).toEqual(["a", "b"]);
  });

  it("splits on a single --- line as a chapter break", () => {
    const prose = "a\n\n---\n\nb";
    const r = splitProseIntoStories(prose);
    expect(r[0].splitSource).toBe("scenebreak-fallback");
    expect(r[0].chapters).toHaveLength(2);
  });

  it("splits on a single ___ line as a chapter break", () => {
    const prose = "a\n\n___\n\nb";
    const r = splitProseIntoStories(prose);
    expect(r[0].splitSource).toBe("scenebreak-fallback");
    expect(r[0].chapters).toHaveLength(2);
  });

  it("splits on multiple rule lines too", () => {
    const prose = "a\n\n***\n\nb\n\n---\n\nc\n\n___\n\nd";
    const r = splitProseIntoStories(prose);
    expect(r[0].chapters).toHaveLength(4);
    expect(r[0].chapters.map((c) => c.body)).toEqual(["a", "b", "c", "d"]);
  });

  it("also accepts '* * *' spaced rules", () => {
    const prose = "a\n\n* * *\n\nb";
    const r = splitProseIntoStories(prose);
    expect(r[0].chapters).toHaveLength(2);
  });
});

describe("splitProseIntoStories — priority ordering", () => {
  it("stories split first on ////, then chapters within each story", () => {
    const prose =
      "story one intro\n\nChapter 1\n\nfirst\n\nChapter 2\n\nsecond\n\n////\n\nstory two intro\n\n***\n\nstory two part two";
    const r = splitProseIntoStories(prose);
    expect(r).toHaveLength(2);
    // Story 1 uses chapter headings
    expect(r[0].splitSource).toBe("heading");
    expect(r[0].chapters).toHaveLength(3); // "story one intro" + 2 headings
    // Story 2 uses rule fallback
    expect(r[1].splitSource).toBe("scenebreak-fallback");
    expect(r[1].chapters).toHaveLength(2);
  });

  it("Chapter heading beats a horizontal rule within a single story", () => {
    const prose = "Chapter 1\n\nbody one\n\n***\n\nstill body one\n\nChapter 2\n\nbody two";
    const r = splitProseIntoStories(prose);
    expect(r[0].splitSource).toBe("heading");
    expect(r[0].chapters).toHaveLength(2);
    // The *** remains inside the first chapter body (as a scene break).
    expect(r[0].chapters[0].body).toContain("***");
  });
});
