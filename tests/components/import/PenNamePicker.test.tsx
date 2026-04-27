// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { PenNamePicker } from "@/components/import/PenNamePicker";
import type { PenNameProfile } from "@/lib/config";

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

const profile = (over: Partial<PenNameProfile> = {}): PenNameProfile => ({
  email: "",
  mailingListUrl: "",
  defaultMessageHtml: "",
  ...over,
});

describe("PenNamePicker", () => {
  it("renders a plain input + helper link when no profiles exist", () => {
    const onChange = vi.fn();
    const { container, unmount } = mount(
      <PenNamePicker profiles={{}} value="" onChange={onChange} />,
    );

    const select = container.querySelector('[data-testid="pen-name-select"]');
    expect(select).toBeNull();

    const input = container.querySelector(
      '[data-testid="pen-name-input"]',
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(container.textContent).toContain("No saved profiles");

    unmount();
  });

  it("treats undefined profiles the same as empty", () => {
    const { container, unmount } = mount(
      <PenNamePicker profiles={undefined} value="" onChange={vi.fn()} />,
    );
    expect(
      container.querySelector('[data-testid="pen-name-input"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="pen-name-select"]'),
    ).toBeNull();
    unmount();
  });

  it("renders a <select> with one <option> per profile when profiles exist", () => {
    // Mount with a matching value so the placeholder isn't selected; avoids
    // React's "value not in options" warning cluttering test output.
    const { container, unmount } = mount(
      <PenNamePicker
        profiles={{ "Sarah Thorne": profile(), "Natalie Knot": profile() }}
        value="Sarah Thorne"
        onChange={vi.fn()}
      />,
    );
    const select = container.querySelector(
      '[data-testid="pen-name-select"]',
    ) as HTMLSelectElement | null;
    expect(select).not.toBeNull();

    const optionTexts = Array.from(select!.querySelectorAll("option")).map(
      (o) => o.textContent,
    );
    expect(optionTexts).toContain("Sarah Thorne");
    expect(optionTexts).toContain("Natalie Knot");
    expect(optionTexts).toContain("Custom…");
    expect(optionTexts).toContain("Choose pen name…");

    unmount();
  });

  it("emits onChange with the selected profile name", () => {
    const onChange = vi.fn();
    const { container, unmount } = mount(
      <PenNamePicker
        profiles={{ "Sarah Thorne": profile() }}
        value=""
        onChange={onChange}
      />,
    );
    const select = container.querySelector(
      '[data-testid="pen-name-select"]',
    ) as HTMLSelectElement;
    act(() => {
      select.value = "Sarah Thorne";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("Sarah Thorne");
    unmount();
  });

  it("switches to custom mode and clears value when 'Custom…' is picked", () => {
    const onChange = vi.fn();
    const { container, unmount } = mount(
      <PenNamePicker
        profiles={{ "Sarah Thorne": profile() }}
        value="Sarah Thorne"
        onChange={onChange}
      />,
    );
    const select = container.querySelector(
      '[data-testid="pen-name-select"]',
    ) as HTMLSelectElement;
    // The "Custom…" option's value is an opaque sentinel (containing NULs to
    // avoid colliding with any user-typeable profile name). Look it up by
    // visible text rather than hardcoding it.
    const customOption = Array.from(select.querySelectorAll("option")).find(
      (o) => o.textContent === "Custom…",
    ) as HTMLOptionElement;
    expect(customOption).toBeDefined();
    act(() => {
      select.value = customOption.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("");

    // The input appears because the picker's *own* mode state flipped to
    // "custom" — the parent in this test never re-renders with the new
    // value. The DOM input still shows the prop value ("Sarah Thorne") since
    // the parent hasn't propagated the cleared string yet; we don't assert
    // input.value because it depends on the parent's re-render behavior.
    const input = container.querySelector(
      '[data-testid="pen-name-input"]',
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();

    unmount();
  });

  it("emits onChange per keystroke in custom mode", () => {
    const onChange = vi.fn();
    const { container, unmount } = mount(
      <PenNamePicker
        profiles={{ "Sarah Thorne": profile() }}
        value="Made Up Name"
        onChange={onChange}
      />,
    );
    const input = container.querySelector(
      '[data-testid="pen-name-input"]',
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    // React tracks controlled-input values via an internal value tracker,
    // so plain `input.value = ...` is silently swallowed. Use the native
    // setter — same pattern as tests/components/editor/SectionCard.test.tsx
    // and tests/components/import/ChapterEditList.test.tsx.
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    act(() => {
      nativeSetter.call(input, "Made Up Names");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("Made Up Names");
    unmount();
  });

  it("reverts to saved mode and clears value when 'Use saved profile' is clicked", () => {
    const onChange = vi.fn();
    const { container, unmount } = mount(
      <PenNamePicker
        profiles={{ "Sarah Thorne": profile() }}
        value="Made Up Name"
        onChange={onChange}
      />,
    );
    // Mounts in custom mode (value doesn't match a profile key).
    expect(
      container.querySelector('[data-testid="pen-name-input"]'),
    ).not.toBeNull();

    const revertBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Use saved profile",
    ) as HTMLButtonElement;
    expect(revertBtn).toBeDefined();
    act(() => {
      revertBtn.click();
    });

    expect(onChange).toHaveBeenCalledWith("");
    expect(
      container.querySelector('[data-testid="pen-name-select"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="pen-name-input"]'),
    ).toBeNull();
    unmount();
  });

  it("mounts in 'saved' mode when value matches a profile key", () => {
    const { container, unmount } = mount(
      <PenNamePicker
        profiles={{ "Sarah Thorne": profile() }}
        value="Sarah Thorne"
        onChange={vi.fn()}
      />,
    );
    const select = container.querySelector(
      '[data-testid="pen-name-select"]',
    ) as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    expect(select!.value).toBe("Sarah Thorne");
    unmount();
  });

  it("mounts in 'custom' mode when value is non-empty and matches no profile", () => {
    const { container, unmount } = mount(
      <PenNamePicker
        profiles={{ "Sarah Thorne": profile() }}
        value="Made Up Name"
        onChange={vi.fn()}
      />,
    );
    expect(
      container.querySelector('[data-testid="pen-name-input"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="pen-name-select"]'),
    ).toBeNull();
    unmount();
  });
});
