import { test, expect } from "@playwright/test";
import { join } from "node:path";
import { rm } from "node:fs/promises";

const FIXTURE = join(
  __dirname,
  "..",
  "..",
  "lib",
  "epub",
  "__fixtures__",
  "sample-kdp.epub",
);

test.describe("EPUB import", () => {
  // Match novelai-import.spec.ts: wipe e2e data dir before the run so slug
  // derivation is deterministic across reruns.
  test.beforeAll(async () => {
    await rm("/tmp/scriptr-e2e", { recursive: true, force: true });
  });

  test("imports a KDP-shaped EPUB into a new story with cover and 3 chapters", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /import from epub/i }).first().click();

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(FIXTURE);

    // Preview renders. Three "real" chapters + three "skipped" boilerplate.
    await expect(page.locator('input[value="The Garden Wall"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/copyright/i).first()).toBeVisible();
    await expect(page.getByText(/about the author/i).first()).toBeVisible();
    await expect(page.locator('img[alt="Cover"]')).toBeVisible();

    // Click "Create story". Default-skipped chapters stay unchecked → 3 imported.
    await page.getByRole("button", { name: /create story/i }).click();

    await expect(page).toHaveURL(/\/s\/the-garden-wall(\?.*)?$/, { timeout: 15_000 });

    // Editor opens; fixture-specific prose is visible on the first real chapter.
    await expect(page.getByText(/Mira stepped through the gate/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
