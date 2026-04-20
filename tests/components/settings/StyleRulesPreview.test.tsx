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

describe("StyleRulesPreview — populated", () => {
  beforeEach(() => {
    mockFormat.mockReset();
  });

  it("renders the exact formatStyleRules output inside the <pre>", () => {
    const sample = "# Style rules\n1. Use contractions.\n2. Do not use em-dashes.";
    mockFormat.mockReturnValue(sample);

    const { container, unmount } = mount(
      <StyleRulesPreview rules={DEFAULT_STYLE} />,
    );
    try {
      const pre = container.querySelector("pre");
      expect(pre).not.toBeNull();
      expect(pre?.textContent).toBe(sample);
      expect(mockFormat).toHaveBeenCalledWith(DEFAULT_STYLE);
    } finally {
      unmount();
    }
  });
});

describe("StyleRulesPreview — copy button", () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");

  beforeEach(() => {
    mockFormat.mockReset();
  });

  afterEach(() => {
    // Restore the original clipboard descriptor (or remove our mock if there was none) so
    // subsequent test files don't inherit our fake.
    if (originalClipboard) {
      Object.defineProperty(navigator, "clipboard", originalClipboard);
    } else {
      delete (navigator as unknown as { clipboard?: unknown }).clipboard;
    }
  });

  it("writes the rendered text to the clipboard on click", async () => {
    const sample = "# Style rules\n1. Use contractions.";
    mockFormat.mockReturnValue(sample);

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const { container, unmount } = mount(
      <StyleRulesPreview rules={DEFAULT_STYLE} />,
    );
    try {
      const btn = container.querySelector<HTMLButtonElement>(
        '[aria-label="Copy style rules"]',
      );
      expect(btn).not.toBeNull();
      await act(async () => {
        btn!.click();
      });
      expect(writeText).toHaveBeenCalledWith(sample);
    } finally {
      unmount();
    }
  });
});
