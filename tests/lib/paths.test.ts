import { describe, it, expect } from "vitest";
import { coverPath, exportsDir, epubPath } from "@/lib/storage/paths";

describe("publishing paths", () => {
  const dataDir = "/data";
  const slug = "my-story";

  it("coverPath (existing helper) returns the cover.jpg path under the story dir", () => {
    expect(coverPath(dataDir, slug)).toBe("/data/stories/my-story/cover.jpg");
  });

  it("exportsDir (existing helper) returns the exports subdir", () => {
    expect(exportsDir(dataDir, slug)).toBe("/data/stories/my-story/exports");
  });

  it("epubPath with version 3 returns exports/<slug>-epub3.epub", () => {
    expect(epubPath(dataDir, slug, 3)).toBe("/data/stories/my-story/exports/my-story-epub3.epub");
  });

  it("epubPath with version 2 returns exports/<slug>-epub2.epub", () => {
    expect(epubPath(dataDir, slug, 2)).toBe("/data/stories/my-story/exports/my-story-epub2.epub");
  });

  it("epubPath version 2 and version 3 produce distinct paths", () => {
    expect(epubPath(dataDir, slug, 2)).not.toBe(epubPath(dataDir, slug, 3));
  });
});
