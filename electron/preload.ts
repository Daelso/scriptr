// Loaded into every BrowserWindow via webPreferences.preload (configured in
// main.ts). Runs in an isolated context (contextIsolation=true, sandbox=true)
// and may only communicate with the renderer through contextBridge.
//
// Exposed surface is intentionally tiny. We never expose ipcRenderer directly
// — that would let the renderer call any IPC channel and re-introduce the
// node-integration risk we've defended against everywhere else.
import { contextBridge, ipcRenderer } from "electron";
import type { UpdateState } from "../lib/update-state";

contextBridge.exposeInMainWorld("scriptr", {
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke("dialog:pickFolder"),
  revealInFolder: (path: string): Promise<void> =>
    ipcRenderer.invoke("shell:revealInFolder", path),
  openFile: (path: string): Promise<void> =>
    ipcRenderer.invoke("shell:openFile", path),
});

contextBridge.exposeInMainWorld("scriptrUpdates", {
  checkNow: (): Promise<UpdateState> => ipcRenderer.invoke("updates:check"),
  installNow: (): Promise<void> => ipcRenderer.invoke("updates:install"),
  getState: (): Promise<UpdateState> => ipcRenderer.invoke("updates:get-state"),
});
