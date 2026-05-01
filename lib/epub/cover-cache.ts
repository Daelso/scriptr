import { randomUUID } from "node:crypto";

const TTL_MS = 10 * 60 * 1000;

type Entry = {
  mimeType: string;
  bytes: Uint8Array;
  expiresAt: number;
};

let current: { id: string; entry: Entry } | null = null;

export function putCover(input: { mimeType: string; bytes: Uint8Array }): string {
  const id = randomUUID();
  current = {
    id,
    entry: {
      mimeType: input.mimeType,
      bytes: input.bytes,
      expiresAt: Date.now() + TTL_MS,
    },
  };
  return id;
}

export function getCover(id: string): { mimeType: string; bytes: Uint8Array } | undefined {
  if (!current || current.id !== id) return undefined;
  if (Date.now() > current.entry.expiresAt) {
    current = null;
    return undefined;
  }
  return { mimeType: current.entry.mimeType, bytes: current.entry.bytes };
}

export function deleteCover(id: string): void {
  if (current && current.id === id) current = null;
}

/** Test-only helper to clear the singleton between tests. */
export function _resetCacheForTests(): void {
  current = null;
}
