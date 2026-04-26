import { describe, it, expect } from "vitest";
import { mkdtemp, rm, access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createBundle,
  listBundles,
  getBundle,
  updateBundle,
  deleteBundle,
} from "@/lib/storage/bundles";
import { bundleDir } from "@/lib/storage/paths";

async function withTemp(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "scriptr-bundles-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("createBundle", () => {
  it("writes bundle.json with the expected shape and creates exports/", async () => {
    await withTemp(async (dir) => {
      const bundle = await createBundle(dir, { title: "Box Set" });

      const bundlePath = join(dir, "bundles", bundle.slug, "bundle.json");
      const exportsPath = join(dir, "bundles", bundle.slug, "exports");
      await expect(access(bundlePath)).resolves.toBeUndefined();
      await expect(access(exportsPath)).resolves.toBeUndefined();

      const data = JSON.parse(await readFile(bundlePath, "utf-8"));
      expect(data.slug).toBe("box-set");
      expect(data.title).toBe("Box Set");
      expect(data.authorPenName).toBe("");
      expect(data.description).toBe("");
      expect(data.language).toBe("en");
      expect(data.stories).toEqual([]);
      expect(data.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(data.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  it("slug collision yields unique slug", async () => {
    await withTemp(async (dir) => {
      const a = await createBundle(dir, { title: "Collection" });
      const b = await createBundle(dir, { title: "Collection" });
      expect(a.slug).toBe("collection");
      expect(b.slug).toBe("collection-2");
    });
  });
});

describe("listBundles", () => {
  it("returns empty array when bundles dir does not exist", async () => {
    await withTemp(async (dir) => {
      expect(await listBundles(dir)).toEqual([]);
    });
  });

  it("returns BundleSummary entries sorted by updatedAt desc", async () => {
    await withTemp(async (dir) => {
      const a = await createBundle(dir, { title: "Alpha" });
      await new Promise((r) => setTimeout(r, 10));
      const b = await createBundle(dir, { title: "Beta" });

      const list = await listBundles(dir);
      expect(list).toHaveLength(2);
      expect(list[0].slug).toBe(b.slug);
      expect(list[1].slug).toBe(a.slug);
      expect(list[0].storyCount).toBe(0);
    });
  });

  it("storyCount counts ALL refs including missing slugs", async () => {
    await withTemp(async (dir) => {
      const created = await createBundle(dir, { title: "Mixed" });
      await updateBundle(dir, created.slug, {
        stories: [
          { storySlug: "exists-but-not-on-disk-1" },
          { storySlug: "exists-but-not-on-disk-2" },
        ],
      });
      const list = await listBundles(dir);
      expect(list[0].storyCount).toBe(2);
    });
  });

  it("skips malformed bundle.json entries", async () => {
    await withTemp(async (dir) => {
      const good = await createBundle(dir, { title: "Good" });

      const { mkdir, writeFile } = await import("node:fs/promises");
      await mkdir(join(dir, "bundles", "broken"), { recursive: true });
      await writeFile(join(dir, "bundles", "broken", "bundle.json"), "not json");

      const list = await listBundles(dir);
      expect(list).toHaveLength(1);
      expect(list[0].slug).toBe(good.slug);
    });
  });
});

describe("getBundle", () => {
  it("returns the bundle for an existing slug", async () => {
    await withTemp(async (dir) => {
      const created = await createBundle(dir, { title: "Findable" });
      const found = await getBundle(dir, created.slug);
      expect(found?.slug).toBe(created.slug);
      expect(found?.title).toBe("Findable");
    });
  });

  it("returns null for a missing slug", async () => {
    await withTemp(async (dir) => {
      expect(await getBundle(dir, "nope")).toBeNull();
    });
  });
});

describe("updateBundle", () => {
  it("applies patch, bumps updatedAt, preserves slug+createdAt", async () => {
    await withTemp(async (dir) => {
      const created = await createBundle(dir, { title: "Original" });
      await new Promise((r) => setTimeout(r, 10));
      const updated = await updateBundle(dir, created.slug, {
        title: "Renamed",
        authorPenName: "Pen",
        description: "Blurb",
        stories: [{ storySlug: "story-a", titleOverride: "Book One" }],
      });
      expect(updated.title).toBe("Renamed");
      expect(updated.authorPenName).toBe("Pen");
      expect(updated.description).toBe("Blurb");
      expect(updated.stories).toEqual([
        { storySlug: "story-a", titleOverride: "Book One" },
      ]);
      expect(updated.slug).toBe(created.slug);
      expect(updated.createdAt).toBe(created.createdAt);
      expect(updated.updatedAt).not.toBe(created.updatedAt);
    });
  });

  it("attempt to override slug or createdAt is ignored", async () => {
    await withTemp(async (dir) => {
      const created = await createBundle(dir, { title: "Immutable Bits" });
      const updated = await updateBundle(dir, created.slug, {
        // intentionally pass immutable fields to verify they're stripped at runtime
        slug: "hacked",
        createdAt: "1999-01-01T00:00:00.000Z",
      });
      expect(updated.slug).toBe(created.slug);
      expect(updated.createdAt).toBe(created.createdAt);
    });
  });

  it("throws when slug not found", async () => {
    await withTemp(async (dir) => {
      await expect(updateBundle(dir, "nope", { title: "x" })).rejects.toThrow(
        /not found/i
      );
    });
  });
});

describe("deleteBundle", () => {
  it("removes the entire bundle folder", async () => {
    await withTemp(async (dir) => {
      const b = await createBundle(dir, { title: "Ephemeral" });
      const path = bundleDir(dir, b.slug);
      await deleteBundle(dir, b.slug);
      await expect(access(path)).rejects.toThrow();
    });
  });

  it("delete is idempotent (no throw when slug already gone)", async () => {
    await withTemp(async (dir) => {
      await expect(deleteBundle(dir, "never-existed")).resolves.toBeUndefined();
    });
  });
});
