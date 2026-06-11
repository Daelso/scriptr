import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  customPaperbackCoverSpecPath,
  customPaperbackInteriorPath,
  paperbackCoverSpecPath,
  paperbackInteriorPath,
} from "@/lib/storage/paths";
import type { PaperbackCoverSpec, PaperbackOptions } from "@/lib/publish/paperback-shared";

export type PaperbackExportSpec = {
  options: PaperbackOptions;
  cover: PaperbackCoverSpec;
  notes: string[];
};

async function writeAtomic(path: string, bytes: string): Promise<void> {
  const tempPath = `${path}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(tempPath, bytes, "utf-8");
  await rename(tempPath, path);
}

export async function writePaperbackExport(
  dataDir: string,
  slug: string,
  input: { html: string; spec: PaperbackExportSpec },
  opts?: { outputDir?: string },
): Promise<{ interiorPath: string; coverSpecPath: string; bytes: number }> {
  const interiorPath = opts?.outputDir
    ? customPaperbackInteriorPath(opts.outputDir, slug)
    : paperbackInteriorPath(dataDir, slug);
  const coverSpecPath = opts?.outputDir
    ? customPaperbackCoverSpecPath(opts.outputDir, slug)
    : paperbackCoverSpecPath(dataDir, slug);
  const specJson = JSON.stringify(input.spec, null, 2);

  await writeAtomic(interiorPath, input.html);
  await writeAtomic(coverSpecPath, specJson);

  return {
    interiorPath,
    coverSpecPath,
    bytes: Buffer.byteLength(input.html, "utf-8") + Buffer.byteLength(specJson, "utf-8"),
  };
}
