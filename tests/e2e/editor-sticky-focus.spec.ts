/**
 * Sticky focus E2E — click into a section, blur to the metadata pane, assert
 * the Tiptap editor stays mounted. Click another section, assert swap. Press
 * Esc, assert no editor is mounted. Fresh story per run (reuses the
 * isolated /tmp/scriptr-e2e data dir via the project's playwright config).
 */
import { test, expect } from "@playwright/test";
import { mkdir, rm } from "node:fs/promises";
import { E2E_DATA_DIR } from "../../playwright.config";

test.beforeAll(async () => {
  await rm(E2E_DATA_DIR, { recursive: true, force: true });
  await mkdir(E2E_DATA_DIR, { recursive: true });
});

test("editor stays mounted across metadata-pane blur and swaps between sections", async ({
  page,
  request,
}) => {
  // ── 1. Create story (UI — mirrors golden-path.spec.ts steps 3-4) ─────────
  await page.goto("/");
  await expect(page.getByRole("button", { name: "New story" }).first()).toBeVisible();
  await page.getByRole("button", { name: "New story" }).first().click();
  await expect(page.getByLabel("Title")).toBeVisible();
  await page.getByLabel("Title").fill("Sticky Focus E2E");
  await page.getByRole("button", { name: "Create story" }).click();
  await page.waitForURL(/\/s\/[^/]+(\?.*)?$/, { timeout: 15_000 });
  const slug = page.url().match(/\/s\/([^/?]+)/)![1];

  // ── 2. Add a chapter titled "Sticky" (UI — mirrors golden-path step 6) ───
  await expect(page.getByText("Chapters")).toBeVisible();
  await page.getByRole("button", { name: "New chapter" }).click();
  const chapterInput = page.getByPlaceholder("Chapter title…");
  await expect(chapterInput).toBeVisible();
  await chapterInput.fill("Sticky");
  await chapterInput.press("Enter");

  // Wait for the chapter POST to complete and the chapter to be selected
  // (editor pane shows "Generate chapter" when a chapter has zero sections).
  await expect(page.getByRole("button", { name: "Generate chapter" })).toBeVisible({
    timeout: 10_000,
  });

  // ── 3. Grab the chapter id from the listing API, PATCH in two sections ───
  const listRes = await request.get(`/api/stories/${slug}/chapters`);
  const listJson = (await listRes.json()) as { ok: boolean; data: { id: string }[] };
  expect(listJson.ok).toBe(true);
  const chapterId = listJson.data[0].id;

  const patchRes = await request.patch(
    `/api/stories/${slug}/chapters/${chapterId}`,
    {
      data: {
        sections: [
          { id: "sec-A", content: "Section A body — click into the middle." },
          { id: "sec-B", content: "Section B body — swap target." },
        ],
      },
    },
  );
  expect(patchRes.ok()).toBe(true);

  // ── 4. Reload the editor so SWR picks up the new sections ────────────────
  await page.goto(`/s/${slug}?chapter=${chapterId}`);
  await expect(page.getByText("Section A body")).toBeVisible();
  await expect(page.getByText("Section B body")).toBeVisible();

  // ── 5. Click into section A's prose at a specific character offset ───────
  // `:has-text(...)` selects an <article> whose descendant text matches.
  const sectionA = page.locator('article:has-text("Section A body")').first();
  await sectionA.locator('[aria-label="Edit section"]').click({ position: { x: 60, y: 8 } });
  // Tiptap attaches the `ProseMirror` class to the contenteditable node it
  // applies the `editorProps.attributes` to — i.e. the node carrying our
  // `aria-label="Edit section"` label while editable. Scope the match.
  await expect(sectionA.locator('[aria-label="Edit section"].ProseMirror')).toBeVisible();

  // ── 6. Blur to the right-side metadata pane ──────────────────────────────
  // MetadataPane renders a Chapter Summary textarea with a stable
  // `id="chapter-summary"` (see components/editor/SummaryField.tsx:72). Click
  // it to take focus off the editor.
  await page.locator("#chapter-summary").click();

  // Editor must STILL be mounted on section A. This is the whole point.
  await expect(sectionA.locator('[aria-label="Edit section"].ProseMirror')).toBeVisible();

  // ── 7. Click into section B ──────────────────────────────────────────────
  const sectionB = page.locator('article:has-text("Section B body")').first();
  await sectionB.locator('[aria-label="Edit section"]').click({ position: { x: 60, y: 8 } });
  await expect(sectionB.locator('[aria-label="Edit section"].ProseMirror')).toBeVisible();
  // Section A must have unmounted.
  await expect(sectionA.locator('[aria-label="Edit section"].ProseMirror')).toHaveCount(0);

  // ── 8. Esc exits edit mode ───────────────────────────────────────────────
  await page.keyboard.press("Escape");
  await expect(sectionB.locator('[aria-label="Edit section"].ProseMirror')).toHaveCount(0);
});
