/**
 * Desktop packaging — web-mode smoketest.
 *
 * The new settings UI ships Electron-only sections (auto-update toggle,
 * desktop network-activity disclosure) and an onboarding banner shared by
 * both web and desktop. In a real Electron build, `process.versions.electron`
 * is set; under `next dev`, it is undefined, so `isElectron === false`.
 *
 * This spec validates the web-mode contract:
 *   - banner renders only when ?onboarding=1 is present
 *   - Updates section is hidden
 *   - PrivacyPanel "Desktop app network activity" block is hidden
 *   - settings save still works (regression check)
 *   - GET /api/settings returns isElectron:false + updates defaults
 *
 * Reuses the same isolated Playwright dev server (port 3001,
 * SCRIPTR_DATA_DIR=/tmp/scriptr-e2e) defined in playwright.config.ts.
 */
import { test, expect } from "@playwright/test";
import { mkdir, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import { E2E_DATA_DIR } from "../../playwright.config";

const CONFIG_FILE = join(E2E_DATA_DIR, "config.json");

test.beforeAll(async () => {
  await rm(E2E_DATA_DIR, { recursive: true, force: true });
  await mkdir(E2E_DATA_DIR, { recursive: true });
});

// ─── Onboarding banner ───────────────────────────────────────────────────────

test("onboarding banner renders with ?onboarding=1", async ({ page }) => {
  await page.goto("/settings?onboarding=1");
  // SettingsForm renders a "Loading…" skeleton until SWR resolves.
  await expect(page.getByLabel("xAI API key")).toBeVisible();

  await expect(page.getByRole("heading", { name: "Welcome to scriptr" })).toBeVisible();
  await expect(page.getByText(/Paste your xAI API key below to get started\./i)).toBeVisible();

  const link = page.getByRole("link", { name: /Get a key/i });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", "https://console.x.ai");
});

test("onboarding banner is absent without the query param", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByLabel("xAI API key")).toBeVisible();

  await expect(page.getByRole("heading", { name: "Welcome to scriptr" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Get a key/i })).toHaveCount(0);
});

// ─── Electron-only sections are hidden in web mode ───────────────────────────

test("Updates section is hidden in web mode", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByLabel("xAI API key")).toBeVisible();

  // The Updates section header is rendered with the same uppercase styling as
  // other section headings; match its exact text.
  const updatesHeading = page.getByRole("heading", { name: "Updates", exact: true });
  await expect(updatesHeading).toHaveCount(0);

  // The toggle inside it should also not exist.
  await expect(page.locator("#update-check-on-launch")).toHaveCount(0);
  await expect(page.getByLabel("Check for updates on launch")).toHaveCount(0);
});

test("PrivacyPanel desktop network-activity block is hidden in web mode", async ({ page }) => {
  await page.goto("/settings");
  // Wait for the Privacy section heading itself to render (means PrivacyPanel mounted).
  await expect(page.getByRole("heading", { name: "Privacy", exact: true })).toBeVisible();

  // The Electron-only sub-block. If this renders in web mode, isElectron is leaking true.
  await expect(page.getByRole("heading", { name: "Desktop app network activity" })).toHaveCount(0);
  await expect(page.getByText("Allowed destinations")).toHaveCount(0);
  await expect(page.getByText("Update check on launch")).toHaveCount(0);
});

// ─── /api/settings shape ─────────────────────────────────────────────────────

test("GET /api/settings reports isElectron:false and updates defaults", async ({ request }) => {
  const res = await request.get("/api/settings");
  expect(res.ok()).toBe(true);
  const json = await res.json();
  expect(json.ok).toBe(true);
  expect(json.data).toMatchObject({
    isElectron: false,
    updates: { checkOnLaunch: true },
  });
});

// ─── Save regression — toggle autoRecap and verify it round-trips ────────────

test("settings form still saves successfully (regression)", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByLabel("xAI API key")).toBeVisible();

  // Read current state from API to know what to flip to.
  const before = await (await page.request.get("/api/settings")).json();
  const initialAutoRecap = before.data.autoRecap as boolean;

  // Flip the auto-recap switch. shadcn <Switch> renders a hidden <input> with
  // the id and a visible <button role="switch"> beside it; click the button.
  const switchEl = page.getByRole("switch", { name: "Auto-recap" });
  await expect(switchEl).toBeVisible();
  await switchEl.scrollIntoViewIfNeeded();
  await switchEl.click();

  // Watch for the PUT to /api/settings while clicking Save.
  const putWait = page.waitForResponse(
    (r) => r.url().endsWith("/api/settings") && r.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "Save" }).click();
  const putRes = await putWait;
  expect(putRes.ok()).toBe(true);

  // Toast confirmation.
  await expect(page.getByText(/Settings saved/i)).toBeVisible();

  // Verify it actually persisted via the API.
  const after = await (await page.request.get("/api/settings")).json();
  expect(after.ok).toBe(true);
  expect(after.data.autoRecap).toBe(!initialAutoRecap);
});

// ─── Onboarding completion: banner clears, URL updates, "Setup complete" toast ──

test("onboarding save clears banner, drops query param, and shows Setup complete toast", async ({ page }) => {
  // Force a clean "no key on file" state so the onboarding-completion branch
  // (`!data.hasKey && form.apiKey !== ""`) actually fires. Other tests in this
  // file may have written a config.json with apiKey unset but still present.
  await unlink(CONFIG_FILE).catch(() => {
    /* fine — it may not exist */
  });

  await page.goto("/settings?onboarding=1");
  await expect(page.getByLabel("xAI API key")).toBeVisible();

  // Sanity: banner is up at the start.
  const banner = page.getByRole("heading", { name: "Welcome to scriptr" });
  await expect(banner).toBeVisible();
  expect(page.url()).toContain("onboarding=1");

  // Confirm hasKey is false right now (so the route through `justFinishedOnboarding` is the one we're exercising).
  const before = await (await page.request.get("/api/settings")).json();
  expect(before.data.hasKey).toBe(false);

  // Type a fake key and save.
  await page.getByLabel("xAI API key").fill("xai-test-onboarding-key-1234");

  const putWait = page.waitForResponse(
    (r) => r.url().endsWith("/api/settings") && r.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "Save" }).click();
  const putRes = await putWait;
  expect(putRes.ok()).toBe(true);

  // The completion toast — the wording is intentional and asserted by name.
  await expect(page.getByText(/Setup complete/i)).toBeVisible();
  // And the generic "Settings saved" toast must NOT be the one shown.
  await expect(page.getByText("Settings saved", { exact: true })).toHaveCount(0);

  // router.replace("/settings") should drop ?onboarding=1.
  await expect.poll(() => page.url(), { timeout: 5_000 }).not.toContain("onboarding=1");
  await expect(page.url()).toMatch(/\/settings$/);

  // And the welcome banner is gone.
  await expect(banner).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Get a key/i })).toHaveCount(0);

  // Cleanup so later tests don't see a saved key.
  await unlink(CONFIG_FILE).catch(() => {});
});

// ─── Settings save (non-onboarding) shows the plain "Settings saved" toast ──

test("non-onboarding save shows 'Settings saved' (NOT 'Setup complete')", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByLabel("xAI API key")).toBeVisible();

  // No edits needed — clicking Save with the form unchanged still fires PUT
  // and shows the toast. (apiKey is empty and not sent; hasKey may be true or
  // false at this point, but onboarding=1 is absent so the branch can't fire.)
  const putWait = page.waitForResponse(
    (r) => r.url().endsWith("/api/settings") && r.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "Save" }).click();
  const putRes = await putWait;
  expect(putRes.ok()).toBe(true);

  // Plain toast wording — the onboarding-only "Setup complete" string MUST NOT fire here.
  await expect(page.getByText("Settings saved", { exact: true })).toBeVisible();
  await expect(page.getByText(/Setup complete/i)).toHaveCount(0);

  // URL stays /settings (we never had ?onboarding=1, but assert it didn't sprout one).
  expect(page.url()).toMatch(/\/settings$/);
});

// ─── CSP: dev-server must keep 'unsafe-eval' in script-src (HMR needs it) ──

test("dev-server CSP keeps 'unsafe-eval' in script-src", async ({ request }) => {
  // Hit a page route (not /api/*) — `headers()` in next.config.ts targets "/:path*".
  const res = await request.get("/settings");
  expect(res.ok()).toBe(true);

  const csp = res.headers()["content-security-policy"];
  expect(csp, "CSP header missing on /settings").toBeTruthy();

  // Find the script-src directive specifically — substring search would also
  // catch 'unsafe-eval' if it appeared anywhere else in the policy.
  const scriptSrc = csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith("script-src "));
  expect(scriptSrc, `no script-src directive in CSP: ${csp}`).toBeTruthy();
  expect(scriptSrc).toContain("'unsafe-eval'");
  expect(scriptSrc).toContain("'self'");
  expect(scriptSrc).toContain("'unsafe-inline'");
});

// ─── CSP: connect-src is restricted to self + api.x.ai in web-mode dev ──

test("dev-server CSP connect-src is restricted to self and api.x.ai", async ({ request }) => {
  const res = await request.get("/settings");
  const csp = res.headers()["content-security-policy"];
  expect(csp).toBeTruthy();

  const connectSrc = csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith("connect-src "));
  expect(connectSrc, `no connect-src directive in CSP: ${csp}`).toBeTruthy();
  expect(connectSrc).toContain("'self'");
  expect(connectSrc).toContain("https://api.x.ai");
  // Update-related origins must NOT leak into the web build.
  expect(connectSrc).not.toContain("api.github.com");
  expect(connectSrc).not.toContain("objects.githubusercontent.com");
});
