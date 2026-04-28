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

// Mock fetch — ExportPage may fire patch calls on blur, plus the new
// BisacCombobox fires a /bisac-codes.json fetch on render. Short-circuit
// the BISAC fetch so it doesn't consume mockResolvedValueOnce slots that
// individual tests reserve for /api/settings, /api/stories, etc.
const mockFetch = vi.fn().mockImplementation((url: string) => {
  if (typeof url === "string" && url.includes("bisac-codes.json")) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve([]),
    } as unknown as Response);
  }
  return Promise.resolve({
    json: () => Promise.resolve({ ok: true }),
  } as unknown as Response);
});
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

import { toast } from "sonner";

const settingsGetMock = {
  ok: true,
  json: () => Promise.resolve({ ok: true, data: { isElectron: false, defaultExportDir: undefined } }),
} as unknown as Response;

describe("ExportPage — handleBuild error visibility", () => {
  beforeEach(() => {
    mockFetch.mockClear();
    (toast.error as ReturnType<typeof vi.fn>).mockClear();
    (toast.success as ReturnType<typeof vi.fn>).mockClear();
  });

  it("toasts an error when the export route returns 500 with an HTML body", async () => {
    mockFetch
      .mockResolvedValueOnce(settingsGetMock)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve("<html>boom: epub-gen-memory exploded</html>"),
      } as unknown as Response);

    const { container, unmount } = mount(
      <ExportPage story={baseStory} chapterCount={1} wordCount={500} />,
    );
    try {
      const buildBtn = container.querySelector<HTMLButtonElement>(
        '[data-testid="export-build"]',
      );
      expect(buildBtn).not.toBeNull();
      await act(async () => {
        buildBtn!.click();
      });
      // sonner is mocked; check that toast.error fired with status + body excerpt
      const errCalls = (toast.error as ReturnType<typeof vi.fn>).mock.calls;
      expect(errCalls.length).toBeGreaterThan(0);
      expect(String(errCalls[0][0])).toMatch(/500/);
      expect(String(errCalls[0][0])).toMatch(/boom/);
      expect((toast.success as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    } finally {
      unmount();
    }
  });

  it("surfaces the body.error string when the export route returns 500 with a JSON body", async () => {
    // The route's outer try/catch returns `{ ok: false, error: "<msg>" }`
    // for any non-4xx failure. The UI must parse the JSON instead of
    // text-slicing it, so the user sees the actionable message instead of
    // `Build failed (500): {"ok":false,"error":"<msg>...`.
    const detailedMessage =
      "EPUB export failed: Cannot read property 'foo' of undefined. Full stack written to /home/u/data/logs/api-errors.log";
    mockFetch
      .mockResolvedValueOnce(settingsGetMock)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve(JSON.stringify({ ok: false, error: detailedMessage })),
      } as unknown as Response);

    const { container, unmount } = mount(
      <ExportPage story={baseStory} chapterCount={1} wordCount={500} />,
    );
    try {
      const buildBtn = container.querySelector<HTMLButtonElement>(
        '[data-testid="export-build"]',
      );
      await act(async () => {
        buildBtn!.click();
      });
      const errCalls = (toast.error as ReturnType<typeof vi.fn>).mock.calls;
      expect(errCalls.length).toBeGreaterThan(0);
      const message = String(errCalls[0][0]);
      expect(message).toMatch(/500/);
      expect(message).toContain(detailedMessage);
      // No raw JSON braces should leak into the toast.
      expect(message).not.toContain('"ok":false');
    } finally {
      unmount();
    }
  });

  it("toasts an error when fetch itself rejects (network failure)", async () => {
    mockFetch
      .mockResolvedValueOnce(settingsGetMock)
      .mockRejectedValueOnce(new Error("Failed to fetch"));

    const { container, unmount } = mount(
      <ExportPage story={baseStory} chapterCount={1} wordCount={500} />,
    );
    try {
      const buildBtn = container.querySelector<HTMLButtonElement>(
        '[data-testid="export-build"]',
      );
      await act(async () => {
        buildBtn!.click();
      });
      const errCalls = (toast.error as ReturnType<typeof vi.fn>).mock.calls;
      expect(errCalls.length).toBeGreaterThan(0);
      expect(String(errCalls[0][0])).toMatch(/Failed to fetch/);
    } finally {
      unmount();
    }
  });

  it("toasts success with the saved path when the route returns ok", async () => {
    mockFetch
      .mockResolvedValueOnce(settingsGetMock)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          ok: true,
          data: { path: "/Users/chase/Books/x-epub3.epub", bytes: 12345, version: 3, warnings: [] },
        }),
      } as unknown as Response);

    const { container, unmount } = mount(
      <ExportPage story={baseStory} chapterCount={1} wordCount={500} />,
    );
    try {
      const buildBtn = container.querySelector<HTMLButtonElement>(
        '[data-testid="export-build"]',
      );
      await act(async () => {
        buildBtn!.click();
      });
      const succCalls = (toast.success as ReturnType<typeof vi.fn>).mock.calls;
      expect(succCalls.length).toBe(1);
      expect(String(succCalls[0][0])).toMatch(/x-epub3\.epub/);
    } finally {
      unmount();
    }
  });
});

describe("ExportPage — output location section", () => {
  beforeEach(() => {
    mockFetch.mockClear();
    (toast.error as ReturnType<typeof vi.fn>).mockClear();
    (toast.success as ReturnType<typeof vi.fn>).mockClear();
    // Clean up window.scriptr between tests
    delete (window as unknown as { scriptr?: unknown }).scriptr;
  });

  it("shows the current default export dir from /api/settings on mount", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        data: { isElectron: true, defaultExportDir: "/Users/chase/Books" },
      }),
    } as unknown as Response);

    let result!: ReturnType<typeof mount>;
    await act(async () => {
      result = mount(<ExportPage story={baseStory} chapterCount={1} wordCount={500} />);
    });
    try {
      const input = result.container.querySelector<HTMLInputElement>(
        '[data-testid="export-output-dir"]',
      );
      expect(input).not.toBeNull();
      expect(input!.value).toBe("/Users/chase/Books");
    } finally {
      result.unmount();
    }
  });

  it("hides the 'Choose folder…' button when isElectron is false", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        data: { isElectron: false, defaultExportDir: undefined },
      }),
    } as unknown as Response);

    let result!: ReturnType<typeof mount>;
    await act(async () => {
      result = mount(<ExportPage story={baseStory} chapterCount={1} wordCount={500} />);
    });
    try {
      expect(
        result.container.querySelector('[data-testid="export-pick-folder"]'),
      ).toBeNull();
    } finally {
      result.unmount();
    }
  });

  it("shows the 'Choose folder…' button when isElectron and window.scriptr exist", async () => {
    (window as unknown as { scriptr: unknown }).scriptr = {
      pickFolder: vi.fn().mockResolvedValue(null),
      revealInFolder: vi.fn(),
      openFile: vi.fn(),
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        data: { isElectron: true, defaultExportDir: undefined },
      }),
    } as unknown as Response);

    let result!: ReturnType<typeof mount>;
    await act(async () => {
      result = mount(<ExportPage story={baseStory} chapterCount={1} wordCount={500} />);
    });
    try {
      expect(
        result.container.querySelector('[data-testid="export-pick-folder"]'),
      ).not.toBeNull();
    } finally {
      result.unmount();
    }
  });

  it("clicking 'Choose folder…' calls window.scriptr.pickFolder and saves on selection", async () => {
    const pickFolder = vi.fn().mockResolvedValue("/picked/dir");
    (window as unknown as { scriptr: unknown }).scriptr = {
      pickFolder,
      revealInFolder: vi.fn(),
      openFile: vi.fn(),
    };
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: { isElectron: true, defaultExportDir: undefined },
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: { defaultExportDir: "/picked/dir" },
        }),
      } as unknown as Response);

    let result!: ReturnType<typeof mount>;
    await act(async () => {
      result = mount(<ExportPage story={baseStory} chapterCount={1} wordCount={500} />);
    });
    try {
      const btn = result.container.querySelector<HTMLButtonElement>(
        '[data-testid="export-pick-folder"]',
      );
      await act(async () => {
        btn!.click();
      });
      expect(pickFolder).toHaveBeenCalledTimes(1);
      // PUT call to /api/settings with the picked dir
      const putCall = mockFetch.mock.calls.find(
        (c) => String(c[0]).includes("/api/settings") && (c[1] as RequestInit | undefined)?.method === "PUT",
      );
      expect(putCall).toBeTruthy();
      expect(JSON.parse(String((putCall![1] as RequestInit).body))).toEqual({
        defaultExportDir: "/picked/dir",
      });
      const input = result.container.querySelector<HTMLInputElement>(
        '[data-testid="export-output-dir"]',
      );
      expect(input!.value).toBe("/picked/dir");
    } finally {
      result.unmount();
    }
  });

  it("PUT 400 rolls input back to last-saved value and toasts the error", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: { isElectron: false, defaultExportDir: "/saved/dir" },
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ ok: false, error: "defaultExportDir directory does not exist" }),
      } as unknown as Response);

    let result!: ReturnType<typeof mount>;
    await act(async () => {
      result = mount(<ExportPage story={baseStory} chapterCount={1} wordCount={500} />);
    });
    // Wait one extra microtask tick so the mount-effect's GET .then() runs and
    // savedOutputDirRef is populated BEFORE we type into the input. Without
    // this, blur would compare against an empty saved value and the test
    // could pass for the wrong reason.
    await act(async () => { await Promise.resolve(); });
    try {
      const input = result.container.querySelector<HTMLInputElement>(
        '[data-testid="export-output-dir"]',
      );
      // Pre-condition: GET populated the input with the saved value.
      expect(input!.value).toBe("/saved/dir");

      // Simulate user typing a bad value, then blur.
      await act(async () => {
        // React-controlled input: dispatch a real input event so React's
        // synthetic event system observes the new value.
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        )!.set!;
        setter.call(input, "/does/not/exist");
        input!.dispatchEvent(new Event("input", { bubbles: true }));
        input!.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      });
      // Drain the PUT's .then() chain so the rollback setState lands.
      await act(async () => { await Promise.resolve(); });
      // After the failing PUT, value should roll back to "/saved/dir".
      expect(input!.value).toBe("/saved/dir");
      expect((toast.error as ReturnType<typeof vi.fn>).mock.calls[0][0])
        .toMatch(/does not exist/);
    } finally {
      result.unmount();
    }
  });
});

describe("ExportPage — success card actions", () => {
  beforeEach(() => {
    mockFetch.mockClear();
    (toast.error as ReturnType<typeof vi.fn>).mockClear();
    (toast.success as ReturnType<typeof vi.fn>).mockClear();
    delete (window as unknown as { scriptr?: unknown }).scriptr;
  });

  async function buildOnce(buildPath: string) {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: { isElectron: true, defaultExportDir: undefined },
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          ok: true,
          data: { path: buildPath, bytes: 12345, version: 3, warnings: [] },
        }),
      } as unknown as Response);

    let result!: ReturnType<typeof mount>;
    await act(async () => {
      result = mount(<ExportPage story={baseStory} chapterCount={1} wordCount={500} />);
    });
    const buildBtn = result.container.querySelector<HTMLButtonElement>(
      '[data-testid="export-build"]',
    );
    await act(async () => {
      buildBtn!.click();
    });
    return result;
  }

  it("Reveal/Open buttons are hidden when window.scriptr is absent", async () => {
    const result = await buildOnce("/Users/chase/Books/x-epub3.epub");
    try {
      expect(result.container.querySelector('[data-testid="export-reveal-3"]')).toBeNull();
      expect(result.container.querySelector('[data-testid="export-open-3"]')).toBeNull();
      // Copy path is always present
      expect(result.container.querySelector('[data-testid="export-copy-path-3"]')).not.toBeNull();
    } finally {
      result.unmount();
    }
  });

  it("Reveal/Open buttons are present when window.scriptr exists, and call the bridge", async () => {
    const revealInFolder = vi.fn().mockResolvedValue(undefined);
    const openFile = vi.fn().mockResolvedValue(undefined);
    (window as unknown as { scriptr: unknown }).scriptr = {
      pickFolder: vi.fn(),
      revealInFolder,
      openFile,
    };
    const result = await buildOnce("/Users/chase/Books/x-epub3.epub");
    try {
      const reveal = result.container.querySelector<HTMLButtonElement>(
        '[data-testid="export-reveal-3"]',
      );
      const open = result.container.querySelector<HTMLButtonElement>(
        '[data-testid="export-open-3"]',
      );
      expect(reveal).not.toBeNull();
      expect(open).not.toBeNull();
      await act(async () => { reveal!.click(); });
      expect(revealInFolder).toHaveBeenCalledWith("/Users/chase/Books/x-epub3.epub");
      await act(async () => { open!.click(); });
      expect(openFile).toHaveBeenCalledWith("/Users/chase/Books/x-epub3.epub");
    } finally {
      result.unmount();
    }
  });

  it("Copy path writes to clipboard and toasts", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const result = await buildOnce("/Users/chase/Books/x-epub3.epub");
    try {
      const copy = result.container.querySelector<HTMLButtonElement>(
        '[data-testid="export-copy-path-3"]',
      );
      await act(async () => { copy!.click(); });
      expect(writeText).toHaveBeenCalledWith("/Users/chase/Books/x-epub3.epub");
      expect((toast.success as ReturnType<typeof vi.fn>).mock.calls.some(
        (c) => /[Cc]opied/.test(String(c[0])),
      )).toBe(true);
    } finally {
      result.unmount();
    }
  });
});
