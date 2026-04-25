import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { App, Dialog } from "electron";

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
      const { response } = await dialog.showMessageBox({
        type: "question",
        buttons: ["Copy to new location", "Use in place", "Cancel"],
        defaultId: 0,
        cancelId: 2,
        message: "Existing scriptr data found",
        detail:
          `Found scriptr data at ${decision.candidate}.\n\n` +
          `Copy it to the standard app-data location (${decision.targetIfCopy}),\n` +
          `or keep the existing folder and point the app there?`,
      });
      if (response === 0) {
        await cp(decision.candidate, decision.targetIfCopy, { recursive: true });
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
      throw new Error("Startup cancelled by user at migration prompt");
    }
  }
}

function candidatesFromEnv(): string[] {
  const out: string[] = [];
  out.push(join(process.cwd(), "data"));
  if (process.resourcesPath) out.push(join(process.resourcesPath, "data"));
  return out;
}
