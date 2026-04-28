import { describe, it, expect } from "vitest";
import { shouldAllow } from "@/electron/network-filter";

describe("network-filter — shouldAllow", () => {
  const base = { loopbackPort: 54321 };

  it("allows loopback to the configured port", () => {
    expect(shouldAllow(new URL("http://127.0.0.1:54321/api/stories"), base)).toBe(true);
  });

  it("allows localhost as a loopback alias", () => {
    expect(shouldAllow(new URL("http://localhost:54321/api/stories"), base)).toBe(true);
  });

  it("allows IPv6 loopback ::1 as a loopback alias", () => {
    expect(shouldAllow(new URL("http://[::1]:54321/api/stories"), base)).toBe(true);
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

  it("allows update hosts (api.github.com, github.com, objects.githubusercontent.com) over https", () => {
    expect(shouldAllow(new URL("https://api.github.com/repos/x/y/releases/latest"), base)).toBe(true);
    expect(shouldAllow(new URL("https://github.com/Daelso/scriptr/releases/download/v1/latest.yml"), base)).toBe(true);
    expect(shouldAllow(new URL("https://objects.githubusercontent.com/abc/def"), base)).toBe(true);
  });

  it("blocks update hosts over http (https-only)", () => {
    expect(shouldAllow(new URL("http://api.github.com/repos/x/y/releases/latest"), base)).toBe(false);
    expect(shouldAllow(new URL("http://objects.githubusercontent.com/abc"), base)).toBe(false);
  });

  it("blocks arbitrary hosts", () => {
    expect(shouldAllow(new URL("https://evil.example.com/"), base)).toBe(false);
    expect(shouldAllow(new URL("https://www.google-analytics.com/collect"), base)).toBe(false);
  });

  it("allows internal Electron/Chromium schemes (devtools, chrome, chrome-extension)", () => {
    expect(shouldAllow(new URL("devtools://foo/"), base)).toBe(true);
    expect(shouldAllow(new URL("chrome://settings/"), base)).toBe(true);
    expect(shouldAllow(new URL("chrome-extension://abc/popup.html"), base)).toBe(true);
  });

  // Privacy boundary: schemes that look "internal" but can be used for
  // exfiltration or local-file disclosure must NOT slip through. These were
  // previously allowed because the filter was "anything not http(s) is fine".
  it("blocks websocket schemes (ws, wss) — primary exfil vector for compromised renderer", () => {
    expect(shouldAllow(new URL("wss://evil.example/exfil"), base)).toBe(false);
    expect(shouldAllow(new URL("ws://evil.example/exfil"), base)).toBe(false);
    // Even loopback websockets are blocked — we don't use them.
    expect(shouldAllow(new URL("ws://127.0.0.1:54321/"), base)).toBe(false);
  });

  it("blocks file:// (local file disclosure)", () => {
    expect(shouldAllow(new URL("file:///etc/passwd"), base)).toBe(false);
    expect(shouldAllow(new URL("file:///C:/Users/x/.ssh/id_rsa"), base)).toBe(false);
  });

  it("blocks data: and blob: schemes", () => {
    expect(shouldAllow(new URL("data:text/html,<script>fetch('//evil')</script>"), base)).toBe(false);
    expect(shouldAllow(new URL("blob:http://127.0.0.1:54321/abc"), base)).toBe(false);
  });

  it("blocks ftp: and other unusual schemes", () => {
    expect(shouldAllow(new URL("ftp://evil.example/file"), base)).toBe(false);
  });
});
