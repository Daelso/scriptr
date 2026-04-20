// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

vi.mock("@/lib/style", async () => {
  const actual = await vi.importActual<typeof import("@/lib/style")>("@/lib/style");
  return {
    ...actual,
    formatStyleRules: vi.fn(),
  };
});

import { formatStyleRules, DEFAULT_STYLE } from "@/lib/style";
import { StyleRulesPreview } from "@/components/settings/StyleRulesPreview";

type Mounted = { container: HTMLDivElement; root: Root; unmount: () => void };
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
  return { container, root, unmount };
}

const mockFormat = vi.mocked(formatStyleRules);

describe("StyleRulesPreview — empty state", () => {
  beforeEach(() => {
    mockFormat.mockReset();
  });

  it("renders the placeholder and hides the copy button when formatStyleRules returns \"\"", () => {
    mockFormat.mockReturnValue("");
    const { container, unmount } = mount(
      <StyleRulesPreview rules={DEFAULT_STYLE} />,
    );
    try {
      expect(container.textContent).toContain("No style rules");
      expect(container.querySelector('[aria-label="Copy style rules"]')).toBeNull();
    } finally {
      unmount();
    }
  });
});
