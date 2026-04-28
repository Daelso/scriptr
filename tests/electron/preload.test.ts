import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock electron *before* importing the preload, since the preload calls
// contextBridge.exposeInMainWorld at module-eval time.
const exposeInMainWorld = vi.fn();
const invoke = vi.fn();

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: { invoke },
}));

// The preload makes two exposeInMainWorld calls: one for `scriptr` (the
// existing folder-picker bridge) and one for `scriptrUpdates` (the manual
// update bridge added by this feature). These tests focus on `scriptrUpdates`.
function findExposed(name: string): Record<string, (...args: unknown[]) => unknown> | undefined {
  for (const call of exposeInMainWorld.mock.calls) {
    if (call[0] === name) return call[1] as Record<string, (...args: unknown[]) => unknown>;
  }
  return undefined;
}

describe("preload — scriptrUpdates bridge", () => {
  beforeEach(() => {
    vi.resetModules();
    exposeInMainWorld.mockClear();
    invoke.mockClear();
  });

  it("exposes a global named 'scriptrUpdates' with exactly three methods", async () => {
    await import("@/electron/preload");
    const api = findExposed("scriptrUpdates");
    expect(api).toBeDefined();
    expect(typeof api!.checkNow).toBe("function");
    expect(typeof api!.installNow).toBe("function");
    expect(typeof api!.getState).toBe("function");
    // No accidental ipcRenderer leak
    expect((api as Record<string, unknown>).ipcRenderer).toBeUndefined();
    expect(Object.keys(api!).sort()).toEqual(["checkNow", "getState", "installNow"]);
  });

  it("checkNow invokes the 'updates:check' IPC channel", async () => {
    await import("@/electron/preload");
    const api = findExposed("scriptrUpdates")!;
    invoke.mockResolvedValueOnce({ kind: "idle", lastCheckedAt: null, currentVersion: "0.3.0" });
    const r = await api.checkNow();
    expect(invoke).toHaveBeenCalledWith("updates:check");
    expect(r).toEqual({ kind: "idle", lastCheckedAt: null, currentVersion: "0.3.0" });
  });

  it("installNow invokes 'updates:install'", async () => {
    await import("@/electron/preload");
    const api = findExposed("scriptrUpdates")!;
    invoke.mockResolvedValueOnce(undefined);
    await api.installNow();
    expect(invoke).toHaveBeenCalledWith("updates:install");
  });

  it("getState invokes 'updates:get-state'", async () => {
    await import("@/electron/preload");
    const api = findExposed("scriptrUpdates")!;
    invoke.mockResolvedValueOnce({ kind: "idle", lastCheckedAt: null, currentVersion: "0.3.0" });
    await api.getState();
    expect(invoke).toHaveBeenCalledWith("updates:get-state");
  });
});
