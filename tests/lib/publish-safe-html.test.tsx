// @vitest-environment jsdom
/**
 * Tests for SafeHtml — verifies the default tight allowlist (div/h1/p/strong/em/span + class)
 * still strips dangerous tags, and the new `extra` prop opt-in widens the allowlist while
 * still respecting an optional ALLOWED_URI_REGEXP.
 *
 * Manual React-19 render harness (no @testing-library/react by project rule).
 */
import { describe, it, expect } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { SafeHtml } from "@/lib/publish/safe-html";

type Mounted = { container: HTMLDivElement; unmount: () => void };
function mount(element: React.ReactElement): Mounted {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root!: Root;
  act(() => {
    root = createRoot(container);
    root.render(element);
  });
  const unmount = () => {
    act(() => { root.unmount(); });
    container.remove();
  };
  return { container, unmount };
}

describe("SafeHtml extra allowlist", () => {
  it("strips <a> by default", () => {
    const { container, unmount } = mount(
      <SafeHtml html='<p>hi <a href="https://x.test">click</a></p>' />
    );
    try {
      expect(container.querySelector("a")).toBeNull();
    } finally {
      unmount();
    }
  });

  it("preserves <a href> when extra allows it", () => {
    const { container, unmount } = mount(
      <SafeHtml
        html='<p>hi <a href="https://x.test">click</a></p>'
        extra={{ ALLOWED_TAGS: ["a"], ALLOWED_ATTR: ["href"] }}
      />
    );
    try {
      const a = container.querySelector("a");
      expect(a?.getAttribute("href")).toBe("https://x.test");
    } finally {
      unmount();
    }
  });

  it("ALLOWED_URI_REGEXP rejects javascript: scheme even when <a> is allowed", () => {
    const { container, unmount } = mount(
      <SafeHtml
        html='<a href="javascript:alert(1)">x</a>'
        extra={{
          ALLOWED_TAGS: ["a"],
          ALLOWED_ATTR: ["href"],
          ALLOWED_URI_REGEXP: /^https?:/i,
        }}
      />
    );
    try {
      const a = container.querySelector("a");
      expect(a?.getAttribute("href")).toBeNull();
    } finally {
      unmount();
    }
  });

  it("ALLOWED_URI_REGEXP allows mailto: and data:image/png;base64 only", () => {
    const regex = /^(?:https?:|mailto:|data:image\/png;base64,)/i;
    const { container, unmount } = mount(
      <SafeHtml
        html={`<div>
          <a href="mailto:x@y">m</a>
          <a href="data:text/html,<script>x</script>">bad</a>
          <img src="data:image/png;base64,abc" alt="qr" />
          <img src="data:image/svg+xml;base64,abc" alt="bad" />
        </div>`}
        extra={{
          ALLOWED_TAGS: ["a", "img"],
          ALLOWED_ATTR: ["href", "src", "alt"],
          ALLOWED_URI_REGEXP: regex,
        }}
      />
    );
    try {
      const anchors = container.querySelectorAll("a");
      expect(anchors[0].getAttribute("href")).toBe("mailto:x@y");
      expect(anchors[1]?.getAttribute("href")).toBeNull();
      const imgs = container.querySelectorAll("img");
      const goodImg = Array.from(imgs).find((i) => i.getAttribute("alt") === "qr");
      const badImg = Array.from(imgs).find((i) => i.getAttribute("alt") === "bad");
      expect(goodImg?.getAttribute("src")).toBe("data:image/png;base64,abc");
      expect(badImg?.getAttribute("src")).toBeNull();
    } finally {
      unmount();
    }
  });
});
