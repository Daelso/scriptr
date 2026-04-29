/**
 * Smoketests for two related editor regressions:
 *
 *  1. Find bar (Cmd/Ctrl+F) didn't actually scroll to the next match on
 *     Enter. Root cause: ProseMirror's scrollToSelection bails when the DOM
 *     selection's focusNode isn't inside view.dom — and while the user is
 *     typing in the find input, focus is on the input. Fix scrolls the
 *     active-match decoration's DOM node directly.
 *
 *  2. Clicking deep into a multi-paragraph read-only <p> placed the cursor
 *     a few characters too far down. Root cause: the read-only <p> uses
 *     whitespace-pre-wrap so "\n\n" renders a blank line of full
 *     line-height; the Tiptap editor used `p + p { margin-top: 1em }` —
 *     a tighter gap. posAtCoords ran against the post-mount layout with
 *     pre-mount coords, so the cursor drifted ~10px per paragraph break.
 *     Fix bumps the editor's gap to 1lh so both layouts match.
 */
import { test, expect } from "@playwright/test";
import { mkdir, rm } from "node:fs/promises";
import { E2E_DATA_DIR } from "../../playwright.config";

test.beforeAll(async () => {
  await rm(E2E_DATA_DIR, { recursive: true, force: true });
  await mkdir(E2E_DATA_DIR, { recursive: true });
});

async function createStoryWithSection(
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext,
  title: string,
  sectionContent: string,
): Promise<{ slug: string; chapterId: string }> {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "New story" }).first()).toBeVisible();
  await page.getByRole("button", { name: "New story" }).first().click();
  await expect(page.getByLabel("Title")).toBeVisible();
  await page.getByLabel("Title").fill(title);
  await page.getByRole("button", { name: "Create story" }).click();
  await page.waitForURL(/\/s\/[^/]+(\?.*)?$/, { timeout: 15_000 });
  const slug = page.url().match(/\/s\/([^/?]+)/)![1];

  await expect(page.getByText("Chapters")).toBeVisible();
  await page.getByRole("button", { name: "New chapter" }).click();
  const chapterInput = page.getByPlaceholder("Chapter title…");
  await expect(chapterInput).toBeVisible();
  await chapterInput.fill("Smoketest");
  await chapterInput.press("Enter");
  await expect(page.getByRole("button", { name: "Generate chapter" })).toBeVisible({
    timeout: 10_000,
  });

  const listRes = await request.get(`/api/stories/${slug}/chapters`);
  const listJson = (await listRes.json()) as { ok: boolean; data: { id: string }[] };
  expect(listJson.ok).toBe(true);
  const chapterId = listJson.data[0].id;

  const patchRes = await request.patch(
    `/api/stories/${slug}/chapters/${chapterId}`,
    {
      data: {
        sections: [{ id: "sec-smoke", content: sectionContent }],
      },
    },
  );
  expect(patchRes.ok()).toBe(true);

  await page.goto(`/s/${slug}?chapter=${chapterId}`);
  return { slug, chapterId };
}

test("find bar Enter scrolls the next match into view even when focus is on the find input", async ({
  page,
  request,
}) => {
  // 40 padding paragraphs, then a unique marker far below the fold. With the
  // 1440x900 viewport and ~26px line-height, the marker sits well below the
  // initial scroll position — so jumping to it must actually scroll the pane.
  const padding = Array.from({ length: 40 }, (_, i) => `Padding line ${i + 1}.`).join(
    "\n\n",
  );
  const sectionContent = `${padding}\n\nFINDBARNEEDLE is the unique target.`;

  await createStoryWithSection(page, request, "Find Bar Smoketest", sectionContent);
  await expect(page.getByText("Padding line 1.")).toBeVisible();

  // Click into the section near the top so the editor mounts and the cursor
  // is somewhere above the marker. We click on "Padding line 1." itself.
  const section = page.locator('p[aria-label="Edit section"]').first();
  await section.click({ position: { x: 30, y: 8 } });
  const editor = page.locator('[aria-label="Edit section"].ProseMirror').first();
  await expect(editor).toBeVisible();

  // Open the find bar.
  await page.keyboard.press("ControlOrMeta+f");
  const findInput = page.getByRole("textbox", { name: "Find" });
  await expect(findInput).toBeFocused();

  // The center pane is the only overflow:auto ancestor of the editor — find
  // it via the contenteditable's parent chain so the assertion isn't tied
  // to a brittle selector. We snapshot scrollTop before pressing Enter.
  const scrollHandle = await editor.evaluateHandle((el) => {
    let cur: HTMLElement | null = el.parentElement;
    while (cur) {
      const overflowY = getComputedStyle(cur).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") return cur;
      cur = cur.parentElement;
    }
    return document.scrollingElement as HTMLElement;
  });
  const scrollTopBefore = await scrollHandle.evaluate((el) => el.scrollTop);

  await findInput.fill("FINDBARNEEDLE");
  // Wait for the highlight decoration to be applied — its presence is the
  // signal that the prosemirror-search plugin has indexed our query.
  await expect(page.locator(".ProseMirror-search-match").first()).toHaveCount(1);

  await findInput.press("Enter");

  // After the fix, the active match must be visible inside the viewport.
  // We assert on bounding rects rather than scrollTop alone so the test
  // still passes if scroll snapping or future layout changes shift the
  // exact pixel offsets.
  const activeMatch = page.locator(".ProseMirror-active-search-match");
  await expect(activeMatch).toHaveCount(1);

  const matchBox = await activeMatch.boundingBox();
  const viewport = page.viewportSize();
  expect(matchBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  // Match's top edge sits within the viewport (with a small tolerance for
  // sub-pixel rounding). Without the fix the pane stayed at scrollTop=0
  // and the match's top was several thousand pixels below the viewport.
  expect(matchBox!.y).toBeGreaterThanOrEqual(0);
  expect(matchBox!.y + matchBox!.height).toBeLessThanOrEqual(viewport!.height + 1);

  // Belt-and-braces: the scrollable pane actually scrolled. The fix uses
  // block: "center", which always moves the match away from the top edge
  // when it was previously below the viewport.
  const scrollTopAfter = await scrollHandle.evaluate((el) => el.scrollTop);
  expect(scrollTopAfter).toBeGreaterThan(scrollTopBefore);

  // Find input should still own focus — the user shouldn't have to re-click
  // it to keep navigating. (Pre-fix, view.focus() stole it.)
  await expect(findInput).toBeFocused();
});

test("clicking deep into a multi-paragraph section places the cursor at the click position", async ({
  page,
  request,
}) => {
  // Six single-line paragraphs, each labeled with a unique short marker.
  // Single lines per paragraph keep line-height the only vertical variable
  // and isolate the paragraph-gap mismatch we're guarding against.
  const sectionContent = [
    "ALPHA paragraph one.",
    "BETA paragraph two.",
    "GAMMA paragraph three.",
    "DELTA paragraph four.",
    "EPSILON paragraph five.",
    "ZETA paragraph six.",
  ].join("\n\n");

  await createStoryWithSection(
    page,
    request,
    "Click Position Smoketest",
    sectionContent,
  );
  await expect(page.getByText("ALPHA paragraph one.")).toBeVisible();
  await expect(page.getByText("ZETA paragraph six.")).toBeVisible();

  // Compute the viewport position of the start of "EPSILON" by building a
  // DOM Range over that exact substring inside the read-only <p>. This is
  // the click location the user perceived as "the start of EPSILON" before
  // the editor mounted.
  const targetWord = "EPSILON";
  const target = await page.evaluate((needle) => {
    const p = document.querySelector('p[aria-label="Edit section"]');
    if (!p || !p.firstChild || p.firstChild.nodeType !== Node.TEXT_NODE) {
      throw new Error("read-only <p> with text node not found");
    }
    const text = p.firstChild as Text;
    const offset = text.textContent!.indexOf(needle);
    if (offset < 0) throw new Error(`needle ${needle} not found in section text`);
    const range = document.createRange();
    range.setStart(text, offset);
    range.setEnd(text, offset);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + 1, y: rect.top + rect.height / 2 };
  }, targetWord);

  // Click at the exact pixel the start of "EPSILON" rendered at. The mount
  // captures these coords and feeds them into posAtCoords inside the now-
  // mounted Tiptap editor. With matching paragraph spacing the resolved
  // position is the start of "EPSILON" — without it, drift sends us further
  // down (DELTA->EPSILON, EPSILON->ZETA, etc.).
  await page.mouse.click(target.x, target.y);

  const editor = page.locator('[aria-label="Edit section"].ProseMirror').first();
  await expect(editor).toBeVisible();

  // Type a unique marker at the cursor position. Esc to close edit mode and
  // flush the autosave (the SectionEditor's autosave hook runs on unmount).
  await page.keyboard.type("MARK_");
  await page.keyboard.press("Escape");

  // After flush + revalidation, the persisted section content should now
  // read "MARK_EPSILON paragraph five." — i.e., the marker landed in the
  // EPSILON paragraph, not in DELTA, GAMMA, or anywhere else.
  await expect(page.getByText("MARK_EPSILON paragraph five.")).toBeVisible({
    timeout: 5_000,
  });
});
