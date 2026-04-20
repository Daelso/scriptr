import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolated data dir — NEVER the user's real data/ directory.
// Each e2e run gets a fresh /tmp/scriptr-e2e tree (cleaned in beforeAll).
export const E2E_DATA_DIR = join(tmpdir(), "scriptr-e2e");

// Use port 3001 for e2e to avoid conflicting with a dev server already on 3000.
const E2E_PORT = process.env.E2E_PORT ? parseInt(process.env.E2E_PORT, 10) : 3001;
const E2E_URL = `http://127.0.0.1:${E2E_PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  // One worker — avoids port conflicts and race conditions on the single dev server.
  workers: 1,
  // Fail fast in CI; allow retries locally for flaky network.
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: E2E_URL,
    viewport: { width: 1440, height: 900 },
    // Capture trace on failure for debugging.
    trace: "on-first-retry",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    // Use the full next dev command with explicit port — avoids any confusion
    // from the npm script already having -p 3000 baked in.
    command: `npx next dev --webpack -H 127.0.0.1 -p ${E2E_PORT}`,
    url: E2E_URL,
    // Always launch a fresh isolated server — never reuse an existing dev
    // server that might be pointing at the user's real data/ directory.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      // Override the data directory so tests NEVER touch data/ in the repo.
      SCRIPTR_DATA_DIR: E2E_DATA_DIR,
    },
  },
});
