import { describe, expect, it } from "vitest";
import { shouldAllowPaperbackPrintRequest } from "@/electron/paperback-print-filter";

describe("paperback-print-filter", () => {
  const allowed = "file:///C:/Users/chase/Downloads/book-paperback-cover.html";

  it("allows the exact paperback HTML file being printed", () => {
    expect(shouldAllowPaperbackPrintRequest(allowed, allowed)).toBe(true);
  });

  it("allows data URLs for embedded cover images", () => {
    expect(shouldAllowPaperbackPrintRequest("data:image/jpeg;base64,abc", allowed)).toBe(true);
  });

  it("allows Chromium's initial blank document", () => {
    expect(shouldAllowPaperbackPrintRequest("about:blank", allowed)).toBe(true);
  });

  it("blocks other local files", () => {
    expect(
      shouldAllowPaperbackPrintRequest(
        "file:///C:/Users/chase/Downloads/other.html",
        allowed,
      ),
    ).toBe(false);
    expect(shouldAllowPaperbackPrintRequest("file:///C:/Users/chase/.ssh/id_rsa", allowed)).toBe(false);
  });

  it("blocks remote requests from compromised generated HTML", () => {
    expect(shouldAllowPaperbackPrintRequest("https://evil.example/pixel", allowed)).toBe(false);
    expect(shouldAllowPaperbackPrintRequest("http://127.0.0.1:3000/api/settings", allowed)).toBe(false);
  });
});
