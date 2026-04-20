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

  it("epubPath returns exports/<slug>.epub", () => {
    expect(epubPath(dataDir, slug)).toBe("/data/stories/my-story/exports/my-story.epub");
  });
});
