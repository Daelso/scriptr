import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Verify that electron/preload.ts exposes ONLY the documented bridges via
 * contextBridge. The renderer's privileged surface is the preload bridge —
 * anything exposed here is reachable from a compromised renderer.
 *
 * Two bridges are expected: `scriptr` (folder picker / shell helpers from
 * PR #14) and `scriptrUpdates` (manual update flow). The `scriptrUpdates`
 * surface is verified in detail in tests/electron/preload.test.ts.
 */
describe("electron/preload bridge", () => {
  let exposed: Record<string, unknown> = {};

  beforeEach(() => {
    exposed = {};
    vi.resetModules();
    vi.doMock("electron", () => ({
      contextBridge: {
        exposeInMainWorld: (key: string, value: unknown) => {
          exposed[key] = value;
        },
      },
      ipcRenderer: {
        invoke: vi.fn(),
      },
    }));
  });

  it("exposes `scriptr` (folder/shell helpers) and `scriptrUpdates` (update flow)", async () => {
    await import("../../electron/preload");
    expect(Object.keys(exposed).sort()).toEqual(["scriptr", "scriptrUpdates"]);
    const api = exposed.scriptr as Record<string, unknown>;
    expect(typeof api.pickFolder).toBe("function");
    expect(typeof api.revealInFolder).toBe("function");
    expect(typeof api.openFile).toBe("function");
    expect(Object.keys(api).sort()).toEqual([
      "openFile",
      "pickFolder",
      "revealInFolder",
    ]);
  });

  it("each method invokes its expected IPC channel", async () => {
    const electron = await import("electron");
    const invoke = (electron.ipcRenderer.invoke as ReturnType<typeof vi.fn>);
    invoke.mockResolvedValue("ok");

    await import("../../electron/preload");
    const api = exposed.scriptr as {
      pickFolder: () => Promise<unknown>;
      revealInFolder: (p: string) => Promise<unknown>;
      openFile: (p: string) => Promise<unknown>;
    };

    await api.pickFolder();
    expect(invoke).toHaveBeenCalledWith("dialog:pickFolder");

    invoke.mockClear();
    await api.revealInFolder("/abs/path/file.epub");
    expect(invoke).toHaveBeenCalledWith("shell:revealInFolder", "/abs/path/file.epub");

    invoke.mockClear();
    await api.openFile("/abs/path/file.epub");
    expect(invoke).toHaveBeenCalledWith("shell:openFile", "/abs/path/file.epub");
  });
});
