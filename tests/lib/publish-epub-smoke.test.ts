import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const epub: { default: unknown } | unknown = require("epub-gen-memory");

describe("epub-gen-memory smoke", () => {
  it("is importable and exposes a callable generator", async () => {
    const candidate =
      (epub as { default?: unknown }).default ?? (epub as unknown);
    expect(typeof candidate).toBe("function");
  });

  it("produces a non-empty Buffer / Uint8Array for a minimal book", async () => {
    const mod = (await import("epub-gen-memory")) as unknown as {
      default?: (opts: unknown, content: unknown) => Promise<Buffer>;
    };
    const generator = mod.default ?? (mod as unknown as (o: unknown, c: unknown) => Promise<Buffer>);
    const bytes = await (generator as (o: unknown, c: unknown) => Promise<Buffer>)(
      { title: "Smoke", author: "Test" },
      [{ title: "Chapter 1", content: "<p>Hello.</p>" }]
    );
    expect(bytes.byteLength ?? bytes.length).toBeGreaterThan(100);
    // EPUB = ZIP; ZIP magic bytes are 0x50 0x4B 0x03 0x04.
    const first4 = Buffer.from(bytes).subarray(0, 4);
    expect(first4[0]).toBe(0x50);
    expect(first4[1]).toBe(0x4b);
  });
});
