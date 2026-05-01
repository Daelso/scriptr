import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { putCover, getCover, deleteCover, _resetCacheForTests } from "@/lib/epub/cover-cache";

beforeEach(() => {
  _resetCacheForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("cover-cache", () => {
  it("stores and retrieves bytes by sessionId", () => {
    const id = putCover({ mimeType: "image/png", bytes: new Uint8Array([1, 2, 3]) });
    const got = getCover(id);
    expect(got?.mimeType).toBe("image/png");
    expect(Array.from(got!.bytes)).toEqual([1, 2, 3]);
  });

  it("returns undefined for missing sessionId", () => {
    expect(getCover("nope")).toBeUndefined();
  });

  it("deleteCover removes the entry", () => {
    const id = putCover({ mimeType: "image/jpeg", bytes: new Uint8Array([1]) });
    deleteCover(id);
    expect(getCover(id)).toBeUndefined();
  });

  it("evicts entries past the 10-minute TTL", () => {
    vi.useFakeTimers();
    const start = Date.now();
    vi.setSystemTime(start);
    const id = putCover({ mimeType: "image/jpeg", bytes: new Uint8Array([1]) });
    vi.setSystemTime(start + 9 * 60 * 1000);
    expect(getCover(id)).toBeDefined();
    vi.setSystemTime(start + 10 * 60 * 1000 + 1);
    expect(getCover(id)).toBeUndefined();
  });

  it("single-entry cap: a second putCover replaces the first", () => {
    const id1 = putCover({ mimeType: "image/png", bytes: new Uint8Array([1]) });
    const id2 = putCover({ mimeType: "image/jpeg", bytes: new Uint8Array([2]) });
    expect(getCover(id1)).toBeUndefined();
    expect(getCover(id2)).toBeDefined();
  });
});
