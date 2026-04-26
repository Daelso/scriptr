import { randomBytes } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const pathLocks = new Map<string, Promise<void>>();

/**
 * Serialize async tasks by key within this process.
 */
export async function withPathLock<T>(
  key: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = pathLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const current = previous.then(() => gate);
  pathLocks.set(key, current);

  await previous;
  try {
    return await task();
  } finally {
    release();
    if (pathLocks.get(key) === current) {
      pathLocks.delete(key);
    }
  }
}

/**
 * Write JSON via temp-file + rename so readers never observe torn bytes.
 */
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(value, null, 2), "utf-8");
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}
