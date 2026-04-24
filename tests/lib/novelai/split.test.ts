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
