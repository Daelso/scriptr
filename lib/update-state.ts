// Renderer-safe type definitions for the update controller's state shape.
// The controller itself lives in electron/ (excluded from the renderer's
// tsconfig); this file is the renderer's window into the IPC contract.
export type UpdateState =
  | { kind: "idle"; lastCheckedAt: string | null; currentVersion: string }
  | { kind: "checking" }
  | { kind: "downloading"; version: string }
  | { kind: "downloaded"; version: string }
  | { kind: "error"; message: string };
