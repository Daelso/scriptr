"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import type { UpdateState } from "@/lib/update-state";

/**
 * Listens for the `scriptr:update-state` CustomEvent that the Electron
 * main process dispatches on every UpdateController state transition.
 * Fires a Sonner toast only when the state transitions into `downloaded`.
 *
 * No-op in the web build — the event simply never fires.
 */
export function UpdateReadyToast() {
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<UpdateState>).detail;
      if (!detail || detail.kind !== "downloaded") return;
      toast.success(`Update ${detail.version} downloaded`, {
        description: "Quit and reopen scriptr to install.",
        duration: Infinity,
        closeButton: true,
      });
    };
    window.addEventListener("scriptr:update-state", handler);
    return () => window.removeEventListener("scriptr:update-state", handler);
  }, []);

  return null;
}
