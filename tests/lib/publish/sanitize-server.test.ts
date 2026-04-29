// tests/lib/publish/sanitize-server.test.ts
// Server-side sanitizer unit tests. Runs in node env (no @vitest-environment
// directive) — the whole point is that this impl does not require a DOM.

import { describe, it, expect } from "vitest";
import { sanitizeWith } from "@/lib/publish/sanitize-server";

const TIGHT = {
  ALLOWED_TAGS: ["p", "a", "img", "strong", "em", "div", "h2", "br"],
  ALLOWED_ATTR: ["class", "href", "src", "alt", "width", "height"],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
};

describe("sanitize-server: tag allowlist", () => {
  it("strips disallowed tags but keeps text", () => {
    const out = sanitizeWith("<p>ok</p><script>alert(1)</script>", TIGHT);
    expect(out).not.toMatch(/<script\b/i);
    expect(out).toContain("<p>ok</p>");
  });

  it("strips <img> when not in allowlist", () => {
    const opts = { ...TIGHT, ALLOWED_TAGS: ["p"] };
    const out = sanitizeWith('<p>x</p><img src="https://x.test/x.png" />', opts);
    expect(out).not.toContain("<img");
  });
});

describe("sanitize-server: attribute allowlist", () => {
  it("drops attributes not in ALLOWED_ATTR", () => {
    const out = sanitizeWith('<a href="https://x.test" onclick="x">y</a>', TIGHT);
    expect(out).toContain('href="https://x.test"');
    expect(out).not.toContain("onclick");
  });

  it("strips data-* attributes (ALLOW_DATA_ATTR: false)", () => {
    const out = sanitizeWith('<a href="https://x.test" data-evil="1">y</a>', TIGHT);
    expect(out).toContain('href="https://x.test"');
    expect(out).not.toContain("data-evil");
  });

  it("strips aria-* attributes (ALLOW_ARIA_ATTR: false)", () => {
    const out = sanitizeWith('<a href="https://x.test" aria-evil="1">y</a>', TIGHT);
    expect(out).toContain('href="https://x.test"');
    expect(out).not.toContain("aria-evil");
  });
});

describe("sanitize-server: URI regex hook", () => {
  const URI_RE = /^(?:https?:|mailto:|data:image\/png;base64,)/i;

  it("allows https URIs that match the regex", () => {
    const out = sanitizeWith('<a href="https://x.test">y</a>', TIGHT, URI_RE);
    expect(out).toContain('href="https://x.test"');
  });

  it("strips javascript: URIs even when <a> is allowed", () => {
    const out = sanitizeWith('<a href="javascript:alert(1)">y</a>', TIGHT, URI_RE);
    expect(out).not.toMatch(/javascript:/i);
  });

  it("strips data:text/html URIs", () => {
    const out = sanitizeWith(
      '<a href="data:text/html,<script>x</script>">y</a>',
      TIGHT,
      URI_RE,
    );
    expect(out).not.toMatch(/data:text\/html/i);
  });

  it("strips data:image/svg+xml URIs (svg can carry script)", () => {
    const out = sanitizeWith(
      '<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" alt="x" />',
      TIGHT,
      URI_RE,
    );
    expect(out).not.toMatch(/data:image\/svg\+xml/i);
  });

  it("preserves data:image/png;base64 with a non-empty base64 payload", () => {
    const out = sanitizeWith(
      '<img src="data:image/png;base64,iVBORw0KGgo=" alt="qr" />',
      TIGHT,
      URI_RE,
    );
    expect(out).toContain('src="data:image/png;base64,iVBORw0KGgo="');
  });

  it("rejects empty data:image/png;base64 payload (extraUriChecks)", () => {
    const out = sanitizeWith(
      '<img src="data:image/png;base64," alt="x" />',
      TIGHT,
      URI_RE,
    );
    expect(out).not.toMatch(/data:image\/png;base64,/);
  });

  it("rejects http URI with no hostname (extraUriChecks)", () => {
    const out = sanitizeWith('<a href="http://">y</a>', TIGHT, URI_RE);
    expect(out).not.toMatch(/href="http:/);
  });

  it("rejects mailto without @ (extraUriChecks)", () => {
    const out = sanitizeWith('<a href="mailto:noaddress">y</a>', TIGHT, URI_RE);
    expect(out).not.toMatch(/mailto:/);
  });

  it("strips URI values containing whitespace or control chars", () => {
    const out = sanitizeWith('<a href="https://x .test">y</a>', TIGHT, URI_RE);
    expect(out).not.toMatch(/href=/);
  });

  it("strips URI values containing bidi controls", () => {
    const out = sanitizeWith(
      '<a href="https://‮x.test">y</a>',
      TIGHT,
      URI_RE,
    );
    expect(out).not.toMatch(/href=/);
  });
});

describe("sanitize-server: no uriRegex passed", () => {
  it("does not URI-filter when uriRegex is omitted (DOMPurify default scheme list applies)", () => {
    const out = sanitizeWith('<a href="https://x.test">y</a>', TIGHT);
    expect(out).toContain('href="https://x.test"');
  });
});
