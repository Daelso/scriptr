/**
 * Copy-prompt E2E: create story → add a chapter with beats → open editor
 * → click "Copy prompt" → verify dialog content → click Copy → verify toast.
 *
 * Runs against the isolated dev server on port 3001 with SCRIPTR_DATA_DIR=/tmp/scriptr-e2e
 * (see playwright.config.ts). No Grok traffic — this feature has no external surface.
 */
import { test, expect } from "@playwright/test";

test("copy prompt dialog opens, renders preview, copy action fires a toast", async ({
  page,
}) => {
  // Seed a story.
  const createRes = await page.request.post(
    "http://127.0.0.1:3001/api/stories",
    { data: { title: "Copy Prompt E2E", authorPenName: "Test Author" } },
  );
  expect(createRes.ok()).toBeTruthy();
  const { data: story } = (await createRes.json()) as {
    data: { slug: string };
  };

  // Put a minimal bible.
  await page.request.put(
    `http://127.0.0.1:3001/api/stories/${story.slug}/bible`,
    {
      data: {
        characters: [{ name: "Alice", description: "curious cat" }],
        setting: "attic",
        pov: "third-limited",
        tone: "whimsical",
        styleNotes: "",
        nsfwPreferences: "",
      },
    },
  );

  // Add a chapter.
  const chapterRes = await page.request.post(
    `http://127.0.0.1:3001/api/stories/${story.slug}/chapters`,
    { data: { title: "Opening" } },
  );
  expect(chapterRes.ok()).toBeTruthy();
  const { data: chapter } = (await chapterRes.json()) as {
    data: { id: string };
  };

  // Set beats on the chapter via PATCH (NewChapterInput doesn't accept beats).
  const patchRes = await page.request.patch(
    `http://127.0.0.1:3001/api/stories/${story.slug}/chapters/${chapter.id}`,
    { data: { beats: ["Alice wakes up"] } },
  );
  expect(patchRes.ok()).toBeTruthy();

  // Navigate to the editor.
  await page.goto(`http://127.0.0.1:3001/s/${story.slug}`);

  // The empty state shows both Generate and Copy prompt.
  const copyPromptBtn = page.getByRole("button", { name: /copy prompt/i });
  await expect(copyPromptBtn).toBeVisible();
  await copyPromptBtn.click();

  // Dialog opens — preview contains the expected sections.
  await expect(page.getByText("Copy chapter prompt")).toBeVisible();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("# Story bible");
  await expect(dialog).toContainText("# Prior chapter recaps");
  await expect(dialog).toContainText("# Current chapter:");
  await expect(dialog).toContainText("Alice wakes up");

  // Click Copy. Either the success toast ("Prompt copied") or the fallback
  // toast ("Select and copy manually…") is acceptable — Chromium's clipboard
  // permission under Playwright is flaky.
  await dialog.getByRole("button", { name: /^copy$/i }).click();
  await expect(
    page
      .getByText(/Prompt copied|Select and copy manually/)
      .first(),
  ).toBeVisible({ timeout: 5_000 });
});
