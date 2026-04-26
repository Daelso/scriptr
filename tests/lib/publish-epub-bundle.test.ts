import { describe, it, expect } from "vitest";
import { buildBundleEpubBytes } from "@/lib/publish/epub-bundle";
import { readOpfVersion } from "./helpers/epub-inspect";
import JSZip from "jszip";
import type { Bundle, Story, Chapter } from "@/lib/types";

function story(slug: string, title: string, description = ""): Story {
  return {
    slug,
    title,
    authorPenName: "Pen",
    description,
    copyrightYear: 2026,
    language: "en",
    bisacCategory: "FIC027000",
    keywords: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    chapterOrder: [],
  };
}

function chapter(id: string, title: string, body = "Some content."): Chapter {
  return {
    id,
    title,
    summary: "",
    beats: [],
    prompt: "",
    recap: "",
    sections: [{ id: `${id}-s1`, content: body }],
    wordCount: 2,
  };
}

function bundle(refs: Bundle["stories"]): Bundle {
  return {
    slug: "omnibus",
    title: "Omnibus",
    authorPenName: "Pen",
    description: "Three short stories.",
    language: "en",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    stories: refs,
  };
}

async function countChapters(bytes: Uint8Array): Promise<number> {
  const zip = await JSZip.loadAsync(bytes);
  return Object.keys(zip.files).filter((n) => /^OEBPS\/.*\.xhtml$/i.test(n)).length;
}

async function readAllText(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const xhtmlNames = Object.keys(zip.files).filter((n) =>
    /^OEBPS\/.*\.xhtml$/i.test(n)
  );
  const parts: string[] = [];
  for (const name of xhtmlNames) {
    parts.push(await zip.file(name)!.async("string"));
  }
  return parts.join("\n");
}

describe("buildBundleEpubBytes", () => {
  it("builds a valid EPUB (zip-magic prefix, OPF version 3 by default)", async () => {
    const stories = new Map([
      ["story-a", { story: story("story-a", "Story A"), chapters: [chapter("c1", "Ch 1")] }],
    ]);
    const bytes = await buildBundleEpubBytes({
      bundle: bundle([{ storySlug: "story-a" }]),
      stories,
    });
    expect(bytes.byteLength).toBeGreaterThan(500);
    const b = Buffer.from(bytes);
    expect(b[0]).toBe(0x50);
    expect(b[1]).toBe(0x4b);
    expect(await readOpfVersion(bytes)).toBe("3.0");
  });

  it("supports version 2", async () => {
    const stories = new Map([
      ["story-a", { story: story("story-a", "Story A"), chapters: [chapter("c1", "Ch 1")] }],
    ]);
    const bytes = await buildBundleEpubBytes({
      bundle: bundle([{ storySlug: "story-a" }]),
      stories,
      version: 2,
    });
    expect(await readOpfVersion(bytes)).toBe("2.0");
  });

  it("emits N title pages + Σ chapters total xhtml entries (plus library boilerplate)", async () => {
    const stories = new Map([
      [
        "story-a",
        {
          story: story("story-a", "Story A"),
          chapters: [chapter("a1", "A1"), chapter("a2", "A2")],
        },
      ],
      ["story-b", { story: story("story-b", "Story B"), chapters: [chapter("b1", "B1")] }],
    ]);
    const bytes = await buildBundleEpubBytes({
      bundle: bundle([{ storySlug: "story-a" }, { storySlug: "story-b" }]),
      stories,
    });
    expect(await countChapters(bytes)).toBeGreaterThanOrEqual(5);
  });

  it("uses titleOverride and descriptionOverride on the title page", async () => {
    const stories = new Map([
      ["story-a", { story: story("story-a", "Original Title", "Original blurb"), chapters: [chapter("c1", "X")] }],
    ]);
    const bytes = await buildBundleEpubBytes({
      bundle: bundle([
        {
          storySlug: "story-a",
          titleOverride: "Bundle Title",
          descriptionOverride: "Bundle blurb.",
        },
      ]),
      stories,
    });
    const text = await readAllText(bytes);
    expect(text).toContain("Bundle Title");
    expect(text).toContain("Bundle blurb.");
    expect(text).not.toContain("Original Title");
    expect(text).not.toContain("Original blurb");
  });

  it("falls back to source story title/description when overrides are absent", async () => {
    const stories = new Map([
      ["story-a", { story: story("story-a", "Source Title", "Source blurb."), chapters: [chapter("c1", "X")] }],
    ]);
    const bytes = await buildBundleEpubBytes({
      bundle: bundle([{ storySlug: "story-a" }]),
      stories,
    });
    const text = await readAllText(bytes);
    expect(text).toContain("Source Title");
    expect(text).toContain("Source blurb.");
  });

  it("omits the description block when source has empty description and no override", async () => {
    const stories = new Map([
      ["story-a", { story: story("story-a", "Naked Title", ""), chapters: [chapter("c1", "X")] }],
    ]);
    const bytes = await buildBundleEpubBytes({
      bundle: bundle([{ storySlug: "story-a" }]),
      stories,
    });
    const text = await readAllText(bytes);
    expect(text).toContain("Naked Title");
    const titlePageMatch = text.match(
      /<div[^>]*class="story-title-page"[^>]*>([\s\S]*?)<\/div>/
    );
    expect(titlePageMatch).not.toBeNull();
    expect(titlePageMatch![1]).not.toMatch(/<p>\s*<\/p>/);
  });

  it("missing-ref refs are silently dropped (caller is responsible for warning); build still succeeds", async () => {
    const stories = new Map([
      ["story-a", { story: story("story-a", "Real"), chapters: [chapter("c1", "x")] }],
    ]);
    const bytes = await buildBundleEpubBytes({
      bundle: bundle([
        { storySlug: "story-a" },
        { storySlug: "missing-story" },
      ]),
      stories,
    });
    expect(bytes.byteLength).toBeGreaterThan(500);
    const text = await readAllText(bytes);
    expect(text).toContain("Real");
    expect(text).not.toContain("missing-story");
  });

  it("handles missing coverPath without crashing", async () => {
    const stories = new Map([
      ["story-a", { story: story("story-a", "X"), chapters: [chapter("c1", "y")] }],
    ]);
    const bytes = await buildBundleEpubBytes({
      bundle: bundle([{ storySlug: "story-a" }]),
      stories,
      coverPath: undefined,
    });
    expect(bytes.byteLength).toBeGreaterThan(500);
  });

  it("appends a single author-note entry at the end when authorNote is provided", async () => {
    const stories = new Map([
      ["story-a", { story: story("story-a", "Story A"), chapters: [chapter("c1", "Ch 1")] }],
      ["story-b", { story: story("story-b", "Story B"), chapters: [chapter("c2", "Ch 2")] }],
    ]);
    const bytes = await buildBundleEpubBytes({
      bundle: bundle([{ storySlug: "story-a" }, { storySlug: "story-b" }]),
      stories,
      authorNote: {
        messageHtml: "<p>Thanks for reading this collection.</p>",
        email: "author@example.com",
      },
    });
    const text = await readAllText(bytes);
    expect(text).toContain("A note from the author");
    expect(text).toContain("Thanks for reading this collection.");
    const matches = text.match(/A note from the author/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("omits the author-note entry when authorNote is undefined", async () => {
    const stories = new Map([
      ["story-a", { story: story("story-a", "Story A"), chapters: [chapter("c1", "Ch 1")] }],
    ]);
    const bytes = await buildBundleEpubBytes({
      bundle: bundle([{ storySlug: "story-a" }]),
      stories,
    });
    const text = await readAllText(bytes);
    expect(text).not.toContain("A note from the author");
  });
});
