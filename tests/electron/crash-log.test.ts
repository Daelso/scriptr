import { describe, it, expect } from "vitest";
import { formatCrashEntry } from "@/electron/crash-log";

describe("crash-log — formatCrashEntry", () => {
  const at = new Date("2026-04-25T14:32:08.412Z");

  it("formats a server crash to a single tab-separated line", () => {
    const line = formatCrashEntry(at, {
      kind: "server",
      code: null,
      signal: "SIGSEGV",
      stderrTail: "Segmentation fault\nstack trace line 1",
    });
    expect(line).toBe(
      "2026-04-25T14:32:08.412Z\tserver\tcode=null\tsignal=SIGSEGV\tstderr=Segmentation fault↵stack trace line 1\n",
    );
  });

  it("formats a renderer crash without stderr", () => {
    const line = formatCrashEntry(at, {
      kind: "renderer",
      reason: "oom",
      exitCode: -1,
    });
    expect(line).toBe(
      "2026-04-25T14:32:08.412Z\trenderer\treason=oom\texitCode=-1\n",
    );
  });

  it("renders code=<num> and signal=null when present", () => {
    const line = formatCrashEntry(at, {
      kind: "server",
      code: 137,
      signal: null,
      stderrTail: "",
    });
    expect(line).toBe(
      "2026-04-25T14:32:08.412Z\tserver\tcode=137\tsignal=null\tstderr=\n",
    );
  });

  it("truncates stderr longer than 512 bytes", () => {
    const big = "x".repeat(2000);
    const line = formatCrashEntry(at, {
      kind: "server",
      code: null,
      signal: null,
      stderrTail: big,
    });
    expect(line).toContain("stderr=" + "x".repeat(512) + "…(truncated)");
  });

  it("flattens CRLF and LF in stderr", () => {
    const line = formatCrashEntry(at, {
      kind: "server",
      code: null,
      signal: null,
      stderrTail: "line1\r\nline2\nline3",
    });
    expect(line).toContain("stderr=line1↵line2↵line3");
  });

  it("redacts xAI API keys from stderr before writing", () => {
    const line = formatCrashEntry(at, {
      kind: "server",
      code: null,
      signal: null,
      stderrTail:
        "APIError: 401 from https://api.x.ai using key xai-A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6 — request failed",
    });
    expect(line).not.toContain("xai-A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6");
    expect(line).toContain("[REDACTED-KEY]");
  });

  it("redacts multiple keys in one stderr buffer", () => {
    const line = formatCrashEntry(at, {
      kind: "server",
      code: null,
      signal: null,
      stderrTail:
        "first xai-AAAAAAAAAAAAAAAAAAAA then xai-BBBBBBBBBBBBBBBBBBBB end",
    });
    expect(line).not.toContain("xai-A");
    expect(line).not.toContain("xai-B");
    expect((line.match(/\[REDACTED-KEY\]/g) ?? []).length).toBe(2);
  });

  it("redacts keys before truncation so a key spanning the boundary is not partially leaked", () => {
    // Place the key so its tail is past the 512-char truncation boundary.
    // If we truncated FIRST and redacted SECOND, the leading `xai-` would
    // appear in the truncated output. Redacting first ensures no key
    // characters survive, even if the [REDACTED-KEY] marker itself ends
    // up partially truncated.
    const padding = "x".repeat(500);
    const line = formatCrashEntry(at, {
      kind: "server",
      code: null,
      signal: null,
      stderrTail: padding + "xai-ABCDEFGHIJKLMNOPQRST end of trace",
    });
    expect(line).not.toContain("xai-A");
    expect(line).not.toContain("xai-");
  });
});
