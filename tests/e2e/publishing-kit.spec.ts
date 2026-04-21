/**
 * Publishing Kit E2E: create story → open import dialog → paste prose →
 * verify preview → save chapter → navigate to export → fill metadata →
 * build EPUB → assert file on disk.
 *
 * Runs against the same isolated dev server as golden-path.spec.ts
 * (port 3001, SCRIPTR_DATA_DIR=/tmp/scriptr-e2e). No real Grok traffic:
 * the recap opt-in is left off, and paste-import + EPUB build are
 * fully local (privacy smoke test enforces this elsewhere).
 */
import { test, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { E2E_DATA_DIR } from "../../playwright.config";

const SAMPLE_PASTE = `Sure, here's the chapter:

Chapter 1: Opening

She walked in -- slowly -- and said "hi."

* * *

He replied, 'later.'

Let me know what you think!`;

test("import paste \u2192 preview \u2192 save \u2192 export EPUB on disk", async ({
  page,
}) => {
  // The webServer launched by playwright.config exports E2E_DATA_DIR and
  // passes it to the dev server as SCRIPTR_DATA_DIR. The test process itself
  // sees E2E_DATA_DIR directly — use it (not process.env) so the assertion
  // doesn't depend on the test runner inheriting the child env.
  const DATA_DIR = E2E_DATA_DIR;
  expect(DATA_DIR).toBeTruthy();

  // Seed a story via the API.
  const createRes = await page.request.post(
    "http://127.0.0.1:3001/api/stories",
    {
      data: { title: "Publishing Kit E2E", authorPenName: "Test Author" },
    },
  );
  expect(createRes.ok()).toBeTruthy();
  const createBody = await createRes.json();
  const story = createBody.data as { slug: string };

  await page.goto(`http://127.0.0.1:3001/s/${story.slug}`);

  await page.getByRole("button", { name: /import chapter/i }).click();

  await page.getByTestId("import-paste").fill(SAMPLE_PASTE);

  // Preview populated — scope to .epub-preview since "Chapter 1" also
  // appears in the paste textarea (raw source) which would make the
  // locator ambiguous.
  const preview = page.locator(".epub-preview").first();
  await expect(preview).toContainText("Chapter 1");
  await expect(preview).toContainText("\u2014");

  await page.getByTestId("import-save").click();

  // Dialog closes once save completes — wait for it so the preview pane
  // unmounts and "Opening" is no longer ambiguous (it lives in the paste
  // textarea and preview during save).
  await expect(page.getByText("Import chapter from paste")).toBeHidden({
    timeout: 10_000,
  });

  // Chapter appears in the chapter list. Use exact match + .first() to
  // disambiguate from the transient Sonner toast ("Imported \"Opening\".")
  // which also contains the word.
  await expect(
    page.getByText("Opening", { exact: true }).first(),
  ).toBeVisible();

  // Navigate to export
  await page.goto(`http://127.0.0.1:3001/s/${story.slug}/export`);

  const descField = page.getByTestId("export-description");
  await descField.fill("A tiny end-to-end test book.");
  await descField.blur();

  await page.getByTestId("export-build").click();

  // Success UI
  await expect(page.getByText(/Built \d+ KB/)).toBeVisible({ timeout: 15_000 });

  // File on disk
  const epubPath = join(
    DATA_DIR,
    "stories",
    story.slug,
    "exports",
    `${story.slug}.epub`,
  );
  expect(existsSync(epubPath)).toBe(true);
});
