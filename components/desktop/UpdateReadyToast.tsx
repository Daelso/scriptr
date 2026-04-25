"use client";

import { useEffect } from "react";
import { toast } from "sonner";

/**
 * Listens for the `scriptr:update-ready` CustomEvent that the Electron main
 * process dispatches when `electron-updater` finishes downloading a new
 * version. Shows a Sonner toast with the version + a hint that the update
 * applies on next launch (autoInstallOnAppQuit = true).
 *
 * No-op in the web build — the event simply never fires.
 */
export function UpdateReadyToast() {
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      const version = typeof detail === "string" ? detail : "new version";
      toast.success(`Update ${version} downloaded`, {
        description: "Quit and reopen scriptr to install.",
        duration: Infinity,
        closeButton: true,
      });
    };
    window.addEventListener("scriptr:update-ready", handler);
    return () => window.removeEventListener("scriptr:update-ready", handler);
  }, []);

  return null;
}
