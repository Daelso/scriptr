import { test, expect } from "@playwright/test";
import { join } from "node:path";
import { rm } from "node:fs/promises";

const FIXTURE = join(
  __dirname,
  "..",
  "..",
  "lib",
  "novelai",
  "__fixtures__",
  "sample.story"
);

test.describe("NovelAI .story import", () => {
  // Match golden-path.spec.ts: wipe the e2e data dir before the run so slug
  // derivation is deterministic across reruns (otherwise the second run
  // creates "garden-at-dusk-2").
  test.beforeAll(async () => {
    await rm("/tmp/scriptr-e2e", { recursive: true, force: true });
  });

  test("imports a .story file wholesale into a new story", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /import from novelai/i }).first().click();

    // Drive the hidden file input directly.
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(FIXTURE);

    // Preview renders; title prefilled from the fixture.
    // getByDisplayValue is not available in this Playwright version — use
    // toHaveValue on the first visible textbox in the preview panel instead.
    await expect(page.getByRole("textbox").first()).toHaveValue("Garden at Dusk", {
      timeout: 10_000,
    });

    // Chapter-list split-source badge proves the //// marker was honored.
    await expect(page.getByText(/split by \/\/\/\/ markers/i)).toBeVisible();

    await page.getByRole("button", { name: /create story/i }).click();

    // Redirect to the story editor. The URL may include a ?chapter= query
    // param, so match the slug before any optional query string.
    await expect(page).toHaveURL(/\/s\/garden-at-dusk(\?.*)?$/, { timeout: 15_000 });

    // The editor opens on chapter 1. Chapter 1 content from the fixture is
    // visible in the section editor (the garden prose before the //// split).
    await expect(page.getByText(/The garden at dusk/i).first()).toBeVisible({
      timeout: 10_000,
    });

    // Click chapter 2 in the chapter list to load its content. Chapter 2
    // contains "Chapter 2: Morning" as inline prose (the //// split placed it
    // at the top of the second chapter body).
    await page.getByText("02").click();

    // Editor shows fixture-specific prose from chapter 2.
    await expect(page.getByText(/Chapter 2: Morning/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
