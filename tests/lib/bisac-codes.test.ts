// tests/lib/bisac-codes.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("public/bisac-codes.json", () => {
  const raw = readFileSync(
    resolve(process.cwd(), "public/bisac-codes.json"),
    "utf8",
  );
  const data = JSON.parse(raw) as Array<{ c: string; l: string }>;

  it("has more than 5000 entries", () => {
    expect(data.length).toBeGreaterThan(5000);
  });

  it("every entry has string c and l", () => {
    for (const entry of data) {
      expect(typeof entry.c).toBe("string");
      expect(typeof entry.l).toBe("string");
      expect(entry.l.length).toBeGreaterThan(0);
    }
  });

  it("every code matches /^[A-Z]{3}\\d{6}$/", () => {
    const rx = /^[A-Z]{3}\d{6}$/;
    for (const entry of data) {
      expect(entry.c).toMatch(rx);
    }
  });

  it("codes are unique", () => {
    const codes = new Set(data.map((e) => e.c));
    expect(codes.size).toBe(data.length);
  });

  it("entries are sorted ascending by code", () => {
    for (let i = 1; i < data.length; i++) {
      expect(data[i].c > data[i - 1].c).toBe(true);
    }
  });
});
