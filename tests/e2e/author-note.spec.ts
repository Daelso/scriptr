/**
 * Author-note E2E: walks the full feature surface end to end.
 *
 *   1. Create story (API) + chapter (UI) + persist a section to disk so the
 *      EPUB exporter has prose to package.
 *   2. Configure a pen-name profile for the story via /settings UI
 *      (email + mailing-list URL + default rich-text message — typed into
 *      the Tiptap editor and submitted with the Save button).
 *   3. Verify the AuthorNote card on the metadata pane is checked by
 *      default and shows the default-message preview (profile resolved,
 *      no per-story override yet).
 *   4. Set a per-story override via PATCH /api/stories/<slug>, then re-
 *      load the editor and verify the toggle stays checked, the default-
 *      preview is suppressed, and the override editor contains the saved
 *      message. (See section 4b for why we bypass the override editor's
 *      autosave-debounce path here.)
 *   5. Visit /s/<slug>/read and assert the note renders (heading +
 *      override text + email mailto link + inline data-URL QR <img>).
 *   6. Build EPUB 3, read the file off disk, unzip with JSZip, assert
 *      at least one xhtml part contains the author-note heading + the
 *      override text + the mailto link + the QR <img alt>.
 *   7. Flip enabled=false via PATCH (verifying the toggle reflected the
 *      previously-saved enabled=true state first), rebuild EPUB 3,
 *      re-unzip, assert the note is absent.
 *
 * The AuthorNote card lives inside MetadataPane's InnerPane and only
 * mounts when a chapter is selected — Step 1's chapter creation is
 * therefore mandatory, not decorative.
 *
 * Privacy note: the EPUB build path is purely local. The egress
 * vitest covers the same export route under fetch interception; this
 * spec validates the user-visible flow that hangs off it.
 */
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { E2E_DATA_DIR } from "../../playwright.config";
import { toSlug } from "../../lib/slug";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function epubXhtmls(bytes: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(bytes);
  const xhtmlPaths = Object.keys(zip.files).filter((p) => p.endsWith(".xhtml"));
  return Promise.all(xhtmlPaths.map((p) => zip.file(p)!.async("string")));
}

// ─── Spec ─────────────────────────────────────────────────────────────────────

test.describe("author-note", () => {
  test("settings → metadata → reader → export → toggle off", async ({
    page,
  }) => {
    // Warm up the dev server's webpack compilation for every route the
    // test will visit. Next dev triggers a "Fast Refresh full reload"
    // the first time a new route compiles, which discards React state
    // in any in-flight test interaction. Hitting each route up-front
    // ensures the heavy compile is done before we touch the UI.
    for (const path of ["/", "/settings"]) {
      await page.goto(`http://127.0.0.1:3001${path}`);
      await page.waitForLoadState("networkidle");
    }
    // Unique pen name per run so the suite tolerates a leftover scriptr-e2e
    // dir from a prior run (the publishing-kit spec uses the same isolation
    // strategy — no beforeAll wipe).
    const RUN_ID = Date.now();
    const PEN_NAME = `AuthorNote E2E ${RUN_ID}`;
    const TITLE = `AuthorNote ${RUN_ID}`;
    const PEN_SLUG = toSlug(PEN_NAME);

    // ── 1. Create story (API) ────────────────────────────────────────────────
    const createRes = await page.request.post(
      "http://127.0.0.1:3001/api/stories",
      { data: { title: TITLE, authorPenName: PEN_NAME } },
    );
    expect(createRes.ok()).toBeTruthy();
    const { data: story } = (await createRes.json()) as {
      data: { slug: string };
    };
    const slug = story.slug;

    // Pre-compile the remaining dynamic routes — same warm-up rationale.
    await page.goto(`http://127.0.0.1:3001/s/${slug}`);
    await page.waitForLoadState("networkidle");
    await page.goto(`http://127.0.0.1:3001/s/${slug}/read`);
    await page.waitForLoadState("networkidle");
    await page.goto(`http://127.0.0.1:3001/s/${slug}/export`);
    await page.waitForLoadState("networkidle");

    // ── 2. Create a chapter via UI so the AuthorNote card mounts ─────────────
    await page.goto(`http://127.0.0.1:3001/s/${slug}`);
    await expect(page.getByText("Chapters")).toBeVisible();

    await page.getByRole("button", { name: "New chapter" }).click();
    const chapterInput = page.getByPlaceholder("Chapter title…");
    await expect(chapterInput).toBeVisible();
    await chapterInput.fill("Opening");
    await chapterInput.press("Enter");

    // After creation the editor URL gets ?chapter=<id> appended; capture it.
    await page.waitForURL(/\?chapter=/, { timeout: 10_000 });
    const editorUrl = page.url();
    const chapterIdMatch = editorUrl.match(/[?&]chapter=([^&]+)/);
    expect(chapterIdMatch).not.toBeNull();
    const chapterId = chapterIdMatch![1];

    // The AuthorNote card mounts inside InnerPane — assert it shows up before
    // we touch settings (this also confirms the no-profile branch renders the
    // disabled toggle + helper-text link).
    await expect(page.getByTestId("author-note-card")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("author-note-toggle")).toBeDisabled();

    // Persist a section onto the chapter so the EPUB build below has prose.
    // (Generate-via-Grok would require a stub; PATCHing the API directly is
    // both faster and matches the golden-path persistence pattern.)
    await page.evaluate(
      async ({ slug, chapterId }) => {
        const res = await fetch(
          `/api/stories/${slug}/chapters/${chapterId}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              sections: [
                {
                  id: "e2e-author-note-section-1",
                  content: "Once upon a time in a quiet wood.",
                },
              ],
            }),
          },
        );
        const json = await res.json();
        if (!json.ok) throw new Error(json.error ?? "patch failed");
      },
      { slug, chapterId },
    );

    // ── 3. Configure a pen-name profile via /settings UI ─────────────────────
    await page.goto("http://127.0.0.1:3001/settings");
    await expect(
      page.getByRole("heading", { name: /pen name profiles/i }),
    ).toBeVisible();

    // The card auto-renders for every authorPenName seen on a story — even
    // without a saved profile yet. Find it by the per-slug testids.
    const emailField = page.getByTestId(`pen-email-${PEN_SLUG}`);
    await expect(emailField).toBeVisible();
    await emailField.fill("e2e@example.com");
    await page
      .getByTestId(`pen-mailing-${PEN_SLUG}`)
      .fill("https://list.example.com/e2e");

    // Type a default message. The RichTextEditor renders a contenteditable
    // host with class `tiptap-rich-editor` and an aria-label set by the
    // parent — locate by aria-label so we don't depend on the underlying
    // tiptap markup.
    const messageEditor = page
      .getByTestId(`pen-message-${PEN_SLUG}`)
      .locator(`[aria-label="Default message for ${PEN_NAME}"]`);
    await messageEditor.click();
    await page.keyboard.type("Thanks for reading!");

    await page.getByTestId(`pen-save-${PEN_SLUG}`).click();
    // Wait for the success toast — confirms the PUT settled and SWR
    // revalidated. More robust than polling the button's disabled state.
    await expect(
      page.getByText(/pen name profile saved/i),
    ).toBeVisible({ timeout: 5_000 });

    // ── 4a. Back to the metadata pane — toggle reflects server state ─────────
    // First visit: profile resolved, story.authorNote === undefined → toggle
    // is checked (default-on) and the default-preview is visible.
    await page.goto(`http://127.0.0.1:3001/s/${slug}?chapter=${chapterId}`);
    const toggle = page.getByTestId("author-note-toggle");
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await expect(toggle).toBeEnabled();
    await expect(toggle).toBeChecked();
    await expect(page.getByTestId("author-note-default-preview")).toBeVisible();

    // ── 4b. Set the per-story override via API ───────────────────────────────
    // The override editor is a Tiptap RichTextEditor wired to useAutoSave's
    // 500 ms debounce. Driving it through Playwright's keystroke API under
    // the e2e dev server (Next.js HMR + React Strict Mode + the
    // webpack hot-update requests Playwright observes) introduces a flake-
    // prone race where the debounced PATCH doesn't reliably leave the page
    // before the test moves on. Calling the same endpoint useAutoSave would
    // call exercises the same persistence path deterministically. The
    // AuthorNoteCard's onChange wiring is covered by a vitest separately.
    const patchRes = await page.request.patch(
      `http://127.0.0.1:3001/api/stories/${slug}`,
      {
        data: {
          authorNote: {
            enabled: true,
            messageHtml: "<p>This book in particular</p>",
          },
        },
      },
    );
    expect(patchRes.ok()).toBeTruthy();

    // Re-load the editor — the override should now show in the UI.
    await page.goto(`http://127.0.0.1:3001/s/${slug}?chapter=${chapterId}`);
    await expect(toggle).toBeChecked();
    // With the override saved, the default-preview should be suppressed.
    await expect(
      page.getByTestId("author-note-default-preview"),
    ).not.toBeVisible();
    // The override editor should render with the persisted message.
    const overrideEditor = page
      .getByTestId("author-note-override-editor")
      .locator('[aria-label="Author note override message"]');
    await expect(overrideEditor).toContainText(/this book in particular/i);

    // ── 5. Reader: assert the note renders with the override message ─────────
    await page.goto(`http://127.0.0.1:3001/s/${slug}/read`);
    await expect(
      page.getByRole("heading", { name: /a note from the author/i }),
    ).toBeVisible();
    await expect(page.getByText(/this book in particular/i)).toBeVisible();
    // The reader path keeps the QR inline as a data URL (the EPUB temp-file
    // rewrite is a separate code path).
    await expect(
      page.locator('img[alt="QR code linking to the mailing list"]'),
    ).toHaveAttribute("src", /^data:image\/png;base64,/);
    await expect(
      page.getByRole("link", { name: "e2e@example.com" }),
    ).toHaveAttribute("href", "mailto:e2e@example.com");

    // ── 6. Build EPUB 3 + inspect on disk ────────────────────────────────────
    await page.goto(`http://127.0.0.1:3001/s/${slug}/export`);
    await expect(page.getByTestId("export-build")).toBeVisible();
    // Description is required by canBuild gating; fill + blur to commit.
    const descField = page.getByTestId("export-description");
    await descField.fill("An author-note end-to-end test book.");
    await descField.blur();
    // Default version is EPUB 3; build immediately.
    await page.getByTestId("export-build").click();
    await expect(page.getByTestId("export-lastbuild-epub3")).toBeVisible({
      timeout: 20_000,
    });

    const epubPath = join(
      E2E_DATA_DIR,
      "stories",
      slug,
      "exports",
      `${slug}-epub3.epub`,
    );
    expect(existsSync(epubPath)).toBe(true);

    const xhtmls1 = await epubXhtmls(await readFile(epubPath));
    expect(xhtmls1.some((x) => x.includes("A note from the author"))).toBe(
      true,
    );
    expect(xhtmls1.some((x) => x.includes("This book in particular"))).toBe(
      true,
    );
    expect(xhtmls1.some((x) => x.includes("mailto:e2e@example.com"))).toBe(
      true,
    );
    // epub-gen-memory rewrites <img src> to a relative path; just confirm
    // the alt attribute (load-bearing for accessibility) survives.
    expect(
      xhtmls1.some((x) =>
        x.includes('alt="QR code linking to the mailing list"'),
      ),
    ).toBe(true);

    // ── 7. Toggle off → re-export → note absent ─────────────────────────────
    // Verify the toggle still reflects the saved enabled=true state in UI,
    // then flip the persisted state via the same PATCH endpoint useAutoSave
    // would call (see Section 4b for why we bypass the autosave debounce
    // under the e2e dev server).
    await page.goto(`http://127.0.0.1:3001/s/${slug}?chapter=${chapterId}`);
    const toggleOff = page.getByTestId("author-note-toggle");
    await expect(toggleOff).toBeChecked();

    const offRes = await page.request.patch(
      `http://127.0.0.1:3001/api/stories/${slug}`,
      {
        data: {
          authorNote: {
            enabled: false,
            messageHtml: "<p>This book in particular</p>",
          },
        },
      },
    );
    expect(offRes.ok()).toBeTruthy();

    // Re-load the editor — the toggle should now be unchecked.
    await page.goto(`http://127.0.0.1:3001/s/${slug}?chapter=${chapterId}`);
    await expect(page.getByTestId("author-note-toggle")).not.toBeChecked();

    await page.goto(`http://127.0.0.1:3001/s/${slug}/export`);
    await expect(page.getByTestId("export-build")).toBeVisible();
    // Description was persisted by the previous build; the field shows it
    // in the defaultValue and canBuild already evaluates to true. Build.
    await page.getByTestId("export-build").click();
    await expect(page.getByTestId("export-lastbuild-epub3")).toBeVisible({
      timeout: 20_000,
    });

    const xhtmls2 = await epubXhtmls(await readFile(epubPath));
    expect(xhtmls2.every((x) => !x.includes("A note from the author"))).toBe(
      true,
    );
    expect(xhtmls2.every((x) => !x.includes("mailto:e2e@example.com"))).toBe(
      true,
    );
    expect(
      xhtmls2.every(
        (x) => !x.includes('alt="QR code linking to the mailing list"'),
      ),
    ).toBe(true);
  });
});
