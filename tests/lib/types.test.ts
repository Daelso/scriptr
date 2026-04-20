import { describe, it, expect } from "vitest";
import type { Chapter } from "@/lib/types";

describe("Chapter.source", () => {
  it("accepts 'imported' and 'generated' and undefined", () => {
    const a: Pick<Chapter, "source"> = { source: "imported" };
    const b: Pick<Chapter, "source"> = { source: "generated" };
    const c: Pick<Chapter, "source"> = {};
    expect(a.source).toBe("imported");
    expect(b.source).toBe("generated");
    expect(c.source).toBeUndefined();
  });
});
