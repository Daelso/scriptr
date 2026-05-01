import JSZip from "jszip";
import { EpubParseError } from "@/lib/epub/types";

export interface EpubArchive {
  has(path: string): boolean;
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  /** All paths inside the archive, in zip order. */
  paths(): string[];
}

export async function openEpubArchive(buf: Buffer): Promise<EpubArchive> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw new EpubParseError("File is not a valid EPUB (could not unzip).");
  }

  return {
    has(path) {
      return zip.file(path) !== null;
    },
    async readText(path) {
      const f = zip.file(path);
      if (!f) throw new Error(`EPUB entry not found: ${path}`);
      return f.async("string");
    },
    async readBytes(path) {
      const f = zip.file(path);
      if (!f) throw new Error(`EPUB entry not found: ${path}`);
      return f.async("uint8array");
    },
    paths() {
      return Object.keys(zip.files);
    },
  };
}
