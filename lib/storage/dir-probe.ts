import { isAbsolute, join } from "node:path";
import { stat, writeFile, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";

export type ProbeResult =
  | { ok: true }
  | { ok: false; reason: "not-absolute" | "not-found" | "not-a-directory" | "not-writable" };

/**
 * Verify that `dir` is an absolute, existing, writable directory by writing
 * and unlinking a uniquely-named 0-byte file. fs.access(W_OK) is unreliable
 * on Windows (it reads the read-only attribute, not effective ACLs); the
 * temp-file probe is the only check that's correct on every supported OS.
 */
export async function probeWritableDir(dir: string): Promise<ProbeResult> {
  if (!isAbsolute(dir)) return { ok: false, reason: "not-absolute" };
  let s;
  try {
    s = await stat(dir);
  } catch {
    return { ok: false, reason: "not-found" };
  }
  if (!s.isDirectory()) return { ok: false, reason: "not-a-directory" };
  const probePath = join(dir, `.scriptr-write-probe-${randomBytes(8).toString("hex")}`);
  try {
    await writeFile(probePath, "");
  } catch {
    return { ok: false, reason: "not-writable" };
  }
  try {
    await unlink(probePath);
  } catch {
    // Probe file written but couldn't be unlinked. Best-effort cleanup
    // failure shouldn't fail the probe — leaving a stray dotfile is
    // strictly preferable to telling the user the dir is unwritable when
    // it isn't.
  }
  return { ok: true };
}

type ProbeFailReason = Exclude<ProbeResult, { ok: true }>["reason"];

/**
 * Map a probe failure reason to a human-readable detail suitable for use in
 * a 400 response. Shared by every caller of `probeWritableDir` so a new
 * reason added to `ProbeResult` is a compile error here, surfacing it
 * everywhere it's used.
 */
export function probeFailDetail(reason: ProbeFailReason): string {
  switch (reason) {
    case "not-absolute":
      return "must be an absolute path";
    case "not-found":
      return "directory does not exist";
    case "not-a-directory":
      return "path is not a directory";
    case "not-writable":
      return "directory is not writable";
  }
}
