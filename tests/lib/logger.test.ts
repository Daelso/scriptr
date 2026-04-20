import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeLogger } from "@/lib/logger";

describe("logger.redact", () => {
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    spy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => spy.mockRestore());

  it("redacts strings that look like xAI keys", () => {
    const log = makeLogger();
    log.info("using key xai-abcdef1234567890abcdef1234567890 now");
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("[info]"),
      expect.stringContaining("using key [REDACTED-KEY] now")
    );
  });

  it("redacts Authorization headers inside objects", () => {
    const log = makeLogger();
    log.info({ headers: { Authorization: "Bearer xai-xyz12345678901234567" } });
    const secondArg = spy.mock.calls[0]?.[1] ?? "";
    expect(secondArg).not.toContain("xai-xyz12345678901234567");
    expect(secondArg).toContain("[REDACTED]");
  });

  it("leaves normal messages alone", () => {
    const log = makeLogger();
    log.info("nothing sensitive here");
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("[info]"),
      expect.stringContaining("nothing sensitive here")
    );
  });
});
