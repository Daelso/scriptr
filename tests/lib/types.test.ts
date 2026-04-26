import { describe, it, expect } from "vitest";
import type { Chapter, Story } from "@/lib/types";

describe("Chapter.source", () => {
  it("accepts 'imported' and 'generated' and undefined", () => {
    const a: Pick<Chapter, "source"> = { source: "imported" };
    const b: Pick<Chapter, "source"> = { source: "generated" };
    const c: Pick<Chapter, "source"> = {};
    expect(a.source).toBe("imported");
    expect(b.source).toBe("generated");
    expect(c.source).toBeUndefined();
  });
});

describe("Story.authorNote", () => {
  it("Story.authorNote is an optional shape with enabled + optional messageHtml", () => {
    const story: Story = {
      slug: "x", title: "x", authorPenName: "x", description: "",
      copyrightYear: 2026, language: "en", bisacCategory: "FIC027000",
      keywords: [], createdAt: "", updatedAt: "", chapterOrder: [],
      authorNote: { enabled: true, messageHtml: "<p>hi</p>" },
    };
    expect(story.authorNote?.enabled).toBe(true);

    const without: Story = {
      slug: "y", title: "y", authorPenName: "y", description: "",
      copyrightYear: 2026, language: "en", bisacCategory: "FIC027000",
      keywords: [], createdAt: "", updatedAt: "", chapterOrder: [],
    };
    expect(without.authorNote).toBeUndefined();
  });
});

import type { Bundle, BundleStoryRef, BundleSummary } from "@/lib/types";

describe("Bundle types", () => {
  it("Bundle has required fields and ordered stories array", () => {
    const b: Bundle = {
      slug: "omnibus",
      title: "Omnibus",
      authorPenName: "Pen",
      description: "Three short stories.",
      language: "en",
      createdAt: "2026-04-25T00:00:00.000Z",
      updatedAt: "2026-04-25T00:00:00.000Z",
      stories: [{ storySlug: "story-a" }],
    };
    expect(b.stories).toHaveLength(1);
  });

  it("BundleStoryRef supports optional title and description overrides", () => {
    const ref: BundleStoryRef = {
      storySlug: "story-b",
      titleOverride: "Book Two: Story B",
      descriptionOverride: "A new blurb for the bundle context.",
    };
    expect(ref.titleOverride).toBe("Book Two: Story B");
    expect(ref.descriptionOverride).toContain("blurb");
  });

  it("BundleSummary has slug, title, storyCount, updatedAt", () => {
    const s: BundleSummary = {
      slug: "omnibus",
      title: "Omnibus",
      storyCount: 3,
      updatedAt: "2026-04-25T00:00:00.000Z",
    };
    expect(s.storyCount).toBe(3);
  });
});
