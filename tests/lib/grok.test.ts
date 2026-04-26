import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture OpenAI constructor args so tests can assert them
const openaiCtor = vi.fn();
vi.mock("openai", () => ({
  default: class {
    constructor(opts: unknown) {
      openaiCtor(opts);
    }
  },
}));

import { getGrokClient, MissingKeyError } from "@/lib/grok";
import type { Config } from "@/lib/config";

const baseCfg: Config = {
  defaultModel: "grok-4-latest",
  bindHost: "127.0.0.1",
  theme: "system",
  autoRecap: true,
  includeLastChapterFullText: false,
};

describe("getGrokClient", () => {
  beforeEach(() => {
    openaiCtor.mockClear();
  });

  it("throws MissingKeyError when apiKey is absent", () => {
    expect(() => getGrokClient(baseCfg)).toThrow(MissingKeyError);
  });

  it("constructs OpenAI client with correct baseURL and key", () => {
    getGrokClient({ ...baseCfg, apiKey: "xai-abc" });
    expect(openaiCtor).toHaveBeenCalledWith({
      apiKey: "xai-abc",
      baseURL: "https://api.x.ai/v1",
    });
  });

  it("MissingKeyError message mentions XAI_API_KEY and Settings", () => {
    try {
      getGrokClient(baseCfg);
    } catch (e) {
      expect((e as Error).message).toContain("XAI_API_KEY");
      expect((e as Error).message).toContain("Settings");
    }
  });
});
