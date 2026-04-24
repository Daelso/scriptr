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

  test("imports a .story file with //// into multiple stories", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /import from novelai/i }).first().click();

    // Drive the hidden file input directly.
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(FIXTURE);

    // The fixture has a `////` marker, so the preview shows two story-cards.
    await expect(page.locator('[data-testid="story-card-0"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="story-card-1"]')).toBeVisible();

    // Story 1 keeps the mapped title with a "Part 1" suffix; Story 2 is "Part 2".
    await expect(
      page.locator('input[value="Garden at Dusk - Part 1"]')
    ).toBeVisible();
    await expect(
      page.locator('input[value="Garden at Dusk - Part 2"]')
    ).toBeVisible();

    // Commit: "Create 2 stories".
    await page.getByRole("button", { name: /create 2 stories/i }).click();

    // Redirects to the first story's editor.
    await expect(page).toHaveURL(
      /\/s\/garden-at-dusk-part-1(\?.*)?$/,
      { timeout: 15_000 }
    );

    // The editor opens on the first chapter; fixture-specific prose is visible.
    await expect(page.getByText(/The garden at dusk/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
