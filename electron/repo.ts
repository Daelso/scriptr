// Single source of truth for the GitHub repo coordinates. Reads from
// package.json#repository.url so external-link allowlisting in main.ts and
// electron-builder.yml's publish config don't drift apart on a repo move.
// electron-builder also auto-detects from package.json#repository when
// publish.owner/repo are omitted; we leave the YAML clean and rely on
// this one declaration.
//
// Why readFileSync at runtime instead of `import pkg from "../package.json"`:
// `import` is resolved at compile time AND its literal string is preserved
// in the emitted JS. After tsc compiles `electron/repo.ts` → `dist/electron/
// repo.js`, the `require("../package.json")` call resolves to
// `dist/package.json` (which doesn't exist) — package.json sits at the asar
// root (../../package.json from `dist/electron/`). __dirname-based read
// works correctly in both dev and packaged builds because the relative
// path from the COMPILED file location to the bundled package.json is the
// same in both cases (asar paths are transparent to fs).

import { readFileSync } from "node:fs";
import { join } from "node:path";

// Hardcoded fallback — used only if package.json can't be read or parsed.
// If the repo moves, update package.json#repository.url AND keep this fallback
// in sync. The fallback exists so a single bad release doesn't lock users out
// of valid external links — defense in depth.
const FALLBACK_OWNER = "Daelso";
const FALLBACK_REPO = "scriptr";

function readRepo(): { owner: string; repo: string } | null {
  try {
    const pkgPath = join(__dirname, "..", "..", "package.json");
    const raw = readFileSync(pkgPath, "utf-8");
    const parsed = JSON.parse(raw) as { repository?: { url?: string } };
    const url = parsed.repository?.url;
    if (!url) return null;
    // Accepts https://github.com/<owner>/<repo>.git or git@github.com:<owner>/<repo>.git
    const match = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
    return match ? { owner: match[1], repo: match[2] } : null;
  } catch {
    return null;
  }
}

const detected = readRepo();
export const GITHUB_OWNER = detected?.owner ?? FALLBACK_OWNER;
export const GITHUB_REPO = detected?.repo ?? FALLBACK_REPO;
export const GITHUB_REPO_PATH = `/${GITHUB_OWNER}/${GITHUB_REPO}`;
