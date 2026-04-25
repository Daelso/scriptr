import { describe, it, expect } from "vitest";
import { shouldAllow } from "@/electron/network-filter";

describe("network-filter — shouldAllow", () => {
  const base = { loopbackPort: 54321, updatesEnabled: false };

  it("allows loopback to the configured port", () => {
    expect(shouldAllow(new URL("http://127.0.0.1:54321/api/stories"), base)).toBe(true);
  });

  it("blocks loopback on the wrong port", () => {
    expect(shouldAllow(new URL("http://127.0.0.1:9999/"), base)).toBe(false);
  });

  it("blocks loopback over https", () => {
    expect(shouldAllow(new URL("https://127.0.0.1:54321/"), base)).toBe(false);
  });

  it("allows api.x.ai over https", () => {
    expect(shouldAllow(new URL("https://api.x.ai/v1/chat"), base)).toBe(true);
  });

  it("blocks api.x.ai over http", () => {
    expect(shouldAllow(new URL("http://api.x.ai/v1/chat"), base)).toBe(false);
  });

  it("blocks api.github.com when updates disabled", () => {
    expect(shouldAllow(new URL("https://api.github.com/repos/x/y/releases/latest"), base)).toBe(false);
  });

  it("allows api.github.com when updates enabled", () => {
    expect(shouldAllow(new URL("https://api.github.com/repos/x/y/releases/latest"), { ...base, updatesEnabled: true })).toBe(true);
  });

  it("blocks arbitrary hosts", () => {
    expect(shouldAllow(new URL("https://evil.example.com/"), base)).toBe(false);
    expect(shouldAllow(new URL("https://www.google-analytics.com/collect"), { ...base, updatesEnabled: true })).toBe(false);
  });

  it("allows devtools:// and file:// (internal Electron schemes)", () => {
    expect(shouldAllow(new URL("devtools://foo/"), base)).toBe(true);
    expect(shouldAllow(new URL("file:///some/path"), base)).toBe(true);
  });
});
