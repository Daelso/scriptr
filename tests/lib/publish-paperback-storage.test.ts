import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStory } from "@/lib/storage/stories";
import { writePaperbackExport } from "@/lib/publish/paperback-storage";
import { normalizePaperbackOptions, calculatePaperbackCoverSpec } from "@/lib/publish/paperback-shared";

describe("paperback-storage", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "scriptr-paperback-storage-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes interior HTML and cover spec under exports", async () => {
    const story = await createStory(dir, { title: "Book" });
    const options = normalizePaperbackOptions({ pageCountOverride: 100 });
    const cover = calculatePaperbackCoverSpec(options, 100);

    const written = await writePaperbackExport(dir, story.slug, {
      html: "<!doctype html><html><body>Book</body></html>",
      coverHtml: "<!doctype html><html><body>Cover</body></html>",
      spec: { options, cover, notes: ["n"] },
    });

    expect(written.interiorPath.endsWith(`/exports/${story.slug}-paperback-interior.html`)).toBe(true);
    expect(written.coverPath.endsWith(`/exports/${story.slug}-paperback-cover.html`)).toBe(true);
    expect(written.coverSpecPath.endsWith(`/exports/${story.slug}-paperback-cover-spec.json`)).toBe(true);
    expect((await stat(written.interiorPath)).isFile()).toBe(true);
    expect((await stat(written.coverPath)).isFile()).toBe(true);
    const spec = JSON.parse(await readFile(written.coverSpecPath, "utf-8"));
    expect(spec.cover.pageCount).toBe(100);
  });

  it("writes to outputDir when provided", async () => {
    const story = await createStory(dir, { title: "Book" });
    const out = await mkdtemp(join(tmpdir(), "scriptr-paperback-out-"));
    try {
      const options = normalizePaperbackOptions();
      const cover = calculatePaperbackCoverSpec(options, 24);
      const written = await writePaperbackExport(
        dir,
        story.slug,
        { html: "x", coverHtml: "cover", spec: { options, cover, notes: [] } },
        { outputDir: out },
      );
      expect(written.interiorPath).toBe(join(out, `${story.slug}-paperback-interior.html`));
      expect(written.coverPath).toBe(join(out, `${story.slug}-paperback-cover.html`));
      expect(written.coverSpecPath).toBe(join(out, `${story.slug}-paperback-cover-spec.json`));
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });
});
