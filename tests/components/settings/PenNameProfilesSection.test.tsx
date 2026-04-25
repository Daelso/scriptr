// @vitest-environment jsdom
/**
 * Tests for PenNameProfilesSection — the settings page section that lets
 * users edit per-pen-name profile data (email, mailing-list URL, default
 * rich-text message). Uses the project's manual React-19 render harness
 * (no @testing-library/react), mirroring the pattern in
 * tests/components/editor/SectionCard.test.tsx.
 *
 * The RichTextEditor is mocked so we don't drag TipTap's editor into the
 * settings tests — a simple textarea stand-in is enough to verify the wiring.
 */
import { describe, it, expect, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

vi.mock("@/components/editor/RichTextEditor", () => ({
  RichTextEditor: ({
    initialHtml,
    onChange,
    ariaLabel,
  }: {
    initialHtml: string;
    onChange: (html: string) => void;
    ariaLabel?: string;
  }) => (
    <textarea
      aria-label={ariaLabel ?? "Rich text editor"}
      defaultValue={initialHtml}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

import { PenNameProfilesSection } from "@/components/settings/PenNameProfilesSection";

type Mounted = {
  container: HTMLDivElement;
  root: Root;
  unmount: () => void;
  rerender: (element: React.ReactElement) => void;
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
  const rerender = (el: React.ReactElement) => {
    act(() => {
      root.render(el);
    });
  };
  return { container, root, unmount, rerender };
}

function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    input instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("PenNameProfilesSection", () => {
  it("renders existing profiles as cards", () => {
    const { container, unmount } = mount(
      <PenNameProfilesSection
        profiles={{ "Jane Doe": { email: "j@x", mailingListUrl: "https://l" } }}
        knownPenNames={["Jane Doe", "John Smith"]}
        onSave={vi.fn()}
      />,
    );

    // Jane Doe pen name label is in the DOM.
    expect(container.textContent).toContain("Jane Doe");
    expect(container.textContent).toContain("John Smith");

    // Email input for Jane Doe holds the existing value.
    const janeEmail = container.querySelector(
      '[data-testid="pen-email-jane-doe"]',
    ) as HTMLInputElement | null;
    expect(janeEmail).not.toBeNull();
    expect(janeEmail!.value).toBe("j@x");

    // Mailing-list URL is also wired up.
    const janeMail = container.querySelector(
      '[data-testid="pen-mailing-jane-doe"]',
    ) as HTMLInputElement | null;
    expect(janeMail).not.toBeNull();
    expect(janeMail!.value).toBe("https://l");

    // John Smith has a card with empty fields.
    const johnEmail = container.querySelector(
      '[data-testid="pen-email-john-smith"]',
    ) as HTMLInputElement | null;
    expect(johnEmail).not.toBeNull();
    expect(johnEmail!.value).toBe("");

    unmount();
  });

  it("calls onSave with the full profiles object when Save is clicked", () => {
    const onSave = vi.fn();
    const { container, unmount } = mount(
      <PenNameProfilesSection
        profiles={{ "Jane Doe": {} }}
        knownPenNames={["Jane Doe"]}
        onSave={onSave}
      />,
    );

    const emailInput = container.querySelector(
      '[data-testid="pen-email-jane-doe"]',
    ) as HTMLInputElement;
    expect(emailInput).not.toBeNull();
    act(() => {
      setInputValue(emailInput, "jane@example.com");
    });

    const saveBtn = container.querySelector(
      '[data-testid="pen-save-jane-doe"]',
    ) as HTMLButtonElement;
    expect(saveBtn).not.toBeNull();
    act(() => {
      saveBtn.click();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    const arg = onSave.mock.calls[0][0] as Record<string, { email?: string }>;
    expect(arg["Jane Doe"]).toBeDefined();
    expect(arg["Jane Doe"].email).toBe("jane@example.com");

    unmount();
  });

  it("supports adding a new pen name profile", () => {
    const onSave = vi.fn();
    const { container, unmount } = mount(
      <PenNameProfilesSection
        profiles={{}}
        knownPenNames={[]}
        onSave={onSave}
      />,
    );

    const newInput = container.querySelector(
      '[data-testid="pen-name-new"]',
    ) as HTMLInputElement;
    expect(newInput).not.toBeNull();
    act(() => {
      setInputValue(newInput, "Casey Lane");
    });

    const addBtn = container.querySelector(
      '[data-testid="pen-name-add"]',
    ) as HTMLButtonElement;
    expect(addBtn).not.toBeNull();
    act(() => {
      addBtn.click();
    });

    // A card for "Casey Lane" should now exist.
    expect(container.textContent).toContain("Casey Lane");
    const caseyEmail = container.querySelector(
      '[data-testid="pen-email-casey-lane"]',
    );
    expect(caseyEmail).not.toBeNull();

    unmount();
  });

  it("calls onDelete when a profile's delete button is clicked", () => {
    const onDelete = vi.fn();
    const { container, unmount } = mount(
      <PenNameProfilesSection
        profiles={{ "Jane Doe": { email: "j@x" } }}
        knownPenNames={["Jane Doe"]}
        onSave={vi.fn()}
        onDelete={onDelete}
      />,
    );

    const deleteBtn = container.querySelector(
      '[data-testid="pen-delete-jane-doe"]',
    ) as HTMLButtonElement;
    expect(deleteBtn).not.toBeNull();
    act(() => {
      deleteBtn.click();
    });

    expect(onDelete).toHaveBeenCalledWith("Jane Doe");
    unmount();
  });

  it("does not show a Delete button for freshly-added pen names that have not been saved yet", () => {
    const { container, unmount } = mount(
      <PenNameProfilesSection
        profiles={{}}
        knownPenNames={[]}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const newInput = container.querySelector(
      '[data-testid="pen-name-new"]',
    ) as HTMLInputElement;
    act(() => {
      setInputValue(newInput, "Casey Lane");
    });
    const addBtn = container.querySelector(
      '[data-testid="pen-name-add"]',
    ) as HTMLButtonElement;
    act(() => {
      addBtn.click();
    });

    // The freshly added pen name has no saved profile entry, so no delete button.
    const deleteBtn = container.querySelector(
      '[data-testid="pen-delete-casey-lane"]',
    );
    expect(deleteBtn).toBeNull();

    unmount();
  });
});
