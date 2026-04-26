import { mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { bundleDir, bundleFile, bundleExportsDir, bundlesDir } from "@/lib/storage/paths";
import { toSlug, uniqueSlug } from "@/lib/slug";
import type { Bundle, BundleSummary } from "@/lib/types";

export type NewBundleInput = { title: string };

export async function createBundle(
  dataDir: string,
  input: NewBundleInput
): Promise<Bundle> {
  const existing = await listBundles(dataDir);
  const slug = uniqueSlug(toSlug(input.title), existing.map((b) => b.slug));

  const now = new Date().toISOString();
  const bundle: Bundle = {
    slug,
    title: input.title,
    authorPenName: "",
    description: "",
    language: "en",
    createdAt: now,
    updatedAt: now,
    stories: [],
  };

  await mkdir(bundleDir(dataDir, slug), { recursive: true });
  await writeFile(bundleFile(dataDir, slug), JSON.stringify(bundle, null, 2), "utf-8");
  await mkdir(bundleExportsDir(dataDir, slug), { recursive: true });

  return bundle;
}

export async function listBundles(dataDir: string): Promise<BundleSummary[]> {
  let entries: string[];
  try {
    entries = await readdir(bundlesDir(dataDir));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const summaries: BundleSummary[] = [];
  for (const entry of entries) {
    try {
      const raw = await readFile(bundleFile(dataDir, entry), "utf-8");
      const b = JSON.parse(raw) as Bundle;
      summaries.push({
        slug: b.slug,
        title: b.title,
        storyCount: b.stories.length,
        updatedAt: b.updatedAt,
      });
    } catch {
      // skip malformed or non-bundle entries
    }
  }

  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getBundle(dataDir: string, slug: string): Promise<Bundle | null> {
  try {
    const raw = await readFile(bundleFile(dataDir, slug), "utf-8");
    return JSON.parse(raw) as Bundle;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function updateBundle(
  dataDir: string,
  slug: string,
  patch: Partial<Bundle>
): Promise<Bundle> {
  const existing = await getBundle(dataDir, slug);
  if (!existing) throw new Error(`Bundle not found: ${slug}`);

  const updated: Bundle = {
    ...existing,
    ...patch,
    // Immutable
    slug: existing.slug,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };

  await writeFile(bundleFile(dataDir, slug), JSON.stringify(updated, null, 2), "utf-8");
  return updated;
}

export async function deleteBundle(dataDir: string, slug: string): Promise<void> {
  await rm(bundleDir(dataDir, slug), { recursive: true, force: true });
}
