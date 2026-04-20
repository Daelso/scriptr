import { join } from "node:path";
import { toSlug } from "@/lib/slug";

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
export function epubPath(dataDir: string, storySlug: string) {
  return join(exportsDir(dataDir, storySlug), `${storySlug}.epub`);
}
export function coverPath(dataDir: string, storySlug: string) {
  return join(storyDir(dataDir, storySlug), "cover.jpg");
}
export function lastPayloadFile(dataDir: string, storySlug: string) {
  return join(storyDir(dataDir, storySlug), ".last-payload.json");
}
