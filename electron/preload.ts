import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("scriptr", {
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke("dialog:pickFolder"),
  revealInFolder: (path: string): Promise<void> =>
    ipcRenderer.invoke("shell:revealInFolder", path),
  openFile: (path: string): Promise<void> =>
    ipcRenderer.invoke("shell:openFile", path),
});
