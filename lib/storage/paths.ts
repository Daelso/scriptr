import { join } from "node:path";
import { toSlug } from "@/lib/slug";

export type EpubVersion = 2 | 3;

export function storyDir(dataDir: string, storySlug: string) {
  return join(dataDir, "stories", storySlug);
}
export function storyJson(dataDir: string, storySlug: string) {
  return join(storyDir(dataDir, storySlug), "story.json");
}
export function bibleJson(dataDir: string, storySlug: string) {
  return join(storyDir(dataDir, storySlug), "bible.json");
}
export function chaptersDir(dataDir: string, storySlug: string) {
  return join(storyDir(dataDir, storySlug), "chapters");
}
export function chapterFile(dataDir: string, storySlug: string, index: number, _id: string, title: string) {
  const prefix = String(index + 1).padStart(3, "0");
  return join(chaptersDir(dataDir, storySlug), `${prefix}-${toSlug(title)}.json`);
}
export function exportsDir(dataDir: string, storySlug: string) {
  return join(storyDir(dataDir, storySlug), "exports");
}
export function epubPath(dataDir: string, storySlug: string, version: EpubVersion) {
  return join(exportsDir(dataDir, storySlug), `${storySlug}-epub${version}.epub`);
}
export function coverPath(dataDir: string, storySlug: string) {
  return join(storyDir(dataDir, storySlug), "cover.jpg");
}
export function lastPayloadFile(dataDir: string, storySlug: string) {
  return join(storyDir(dataDir, storySlug), ".last-payload.json");
}
export function logsDir(dataDir: string) {
  return join(dataDir, "logs");
}
export function blockedRequestsLog(dataDir: string) {
  return join(logsDir(dataDir), "blocked-requests.log");
}
export function crashesLog(dataDir: string) {
  return join(logsDir(dataDir), "crashes.log");
}
export function bundlesDir(dataDir: string) {
  return join(dataDir, "bundles");
}
export function bundleDir(dataDir: string, bundleSlug: string) {
  return join(bundlesDir(dataDir), bundleSlug);
}
export function bundleFile(dataDir: string, bundleSlug: string) {
  return join(bundleDir(dataDir, bundleSlug), "bundle.json");
}
export function bundleCoverPath(dataDir: string, bundleSlug: string) {
  return join(bundleDir(dataDir, bundleSlug), "cover.jpg");
}
export function bundleExportsDir(dataDir: string, bundleSlug: string) {
  return join(bundleDir(dataDir, bundleSlug), "exports");
}
export function bundleEpubPath(
  dataDir: string,
  bundleSlug: string,
  version: EpubVersion
) {
  return join(
    bundleExportsDir(dataDir, bundleSlug),
    `${bundleSlug}-epub${version}.epub`
  );
}
