import { cp, mkdir, readFile, realpath, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { App, Dialog } from "electron";

/** User-facing error thrown when the user picks "Quit scriptr" at the migration prompt. */
export class StartupCancelledError extends Error {
  constructor() {
    super("scriptr needs a data folder to start. Reopen the app to choose again.");
    this.name = "StartupCancelledError";
  }
}

export type StartupInputs = {
  userData: string;
  defaultDataDir: string;
  locationJsonPath: string;
  candidates: string[];
  probeLocationJson: () => Promise<string | null>;
  probeConfigExists: (dir: string) => Promise<boolean>;
};

export type StartupDecision =
  | { kind: "use-override"; dataDir: string }
  | { kind: "boot"; dataDir: string }
  | { kind: "fresh"; dataDir: string }
  | { kind: "prompt"; candidate: string; targetIfCopy: string; locationJsonPath: string };

export async function decideStartupAction(inputs: StartupInputs): Promise<StartupDecision> {
  const override = await inputs.probeLocationJson();
  if (override) return { kind: "use-override", dataDir: override };

  if (await inputs.probeConfigExists(inputs.defaultDataDir)) {
    return { kind: "boot", dataDir: inputs.defaultDataDir };
  }

  for (const candidate of inputs.candidates) {
    if (await inputs.probeConfigExists(candidate)) {
      return {
        kind: "prompt",
        candidate,
        targetIfCopy: inputs.defaultDataDir,
        locationJsonPath: inputs.locationJsonPath,
      };
    }
  }

  return { kind: "fresh", dataDir: inputs.defaultDataDir };
}

// ─── Production executor ─────────────────────────────────────────────────────

export async function resolveDataDir(app: App, dialog: Dialog): Promise<string> {
  const userData = app.getPath("userData");
  const defaultDataDir = join(userData, "data");
  const locationJsonPath = join(userData, "location.json");

  const decision = await decideStartupAction({
    userData,
    defaultDataDir,
    locationJsonPath,
    candidates: candidatesFromEnv(),
    probeLocationJson: async () => {
      try {
        const raw = await readFile(locationJsonPath, "utf-8");
        const parsed = JSON.parse(raw) as { dataDir?: string };
        return parsed.dataDir ?? null;
      } catch {
        return null;
      }
    },
    probeConfigExists: async (dir) => {
      try {
        await stat(join(dir, "config.json"));
        return true;
      } catch {
        return false;
      }
    },
  });

  switch (decision.kind) {
    case "use-override":
    case "boot":
      return decision.dataDir;

    case "fresh":
      await mkdir(decision.dataDir, { recursive: true });
      return decision.dataDir;

    case "prompt": {
      // Reject candidates that contain symlinks pointing outside themselves —
      // a malicious cwd (e.g. user double-clicks the app from a hostile
      // Downloads folder) could otherwise inject content into the trusted
      // data directory via a planted ./data/ with a symlink in it.
      const safe = await isCandidateSafe(decision.candidate);
      if (!safe) {
        await dialog.showErrorBox(
          "scriptr",
          `Refusing to migrate ${decision.candidate} — directory contains symlinks. ` +
            `Move or copy the data folder manually if it's legitimate.`,
        );
        throw new StartupCancelledError();
      }

      const { response } = await dialog.showMessageBox({
        type: "question",
        buttons: ["Copy to new location", "Use in place", "Quit scriptr"],
        defaultId: 0,
        cancelId: 2,
        message: "Existing scriptr data found",
        detail:
          `Found scriptr data at ${decision.candidate}.\n\n` +
          `Copy it to the standard app-data location (${decision.targetIfCopy}),\n` +
          `or keep the existing folder and point the app there?`,
      });
      if (response === 0) {
        // verbatimSymlinks preserves any symlinks as links rather than copying
        // through them; combined with the safety check above, the target dir
        // ends up with the same shape as the source.
        await cp(decision.candidate, decision.targetIfCopy, {
          recursive: true,
          verbatimSymlinks: true,
        });
        return decision.targetIfCopy;
      }
      if (response === 1) {
        await mkdir(userData, { recursive: true });
        await writeFile(
          decision.locationJsonPath,
          JSON.stringify({ dataDir: decision.candidate }, null, 2),
          "utf-8",
        );
        return decision.candidate;
      }
      throw new StartupCancelledError();
    }
  }
}

/**
 * A candidate data directory is "safe" if its real path equals its given path
 * (no symlink redirection on the directory itself) and no file/dir anywhere
 * under it is a symlink. We reject at discovery time so migration never
 * copies a tree that can later pivot outside the trusted data root.
 */
export async function isCandidateSafe(candidate: string): Promise<boolean> {
  try {
    const real = await realpath(candidate);
    if (real !== candidate) return false;
    if (await treeContainsSymlink(candidate)) return false;
    return true;
  } catch {
    return false;
  }
}

async function treeContainsSymlink(root: string): Promise<boolean> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) return true;
    if (entry.isDirectory()) {
      if (await treeContainsSymlink(join(root, entry.name))) return true;
    }
  }
  return false;
}

function candidatesFromEnv(): string[] {
  const out: string[] = [];
  out.push(join(process.cwd(), "data"));
  if (process.resourcesPath) out.push(join(process.resourcesPath, "data"));
  return out;
}
