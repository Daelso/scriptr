import { test, expect } from "@playwright/test";
import { join } from "node:path";
import { rm } from "node:fs/promises";

// Real NovelAI .txt export committed next to the repo root. Using the real
// file ensures we exercise the actual premise/[N/M]/{author-note} artifacts
// that production exports carry, plus short-dialogue lines like
// `"Dare," I said.` that the binary .story decoder drops.
const FIXTURE = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "Sorority Sissification (2026-04-24T14_16_27.902Z).txt"
);

test.describe("NovelAI .txt import", () => {
  // Wipe e2e data so the slug derivation is deterministic across reruns
  // (otherwise the second run creates "sorority-sissification-2").
  test.beforeAll(async () => {
    await rm("/tmp/scriptr-e2e", { recursive: true, force: true });
  });

  test("imports a .txt NovelAI export preserving short dialogue", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /import from novelai/i }).first().click();

    // Drive the hidden file input directly.
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(FIXTURE);

    // Preview renders with the title derived from the filename (timestamp
    // suffix stripped by titleFromFilename).
    await expect(page.getByRole("textbox").first()).toHaveValue(
      "Sorority Sissification",
      { timeout: 10_000 }
    );

    await page.getByRole("button", { name: /create story/i }).click();

    // Redirect to the story editor.
    await expect(page).toHaveURL(/\/s\/sorority-sissification(\?.*)?$/, {
      timeout: 15_000,
    });

    // Short dialogue the binary .story decoder would have dropped (too short
    // for its 60-char MIN_PROSE_LEN filter) must survive the .txt path.
    // `cleanPaste`'s `normalizeQuotes` turns straight quotes into curly ones,
    // so we match either form.
    await expect(
      page.getByText(/["“]Dare,["”] I said/).first()
    ).toBeVisible({ timeout: 10_000 });

    // The "huge messy paragraphs" fix: NovelAI exports paragraphs with single
    // `\n` separators. Scriptr renders each section as one `<p>` with
    // `white-space: pre-wrap`, so paragraph spacing comes from `\n\n` in the
    // text content (not from multiple `<p>` elements). Verify the rendered
    // section text has at least 2 paragraph breaks (blank lines) — a run-on
    // paragraph would have 0.
    const firstSectionText = await page
      .locator("main p.whitespace-pre-wrap")
      .first()
      .innerText();
    const paragraphBreaks = firstSectionText.split(/\n\s*\n/).length - 1;
    expect(paragraphBreaks).toBeGreaterThanOrEqual(2);
  });
});
