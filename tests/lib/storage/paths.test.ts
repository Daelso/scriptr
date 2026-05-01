import { describe, it, expect } from "vitest";
import {
  storyDir,
  storyJson,
  bibleJson,
  chaptersDir,
  chapterFile,
  exportsDir,
  epubPath,
  coverPath,
  lastPayloadFile,
  logsDir,
  blockedRequestsLog,
  crashesLog,
  customEpubPath,
} from "@/lib/storage/paths";

describe("storage paths", () => {
  const dataDir = "/tmp/fakedata";

  it("builds story folder paths", () => {
    expect(storyDir(dataDir, "the-meeting")).toBe("/tmp/fakedata/stories/the-meeting");
  });

  it("builds chapter file with ordinal prefix", () => {
    expect(chapterFile(dataDir, "the-meeting", 0, "ch_abc", "Opening")).toBe(
      "/tmp/fakedata/stories/the-meeting/chapters/001-opening.json"
    );
    expect(chapterFile(dataDir, "the-meeting", 9, "ch_abc", "Ten")).toBe(
      "/tmp/fakedata/stories/the-meeting/chapters/010-ten.json"
    );
  });

  it("caps long EPUB-derived chapter titles to a Windows-safe filename", () => {
    // EPUBs in adult fiction sometimes put a full content-warning paragraph
    // in <h1>; previously this overflowed Windows MAX_PATH (260) and
    // surfaced as ENOENT during import. The basename must stay bounded.
    const warning =
      "All characters depicted in this content are 18 years of age or older. " +
      "Any resemblance to real persons living or dead is purely coincidental. " +
      "Names likenesses and events are entirely fictional and not intended to " +
      "represent or imply any actual persons or events. This book is strictly " +
      "for those 18 and above. It contains graphic scenes of rape and " +
      "bestiality. You have been warned.";
    const path = chapterFile(dataDir, "story", 0, "ch_abc", warning);
    const filename = path.split("/").pop()!;
    // 001- (4) + slug ≤80 + .json (5) = ≤89
    expect(filename.length).toBeLessThanOrEqual(89);
    expect(filename.startsWith("001-")).toBe(true);
    expect(filename.endsWith(".json")).toBe(true);
    // No trailing dash before the extension.
    expect(filename).not.toMatch(/-\.json$/);
  });

  it("exposes the other standard files", () => {
    expect(storyJson(dataDir, "x")).toBe("/tmp/fakedata/stories/x/story.json");
    expect(bibleJson(dataDir, "x")).toBe("/tmp/fakedata/stories/x/bible.json");
    expect(chaptersDir(dataDir, "x")).toBe("/tmp/fakedata/stories/x/chapters");
    expect(exportsDir(dataDir, "x")).toBe("/tmp/fakedata/stories/x/exports");
    expect(coverPath(dataDir, "x")).toBe("/tmp/fakedata/stories/x/cover.jpg");
    expect(lastPayloadFile(dataDir, "x")).toBe("/tmp/fakedata/stories/x/.last-payload.json");
  });

  it("builds the crashes log path under <dataDir>/logs/", () => {
    expect(crashesLog(dataDir)).toBe("/tmp/fakedata/logs/crashes.log");
  });

  it("customEpubPath joins output dir with the slug+version filename", () => {
    expect(customEpubPath("/Users/chase/Books", "the-meeting", 3)).toBe(
      "/Users/chase/Books/the-meeting-epub3.epub",
    );
    expect(customEpubPath("/Users/chase/Books", "the-meeting", 2)).toBe(
      "/Users/chase/Books/the-meeting-epub2.epub",
    );
  });

  it("customEpubPath uses the same filename pattern as epubPath", () => {
    // The two helpers diverge only in their parent dir, never in the filename.
    // This guards against future code switching between override and default
    // and producing a different filename.
    const slugTest = "x";
    expect(customEpubPath("/out", slugTest, 3).split("/").pop())
      .toBe(epubPath(dataDir, slugTest, 3).split("/").pop());
  });
});

describe("paths — logs", () => {
  const DATA = "/data";

  it("logsDir returns <dataDir>/logs", () => {
    expect(logsDir(DATA)).toBe("/data/logs");
  });

  it("blockedRequestsLog returns <dataDir>/logs/blocked-requests.log", () => {
    expect(blockedRequestsLog(DATA)).toBe("/data/logs/blocked-requests.log");
  });
});
