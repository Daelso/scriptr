/**
 * Golden-path E2E: create story → add character → add chapter → generate →
 * assert two SectionCards → navigate to reader → assert prose.
 *
 * `/api/generate` is intercepted at the browser-fetch layer (Playwright's
 * page.route) so no real Grok / api.x.ai calls are made under any
 * circumstances.
 *
 * Architecture notes:
 * - The generate route runs server-side; page.route() only intercepts
 *   browser-issued fetches. The stub returns a canned SSE body; the real
 *   route handler is never invoked for this request, so no sections are
 *   persisted to disk by the stream.
 * - After `done`, EditorPane's SWR revalidation refetches
 *   /api/stories/${slug}/chapters/${chapterId}. We intercept this GET
 *   (post-generate) to return the canned sections so SectionCards render.
 * - The reader page (/s/${slug}/read) is server-rendered from disk, so we
 *   PATCH the chapter via the real API to persist sections before navigating
 *   to the reader.
 */
import { test, expect } from "@playwright/test";
import { mkdir, rm } from "node:fs/promises";
import { E2E_DATA_DIR } from "../../playwright.config";

// ─── Canned content ───────────────────────────────────────────────────────────

const SECTION_1 = "First section content.";
const SECTION_2 = "Second section content.";

// ─── SSE stub body ────────────────────────────────────────────────────────────
// Matches the wire format the client's eventsource-parser expects.
const SSE_BODY = [
  `data: ${JSON.stringify({ type: "start", jobId: "e2e-job" })}\n\n`,
  `data: ${JSON.stringify({ type: "token", text: `${SECTION_1}\n` })}\n\n`,
  `data: ${JSON.stringify({ type: "section-break" })}\n\n`,
  `data: ${JSON.stringify({ type: "token", text: `${SECTION_2}\n` })}\n\n`,
  `data: ${JSON.stringify({ type: "done", finishReason: "stop" })}\n\n`,
].join("");

// ─── Suite setup ─────────────────────────────────────────────────────────────

test.beforeAll(async () => {
  // Wipe any leftover state from a prior run so the suite is fully repeatable.
  await rm(E2E_DATA_DIR, { recursive: true, force: true });
  await mkdir(E2E_DATA_DIR, { recursive: true });
});

// ─── Golden path ─────────────────────────────────────────────────────────────

test("golden path — create, write, generate, read", async ({ page }) => {
  // 1. Intercept /api/generate BEFORE any navigation that could trigger it.
  //    Playwright fulfills the whole SSE body at once; eventsource-parser still
  //    splits on \n\n and fires events in order — the UI reaches the same end
  //    state as a real streamed response.
  await page.route("**/api/generate", async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
      body: SSE_BODY,
    });
  });

  // Also stub the recap endpoint. autoRecap is on by default; the hook issues
  // a best-effort recap fetch after `done`. Stubbing avoids waiting on a
  // missing-key error that could delay the test.
  await page.route("**/api/generate/recap", async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true, data: { recap: "A brief recap." } }),
    });
  });

  // Stub the stop endpoint too (in case any cleanup path fires it).
  await page.route("**/api/generate/stop", async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true }),
    });
  });

  // ── Step 2: Settings — save a fake API key ────────────────────────────────
  await page.goto("/settings");
  // Wait for the form to hydrate (it shows "Loading…" until SWR resolves).
  await expect(page.getByLabel("xAI API key")).toBeVisible();
  await page.getByLabel("xAI API key").fill("xai-test-00000000000000000000");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/Settings saved/i)).toBeVisible();

  // ── Step 3: Library — create a new story ─────────────────────────────────
  await page.goto("/");
  // Wait for the library to load (either empty state or populated state).
  await expect(page.getByRole("button", { name: "New story" }).first()).toBeVisible();
  await page.getByRole("button", { name: "New story" }).first().click();

  // New story dialog opens — fill in the title.
  await expect(page.getByLabel("Title")).toBeVisible();
  await page.getByLabel("Title").fill("E2E Story");
  // Submit button text is "Create story" (not just "Create").
  await page.getByRole("button", { name: "Create story" }).click();

  // ── Step 4: Verify navigation to the story editor ────────────────────────
  // toSlug("E2E Story") → "e2e-story"; capture dynamically in case uniquifier appends -2.
  await page.waitForURL(/\/s\/[^/]+(\?.*)?$/, { timeout: 15_000 });
  const editorUrl = page.url();
  // Extract the slug from the URL — e.g. "e2e-story" or "e2e-story-2"
  const slugMatch = editorUrl.match(/\/s\/([^/?]+)/);
  expect(slugMatch).not.toBeNull();
  const slug = slugMatch![1];

  // Wait for the editor to settle (chapter list and bible pane should appear).
  await expect(page.getByText("Chapters")).toBeVisible();

  // ── Step 5: Add character Ana ─────────────────────────────────────────────
  // CharactersSubform is inside a "Characters" Collapsible (open by default).
  // Click "Add character" to reveal the character row inputs.
  await page.getByRole("button", { name: "Add character" }).click();
  // The name input has placeholder "Name" (sr-only label "Name").
  await page.getByPlaceholder("Name").fill("Ana");
  // The description input has placeholder "Description".
  await page.getByPlaceholder("Description").fill("curious");
  // Auto-save debounce fires; no explicit save needed here.

  // ── Step 6: Add a chapter titled "Opening" ────────────────────────────────
  await page.getByRole("button", { name: "New chapter" }).click();
  // An inline input appears with placeholder "Chapter title…"
  const chapterInput = page.getByPlaceholder("Chapter title…");
  await expect(chapterInput).toBeVisible();
  await chapterInput.fill("Opening");
  await chapterInput.press("Enter");

  // The chapter should be created and selected; the editor pane should show
  // the "Generate chapter" button (no sections yet).
  await expect(page.getByRole("button", { name: "Generate chapter" })).toBeVisible({
    timeout: 10_000,
  });

  // ── Step 7: (Optional) Fill in summary ───────────────────────────────────
  // The summary is in the right MetadataPane. The plan mentions "they meet" —
  // it's optional for generation but let's fill it in for completeness.
  await page.getByLabel("Summary").fill("they meet");

  // ── Step 8: Set up chapter-API intercept + click Generate ────────────────
  // Architecture: the /api/generate stub intercepts at the browser layer so
  // the server's route handler never runs and sections are never persisted.
  // After the `done` SSE event, EditorPane calls globalMutate to revalidate
  // the chapter from /api/stories/${slug}/chapters/${chapterId}. If the server
  // has 0 sections, the SectionCards never render.
  //
  // Fix: intercept the single-chapter GET endpoint. Let the first call pass
  // through to the real server (returns 0 sections, so Generate button shows).
  // After the generate button is clicked, swap to returning the canned sections.
  // The revalidation triggered by `done` then receives the 2 canned sections
  // and SectionCards render as expected.

  // Get the chapter ID from the URL query param (?chapter=<id>).
  const preGenUrl = page.url();
  const chapterIdMatch = preGenUrl.match(/[?&]chapter=([^&]+)/);
  expect(chapterIdMatch).not.toBeNull();
  const chapterId = chapterIdMatch![1];

  // Flag: false = pass through to real server; true = return canned sections.
  let returnCannedSections = false;

  // Intercept the single-chapter GET endpoint.
  await page.route(`**/api/stories/${slug}/chapters/${chapterId}`, async (route) => {
    if (route.request().method() !== "GET" || !returnCannedSections) {
      // Pre-generate: let real server handle it (returns sections: []).
      await route.continue();
      return;
    }
    // Post-generate: return the canned sections so SWR renders SectionCards.
    const chapter = {
      id: chapterId,
      title: "Opening",
      summary: "they meet",
      beats: [],
      prompt: "",
      recap: "",
      sections: [
        { id: "e2e-section-1", content: SECTION_1 },
        { id: "e2e-section-2", content: SECTION_2 },
      ],
      wordCount: (SECTION_1 + " " + SECTION_2).split(/\s+/).length,
    };
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true, data: chapter }),
    });
  });

  // Click "Generate chapter" — the button only shows because sections.length === 0.
  await page.getByRole("button", { name: "Generate chapter" }).click();

  // Enable canned sections IMMEDIATELY after clicking generate.
  // The `done` SSE event triggers SWR revalidation asynchronously, so
  // setting this flag here ensures the revalidation call sees canned data.
  returnCannedSections = true;

  // ── Step 9: Assert two SectionCards appear with the canned prose ──────────
  // Wait for the streaming overlay to disappear (stream reached `done`).
  await expect(page.getByRole("button", { name: "Stop generation" })).toBeHidden({
    timeout: 15_000,
  });

  // SWR revalidation fired on `done` and received the two canned sections.
  await expect(page.getByText(SECTION_1)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(SECTION_2)).toBeVisible();

  // ── Step 10: Persist sections to disk for the SSR reader page ───────────
  // The reader (/s/${slug}/read) is server-rendered and reads sections from
  // disk. Our /api/generate stub prevented the server's route handler from
  // running, so nothing was persisted. PATCH the chapter via the real API
  // to write the canned sections to disk before navigating to the reader.
  const persistResult = await page.evaluate(
    async ({ slug, chapterId, section1, section2 }) => {
      const res = await fetch(`/api/stories/${slug}/chapters/${chapterId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sections: [
            { id: "e2e-section-1", content: section1 },
            { id: "e2e-section-2", content: section2 },
          ],
        }),
      });
      return res.json();
    },
    { slug, chapterId, section1: SECTION_1, section2: SECTION_2 },
  );
  expect(persistResult).toMatchObject({ ok: true });

  // ── Step 11: Navigate to the reader and assert prose is visible ───────────
  await page.goto(`/s/${slug}/read`);

  // The reader is a server-rendered page — it reads from disk directly.
  await expect(page.getByRole("heading", { name: "E2E Story", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Opening", level: 2 })).toBeVisible();
  await expect(page.getByText(SECTION_1)).toBeVisible();
  await expect(page.getByText(SECTION_2)).toBeVisible();
});
