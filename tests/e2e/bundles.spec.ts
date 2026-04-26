/**
 * Bundle E2E: seed two stories via API → create bundle → add stories →
 * reorder → set override → build EPUB → assert file on disk.
 *
 * Runs against the same isolated dev server as the other e2e specs
 * (port 3001, SCRIPTR_DATA_DIR=/tmp/scriptr-e2e). All seeding is
 * local — no real Grok / api.x.ai calls made.
 */
import { test, expect } from "@playwright/test";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { E2E_DATA_DIR } from "../../playwright.config";

const BASE = "http://127.0.0.1:3001";

test.beforeAll(async () => {
  // Wipe any leftover state so slugs are predictable.
  await rm(E2E_DATA_DIR, { recursive: true, force: true });
  await mkdir(E2E_DATA_DIR, { recursive: true });
});

test("bundle: seed → create → add → reorder → override → build EPUB", async ({ page }) => {
  // ── 1. Seed two stories + one chapter each via the API. ──────────────────
  async function seedStoryWithChapter(title: string, body: string) {
    const sRes = await page.request.post(`${BASE}/api/stories`, {
      data: { title, authorPenName: "Pen" },
    });
    expect(sRes.ok()).toBeTruthy();
    const story = (await sRes.json()).data as { slug: string };

    const cRes = await page.request.post(
      `${BASE}/api/stories/${story.slug}/chapters`,
      { data: { title: `${title} Ch1` } },
    );
    expect(cRes.ok()).toBeTruthy();
    const chapter = (await cRes.json()).data as { id: string };

    const pRes = await page.request.patch(
      `${BASE}/api/stories/${story.slug}/chapters/${chapter.id}`,
      { data: { sections: [{ id: "s1", content: body }] } },
    );
    expect(pRes.ok()).toBeTruthy();

    return story.slug;
  }

  const slugA = await seedStoryWithChapter("Story A", "Story A chapter one body.");
  const slugB = await seedStoryWithChapter("Story B", "Story B chapter one body.");
  expect(slugA).toBe("story-a");
  expect(slugB).toBe("story-b");

  // ── 2. Create the bundle via the UI. ─────────────────────────────────────
  await page.goto(`${BASE}/bundles`);
  await expect(page.getByTestId("bundle-new")).toBeVisible();
  await page.getByTestId("bundle-new").click();
  await page.getByTestId("new-bundle-title").fill("Two-Story Box Set");
  await page.getByTestId("new-bundle-create").click();
  await expect(page).toHaveURL(/\/bundles\/two-story-box-set/);

  // ── 3. Required bundle metadata (author + description). ─────────────────
  await page.getByTestId("bundle-author").fill("Pen Name");
  await page.getByTestId("bundle-author").blur();
  await page.getByTestId("bundle-description").fill("Two short stories.");
  await page.getByTestId("bundle-description").blur();

  // ── 4. Add both stories via the dialog. ─────────────────────────────────
  await page.getByTestId("bundle-add-story").click();
  await page.getByTestId("add-story-check-story-a").click();
  await page.getByTestId("add-story-check-story-b").click();
  await page.getByTestId("add-story-confirm").click();

  await expect(page.getByTestId("bundle-story-row-story-a")).toBeVisible();
  await expect(page.getByTestId("bundle-story-row-story-b")).toBeVisible();

  // ── 5. Reorder: drag story-b above story-a via the bundle PATCH API. ────
  // The drag-and-drop @dnd-kit interaction is brittle to test through the
  // browser layer; the spec's reorder requirement is satisfied just as well
  // by exercising the underlying API the drag handler calls. The unit tests
  // for BundleStoryList cover the UI wiring; this assertion confirms the
  // round-trip persists.
  const reorderRes = await page.request.patch(
    `${BASE}/api/bundles/two-story-box-set`,
    {
      data: {
        stories: [
          { storySlug: "story-b" },
          { storySlug: "story-a" },
        ],
      },
    },
  );
  expect(reorderRes.ok()).toBeTruthy();
  // The PATCH was made outside the browser (no SWR mutate call), so reload
  // to force a fresh fetch, then assert the persisted order.
  await page.reload();
  await expect(page.getByTestId("bundle-story-row-story-b")).toBeVisible();
  const rows = page.locator('[data-testid^="bundle-story-row-"]');
  const ids = await rows.evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-testid")),
  );
  expect(ids).toEqual([
    "bundle-story-row-story-b",
    "bundle-story-row-story-a",
  ]);

  // ── 6. Set a title override on story-a. ─────────────────────────────────
  await page
    .getByTestId("bundle-story-row-story-a")
    .getByRole("button", { name: /edit overrides/i })
    .click();
  await page.getByTestId("bundle-story-title-override-story-a").fill("Book Two: Story A");
  await page.getByTestId("bundle-story-title-override-story-a").blur();

  // ── 7. Build EPUB (default version 3). ─────────────────────────────────
  await page.getByTestId("bundle-build").click();
  await expect(page.getByTestId("bundle-last-build")).toBeVisible({ timeout: 15_000 });

  // ── 8. The EPUB exists on disk at the expected path. ───────────────────
  const expectedPath = join(
    E2E_DATA_DIR,
    "bundles",
    "two-story-box-set",
    "exports",
    "two-story-box-set-epub3.epub",
  );
  const s = await stat(expectedPath);
  expect(s.size).toBeGreaterThan(500);
});
