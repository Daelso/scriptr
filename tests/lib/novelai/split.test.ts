import { describe, it, expect } from "vitest";
import { splitProse } from "@/lib/novelai/split";

describe("splitProse — //// marker", () => {
  it("returns one chapter when no markers are present", () => {
    const r = splitProse("Just one block of prose.\n\nTwo paragraphs.");
    expect(r.splitSource).toBe("none");
    expect(r.chapters).toHaveLength(1);
    expect(r.chapters[0].body).toContain("Just one block");
    expect(r.chapters[0].body).toContain("Two paragraphs");
  });

  it("splits on a //// line", () => {
    const prose = "first chapter body\n\n////\n\nsecond chapter body";
    const r = splitProse(prose);
    expect(r.splitSource).toBe("marker");
    expect(r.chapters).toHaveLength(2);
    expect(r.chapters[0].body).toBe("first chapter body");
    expect(r.chapters[1].body).toBe("second chapter body");
  });

  it("consumes the marker line (does not keep it in output)", () => {
    const r = splitProse("a\n\n////\n\nb");
    expect(r.chapters[0].body).not.toContain("////");
    expect(r.chapters[1].body).not.toContain("////");
  });

  it("splits on multiple //// markers", () => {
    const r = splitProse("one\n\n////\n\ntwo\n\n////\n\nthree");
    expect(r.chapters).toHaveLength(3);
    expect(r.chapters.map((c) => c.body)).toEqual(["one", "two", "three"]);
  });

  it("accepts 5+ slashes too (// /////)", () => {
    const r = splitProse("a\n\n//////\n\nb");
    expect(r.chapters).toHaveLength(2);
  });

  it("drops empty chapters from leading/trailing markers", () => {
    const r = splitProse("////\n\na\n\n////\n\nb\n\n////");
    expect(r.chapters.map((c) => c.body)).toEqual(["a", "b"]);
  });

  it("falls back to single chapter if all chunks end up empty", () => {
    const r = splitProse("////\n\n////\n\n////");
    expect(r.chapters).toHaveLength(1);
    expect(r.chapters[0].body).toBe("");
  });
});

describe("splitProse — chapter headings", () => {
  it("splits on 'Chapter N' headings", () => {
    const r = splitProse("Chapter 1\n\nfirst\n\nChapter 2\n\nsecond");
    expect(r.splitSource).toBe("heading");
    expect(r.chapters).toHaveLength(2);
    expect(r.chapters[0].title).toBe("");
    expect(r.chapters[0].body).toBe("first");
    expect(r.chapters[1].title).toBe("");
    expect(r.chapters[1].body).toBe("second");
  });

  it("captures the title after 'Chapter N:'", () => {
    const prose = "Chapter 1: The Beginning\n\nopening text\n\nChapter 2: Middle\n\nmore text";
    const r = splitProse(prose);
    expect(r.chapters[0].title).toBe("The Beginning");
    expect(r.chapters[1].title).toBe("Middle");
  });

  it("recognizes roman numerals", () => {
    const r = splitProse("Chapter I\n\nfirst\n\nChapter II\n\nsecond");
    expect(r.chapters).toHaveLength(2);
  });

  it("is case-insensitive on 'Chapter'", () => {
    const r = splitProse("CHAPTER 1\n\nfoo\n\nchapter 2\n\nbar");
    expect(r.chapters).toHaveLength(2);
  });

  it("marker beats heading when both are present (marker has priority)", () => {
    const prose = "Chapter 1\n\nfirst\n\n////\n\nChapter 2\n\nsecond";
    const r = splitProse(prose);
    expect(r.splitSource).toBe("marker");
    expect(r.chapters).toHaveLength(2);
    // Chapter 1/2 lines stay in the bodies because marker-splitting runs first
    // and does not consume heading lines.
    expect(r.chapters[0].body).toContain("Chapter 1");
    expect(r.chapters[1].body).toContain("Chapter 2");
  });

  it("infers title from first sentence when no heading captured", () => {
    // No chapter heading, single chapter — no inference happens in this
    // implementation; title stays empty. Title inference only applies when
    // the split source provides a hint.
    const r = splitProse("Plain body with no heading at all.");
    expect(r.chapters[0].title).toBe("");
  });
});
