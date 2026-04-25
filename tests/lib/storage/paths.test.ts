import { describe, it, expect } from "vitest";
import {
  storyDir,
  storyJson,
  bibleJson,
  chaptersDir,
  chapterFile,
  exportsDir,
  coverPath,
  lastPayloadFile,
  logsDir,
  blockedRequestsLog,
  crashesLog,
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
