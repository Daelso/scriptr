import { describe, it, expect } from "vitest";
import { decideStartupAction, type StartupInputs } from "@/electron/migrate";

function inputs(overrides: Partial<StartupInputs> = {}): StartupInputs {
  return {
    userData: "/app-data",
    defaultDataDir: "/app-data/data",
    locationJsonPath: "/app-data/location.json",
    candidates: ["/cwd/data", "/resources/data"],
    probeLocationJson: async () => null,
    probeConfigExists: async () => false,
    ...overrides,
  };
}

describe("migrate — decideStartupAction", () => {
  it("honors location.json override when present", async () => {
    const result = await decideStartupAction(inputs({
      probeLocationJson: async () => "/custom/path",
    }));
    expect(result).toEqual({ kind: "use-override", dataDir: "/custom/path" });
  });

  it("boots from default data dir when config.json exists there", async () => {
    const result = await decideStartupAction(inputs({
      probeConfigExists: async (p) => p === "/app-data/data",
    }));
    expect(result).toEqual({ kind: "boot", dataDir: "/app-data/data" });
  });

  it("prompts when default is empty but a candidate has config.json", async () => {
    const result = await decideStartupAction(inputs({
      probeConfigExists: async (p) => p === "/cwd/data",
    }));
    expect(result).toEqual({
      kind: "prompt",
      candidate: "/cwd/data",
      targetIfCopy: "/app-data/data",
      locationJsonPath: "/app-data/location.json",
    });
  });

  it("returns fresh when nothing exists anywhere", async () => {
    const result = await decideStartupAction(inputs());
    expect(result).toEqual({ kind: "fresh", dataDir: "/app-data/data" });
  });

  it("location.json takes precedence over existing default data dir", async () => {
    const result = await decideStartupAction(inputs({
      probeLocationJson: async () => "/override",
      probeConfigExists: async (p) => p === "/app-data/data",
    }));
    expect(result.kind).toBe("use-override");
  });

  it("picks the first candidate that has config.json", async () => {
    const result = await decideStartupAction(inputs({
      probeConfigExists: async (p) => p === "/resources/data",
      candidates: ["/cwd/data", "/resources/data"],
    }));
    expect(result).toEqual({
      kind: "prompt",
      candidate: "/resources/data",
      targetIfCopy: "/app-data/data",
      locationJsonPath: "/app-data/location.json",
    });
  });
});
