import { test, expect } from "@playwright/test";
import { writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FIXTURE = join(tmpdir(), "scriptr-e2e-fixture-multistory.txt");

// Two stories separated by `////`, each with a `***` chapter break inside.
// The title on commit comes from the filename so slugs are deterministic.
const MULTISTORY_CONTENT = [
  "Opening of the first tale.",
  "",
  "***",
  "",
  "Second act of the first tale.",
  "",
  "////",
  "",
  "A very different second tale begins.",
  "",
  "***",
  "",
  "The second tale continues to its close.",
].join("\n");

test.describe("NovelAI multi-story import", () => {
  // Wipe the e2e data dir so slug derivation is deterministic across reruns.
  test.beforeAll(async () => {
    await rm("/tmp/scriptr-e2e", { recursive: true, force: true });
    await writeFile(FIXTURE, MULTISTORY_CONTENT, "utf-8");
  });

  test("creates N separate stories from one //// file", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /import from novelai/i }).first().click();

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(FIXTURE);

    // Two story cards render in the preview.
    await expect(page.locator('[data-testid="story-card-0"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="story-card-1"]')).toBeVisible();

    // Commit button label reflects the multi-story count.
    const createBtn = page.getByRole("button", { name: /create 2 stories/i });
    await expect(createBtn).toBeVisible();
    await createBtn.click();

    // Navigates to the first story's editor.
    await expect(page).toHaveURL(
      /\/s\/scriptr-e2e-fixture-multistory-part-1(\?.*)?$/,
      { timeout: 15_000 }
    );

    // Verify both stories exist by visiting the home page.
    await page.goto("/");
    await expect(
      page.getByText(/scriptr-e2e-fixture-multistory - Part 1/i)
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText(/scriptr-e2e-fixture-multistory - Part 2/i)
    ).toBeVisible();
  });
});
