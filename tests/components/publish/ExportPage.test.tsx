// @vitest-environment jsdom
/**
 * Tests for ExportPage — roving-tabindex and arrow-key navigation on the
 * EPUB version radiogroup.
 *
 * Manual React-19 render harness (no @testing-library/react by project rule).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

// Mock sonner so toast calls don't blow up in jsdom.
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

// Mock fetch — ExportPage may fire patch calls on blur; stub to avoid errors.
const mockFetch = vi.fn().mockResolvedValue({
  json: () => Promise.resolve({ ok: true }),
} as unknown as Response);
vi.stubGlobal("fetch", mockFetch);

import { ExportPage } from "@/components/publish/ExportPage";
import type { Story } from "@/lib/types";

const baseStory: Story = {
  slug: "test-story",
  title: "Test Story",
  authorPenName: "Jane Doe",
  description: "A description.",
  copyrightYear: 2026,
  language: "en",
  bisacCategory: "FIC000000",
  keywords: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  chapterOrder: ["ch-1"],
};

type Mounted = {
  container: HTMLDivElement;
  root: Root;
  unmount: () => void;
};

function mount(element: React.ReactElement): Mounted {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root!: Root;
  act(() => {
    root = createRoot(container);
    root.render(element);
  });
  const unmount = () => {
    act(() => {
      root.unmount();
    });
    container.remove();
  };
  return { container, root, unmount };
}

describe("ExportPage — EPUB version toggle roving tabindex", () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  it("EPUB 3 has tabIndex=0 and EPUB 2 has tabIndex=-1 on initial render", () => {
    const { container, unmount } = mount(
      <ExportPage story={baseStory} chapterCount={1} wordCount={500} />,
    );
    try {
      const btn3 = container.querySelector<HTMLButtonElement>(
        '[data-testid="export-version-epub3"]',
      );
      const btn2 = container.querySelector<HTMLButtonElement>(
        '[data-testid="export-version-epub2"]',
      );
      expect(btn3).not.toBeNull();
      expect(btn2).not.toBeNull();
      expect(btn3!.tabIndex).toBe(0);
      expect(btn2!.tabIndex).toBe(-1);
      expect(btn3!.getAttribute("aria-checked")).toBe("true");
      expect(btn2!.getAttribute("aria-checked")).toBe("false");
    } finally {
      unmount();
    }
  });

  it("ArrowRight moves selection to EPUB 2: tabIndex=0, aria-checked=true, and focused", () => {
    const { container, unmount } = mount(
      <ExportPage story={baseStory} chapterCount={1} wordCount={500} />,
    );
    try {
      const radiogroup = container.querySelector<HTMLDivElement>(
        '[data-testid="export-version-toggle"]',
      );
      expect(radiogroup).not.toBeNull();

      act(() => {
        radiogroup!.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
        );
      });

      const btn2 = container.querySelector<HTMLButtonElement>(
        '[data-testid="export-version-epub2"]',
      );
      const btn3 = container.querySelector<HTMLButtonElement>(
        '[data-testid="export-version-epub3"]',
      );
      expect(btn2!.tabIndex).toBe(0);
      expect(btn3!.tabIndex).toBe(-1);
      expect(btn2!.getAttribute("aria-checked")).toBe("true");
      // Check that btn2 received focus.
      expect(document.activeElement).toBe(btn2);
    } finally {
      unmount();
    }
  });

  it("ArrowLeft from EPUB 3 moves to EPUB 2", () => {
    const { container, unmount } = mount(
      <ExportPage story={baseStory} chapterCount={1} wordCount={500} />,
    );
    try {
      const radiogroup = container.querySelector<HTMLDivElement>(
        '[data-testid="export-version-toggle"]',
      );
      act(() => {
        radiogroup!.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
        );
      });

      const btn2 = container.querySelector<HTMLButtonElement>(
        '[data-testid="export-version-epub2"]',
      );
      expect(btn2!.tabIndex).toBe(0);
      expect(btn2!.getAttribute("aria-checked")).toBe("true");
    } finally {
      unmount();
    }
  });

  it("Home key moves to EPUB 3 (first option)", () => {
    const { container, unmount } = mount(
      <ExportPage story={baseStory} chapterCount={1} wordCount={500} />,
    );
    try {
      const radiogroup = container.querySelector<HTMLDivElement>(
        '[data-testid="export-version-toggle"]',
      );
      // First move to EPUB 2.
      act(() => {
        radiogroup!.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
        );
      });
      // Then press Home to go back to EPUB 3.
      act(() => {
        radiogroup!.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
        );
      });

      const btn3 = container.querySelector<HTMLButtonElement>(
        '[data-testid="export-version-epub3"]',
      );
      expect(btn3!.tabIndex).toBe(0);
      expect(btn3!.getAttribute("aria-checked")).toBe("true");
    } finally {
      unmount();
    }
  });

  it("End key moves to EPUB 2 (last option)", () => {
    const { container, unmount } = mount(
      <ExportPage story={baseStory} chapterCount={1} wordCount={500} />,
    );
    try {
      const radiogroup = container.querySelector<HTMLDivElement>(
        '[data-testid="export-version-toggle"]',
      );
      act(() => {
        radiogroup!.dispatchEvent(
          new KeyboardEvent("keydown", { key: "End", bubbles: true }),
        );
      });

      const btn2 = container.querySelector<HTMLButtonElement>(
        '[data-testid="export-version-epub2"]',
      );
      expect(btn2!.tabIndex).toBe(0);
      expect(btn2!.getAttribute("aria-checked")).toBe("true");
    } finally {
      unmount();
    }
  });
});
