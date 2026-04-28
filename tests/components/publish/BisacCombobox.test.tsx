// tests/components/publish/BisacCombobox.test.tsx
// @vitest-environment jsdom
/**
 * Tests for BisacCombobox — uses manual React-19 mount harness
 * (no @testing-library/react by project rule).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { BisacEntry } from "@/lib/publish/bisac-types";

const FIXTURE: BisacEntry[] = [
  { c: "FIC000000", l: "FICTION / General" },
  { c: "FIC027000", l: "FICTION / Romance / Erotica" },
  { c: "FIC027010", l: "FICTION / Romance / Adult" },
  { c: "JUV000000", l: "JUVENILE FICTION / General" },
  { c: "COO000000", l: "COOKING / General" },
];

// Mock fetch — return FIXTURE for /bisac-codes.json by default.
// Use a distinct procedure-typed mock so the spread call below is callable
// (vitest's default `vi.fn()` is typed as `Procedure | Constructable`, which
// TS will not accept a call signature for).
let fetchImpl: ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>> = vi.fn<
  (...args: unknown[]) => unknown
>();
vi.stubGlobal(
  "fetch",
  ((...args: Parameters<typeof fetch>) => fetchImpl(...args)) as typeof fetch,
);

import { BisacCombobox } from "@/components/publish/BisacCombobox";

type Mounted = {
  container: HTMLDivElement;
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
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const okJson = (data: unknown) =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve(data),
  } as unknown as Response);

beforeEach(() => {
  fetchImpl = vi.fn().mockImplementation((url: string) => {
    if (typeof url === "string" && url.includes("bisac-codes.json")) {
      return okJson(FIXTURE);
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });
});

afterEach(() => {
  document.body.replaceChildren();
});

describe("BisacCombobox — trigger display states", () => {
  it("shows placeholder when value is empty", async () => {
    const { container, unmount } = mount(
      <BisacCombobox value="" onChange={() => {}} />,
    );
    try {
      const trigger = container.querySelector<HTMLElement>(
        '[data-testid="bisac-combobox-trigger"]',
      );
      expect(trigger).not.toBeNull();
      expect(trigger!.textContent).toContain("Select BISAC category");
    } finally {
      unmount();
    }
  });

  it("shows formatted label after JSON loads", async () => {
    const { container, unmount } = mount(
      <BisacCombobox value="FIC027000" onChange={() => {}} />,
    );
    try {
      await flushPromises();
      const trigger = container.querySelector<HTMLElement>(
        '[data-testid="bisac-combobox-trigger"]',
      );
      expect(trigger!.textContent).toContain("FIC027000");
      expect(trigger!.textContent).toContain("Romance / Erotica");
    } finally {
      unmount();
    }
  });

  it("shows raw code + 'not in current BISAC list' for unknown codes", async () => {
    const { container, unmount } = mount(
      <BisacCombobox value="ZZZ999999" onChange={() => {}} />,
    );
    try {
      await flushPromises();
      const trigger = container.querySelector<HTMLElement>(
        '[data-testid="bisac-combobox-trigger"]',
      );
      expect(trigger!.textContent).toContain("ZZZ999999");
      expect(trigger!.textContent).toContain("not in current BISAC list");
    } finally {
      unmount();
    }
  });
});

describe("BisacCombobox — popover and selection", () => {
  function openPopover(container: HTMLElement) {
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="bisac-combobox-trigger"]',
    );
    expect(trigger).not.toBeNull();
    act(() => {
      trigger!.click();
    });
  }

  function getInput(): HTMLInputElement {
    const input = document.querySelector<HTMLInputElement>(
      '[data-testid="bisac-combobox-input"]',
    );
    expect(input).not.toBeNull();
    return input!;
  }

  function getOptionRows(): HTMLElement[] {
    return Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid^="bisac-combobox-option-"]',
      ),
    );
  }

  function typeQuery(input: HTMLInputElement, q: string) {
    // React 19 controlled inputs only fire onChange when the value setter
    // goes through the React-tracked descriptor; direct assignment is a no-op.
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    act(() => {
      setter.call(input, q);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("opens popover with autofocused search input", async () => {
    const { container, unmount } = mount(
      <BisacCombobox value="FIC027000" onChange={() => {}} />,
    );
    try {
      await flushPromises();
      openPopover(container);
      await flushPromises();
      const input = getInput();
      expect(document.activeElement).toBe(input);
    } finally {
      unmount();
    }
  });

  it("filters by code prefix", async () => {
    const { container, unmount } = mount(
      <BisacCombobox value="" onChange={() => {}} />,
    );
    try {
      await flushPromises();
      openPopover(container);
      await flushPromises();
      typeQuery(getInput(), "fic027");
      await flushPromises();

      const codes = getOptionRows().map((el) =>
        el.getAttribute("data-testid")!.replace("bisac-combobox-option-", ""),
      );
      expect(codes).toEqual(["FIC027000", "FIC027010"]);
    } finally {
      unmount();
    }
  });

  it("filters by label tokens", async () => {
    const { container, unmount } = mount(
      <BisacCombobox value="" onChange={() => {}} />,
    );
    try {
      await flushPromises();
      openPopover(container);
      await flushPromises();
      typeQuery(getInput(), "erotica");
      await flushPromises();

      const codes = getOptionRows().map((el) =>
        el.getAttribute("data-testid")!.replace("bisac-combobox-option-", ""),
      );
      expect(codes).toEqual(["FIC027000"]);
    } finally {
      unmount();
    }
  });

  it("shows empty-state row when no matches", async () => {
    const { container, unmount } = mount(
      <BisacCombobox value="" onChange={() => {}} />,
    );
    try {
      await flushPromises();
      openPopover(container);
      await flushPromises();
      typeQuery(getInput(), "xyzzy");
      await flushPromises();

      expect(getOptionRows()).toHaveLength(0);
      const empty = document.querySelector(
        '[data-testid="bisac-combobox-empty"]',
      );
      expect(empty).not.toBeNull();
      expect(empty!.textContent).toContain("No BISAC codes match");
    } finally {
      unmount();
    }
  });

  it("calls onChange with the selected code", async () => {
    const onChange = vi.fn();
    const { container, unmount } = mount(
      <BisacCombobox value="" onChange={onChange} />,
    );
    try {
      await flushPromises();
      openPopover(container);
      await flushPromises();
      typeQuery(getInput(), "erotica");
      await flushPromises();

      const target = document.querySelector<HTMLElement>(
        '[data-testid="bisac-combobox-option-FIC027000"]',
      );
      expect(target).not.toBeNull();
      act(() => {
        target!.click();
      });

      expect(onChange).toHaveBeenCalledWith("FIC027000");
    } finally {
      unmount();
    }
  });

  it("shows error-state row when fetch fails", async () => {
    fetchImpl = vi.fn().mockRejectedValue(new Error("boom"));
    const { container, unmount } = mount(
      <BisacCombobox value="FIC027000" onChange={() => {}} />,
    );
    try {
      await flushPromises();
      openPopover(container);
      await flushPromises();
      const err = document.querySelector(
        '[data-testid="bisac-combobox-error"]',
      );
      expect(err).not.toBeNull();
      expect(err!.textContent).toContain("Failed to load BISAC list");
    } finally {
      unmount();
    }
  });

  it("highlights the previously-selected row when reopening", async () => {
    const { container, unmount } = mount(
      <BisacCombobox value="FIC027000" onChange={() => {}} />,
    );
    try {
      await flushPromises();
      openPopover(container);
      await flushPromises();
      const selected = document.querySelector<HTMLElement>(
        '[data-testid="bisac-combobox-option-FIC027000"][data-selected]',
      );
      expect(selected).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it("keyboard-only flow: type, ArrowDown, Enter selects", async () => {
    const onChange = vi.fn();
    const { container, unmount } = mount(
      <BisacCombobox value="" onChange={onChange} />,
    );
    try {
      await flushPromises();
      openPopover(container);
      await flushPromises();
      const input = getInput();
      typeQuery(input, "erotica");
      await flushPromises();
      act(() => {
        input.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
        );
      });
      act(() => {
        input.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
      });
      await flushPromises();
      expect(onChange).toHaveBeenCalledWith("FIC027000");
    } finally {
      unmount();
    }
  });

  it("caps unfiltered list at 200 entries with footer row", async () => {
    const big: BisacEntry[] = Array.from({ length: 250 }, (_, i) => ({
      c: `FIC${String(i).padStart(6, "0")}`,
      l: `FICTION / Test ${i}`,
    }));
    fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(big),
    } as unknown as Response);

    const { container, unmount } = mount(
      <BisacCombobox value="" onChange={() => {}} />,
    );
    try {
      await flushPromises();
      const trigger = container.querySelector<HTMLButtonElement>(
        '[data-testid="bisac-combobox-trigger"]',
      );
      act(() => trigger!.click());
      await flushPromises();
      expect(getOptionRows().length).toBe(200);
      const more = document.querySelector(
        '[data-testid="bisac-combobox-more"]',
      );
      expect(more).not.toBeNull();
      expect(more!.textContent).toContain("200+ more");
    } finally {
      unmount();
    }
  });
});
