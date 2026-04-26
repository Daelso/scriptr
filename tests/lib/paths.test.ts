import { describe, it, expect } from "vitest";
import { coverPath, exportsDir, epubPath, bundlesDir, bundleDir, bundleFile, bundleCoverPath, bundleExportsDir, bundleEpubPath } from "@/lib/storage/paths";

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

describe("bundle path helpers", () => {
  const dataDir = "/data";

  it("bundlesDir returns <dataDir>/bundles", () => {
    expect(bundlesDir(dataDir)).toBe("/data/bundles");
  });

  it("bundleDir returns <dataDir>/bundles/<slug>", () => {
    expect(bundleDir(dataDir, "omnibus")).toBe("/data/bundles/omnibus");
  });

  it("bundleFile returns <dataDir>/bundles/<slug>/bundle.json", () => {
    expect(bundleFile(dataDir, "omnibus")).toBe("/data/bundles/omnibus/bundle.json");
  });

  it("bundleCoverPath returns <dataDir>/bundles/<slug>/cover.jpg", () => {
    expect(bundleCoverPath(dataDir, "omnibus")).toBe("/data/bundles/omnibus/cover.jpg");
  });

  it("bundleExportsDir returns <dataDir>/bundles/<slug>/exports", () => {
    expect(bundleExportsDir(dataDir, "omnibus")).toBe("/data/bundles/omnibus/exports");
  });

  it("bundleEpubPath returns versioned path under exports/", () => {
    expect(bundleEpubPath(dataDir, "omnibus", 3)).toBe(
      "/data/bundles/omnibus/exports/omnibus-epub3.epub"
    );
    expect(bundleEpubPath(dataDir, "omnibus", 2)).toBe(
      "/data/bundles/omnibus/exports/omnibus-epub2.epub"
    );
  });
});
