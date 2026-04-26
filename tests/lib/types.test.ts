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
