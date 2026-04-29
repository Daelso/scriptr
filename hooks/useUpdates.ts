"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UpdateState } from "@/lib/update-state";

export type UseUpdatesResult = {
  state: UpdateState | null;
  justFinishedNoUpdate: boolean;
  checkNow: (() => Promise<UpdateState>) | null;
  installNow: (() => Promise<void>) | null;
  // Opens data/logs/updates.log in the OS default text editor (via the
  // existing shell:openFile IPC handler, which restricts opens to
  // data-dir-rooted paths). Null in the web build.
  openUpdateLog: (() => Promise<void>) | null;
};

/**
 * Renderer hook for the manual update flow. Bridges to `window.scriptrUpdates`
 * (exposed by electron/preload.ts). Returns nulls in the web build, where
 * `window.scriptrUpdates` is undefined.
 *
 * Tracks a renderer-local `justFinishedNoUpdate` boolean: flips true on a
 * `checking → idle` transition (without intervening downloading/downloaded);
 * clears on the next non-idle transition. The controller's state shape
 * itself stays clean — display state doesn't leak into the IPC contract.
 */
export function useUpdates(): UseUpdatesResult {
  const bridge = typeof window !== "undefined" ? window.scriptrUpdates : undefined;

  const [state, setState] = useState<UpdateState | null>(null);
  const [justFinishedNoUpdate, setJustFinished] = useState(false);
  const lastKindRef = useRef<UpdateState["kind"] | null>(null);

  useEffect(() => {
    if (!bridge) return;

    let cancelled = false;
    bridge
      .getState()
      .then((s) => {
        if (cancelled) return;
        setState(s);
        lastKindRef.current = s.kind;
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : "bridge unavailable";
        setState({ kind: "error", message });
      });

    const handler = (e: Event) => {
      const next = (e as CustomEvent<UpdateState>).detail;
      if (!next) return;
      const prev = lastKindRef.current;
      // Edge: checking → idle (no update found) flips the flag.
      // Anything that goes through downloading/downloaded shouldn't flip it,
      // because the user clearly *did* find an update — the "you're on the
      // latest" line would be a lie.
      if (prev === "checking" && next.kind === "idle") {
        setJustFinished(true);
      } else if (next.kind !== "idle") {
        setJustFinished(false);
      }
      // (Idle → idle re-broadcast preserves the flag.)
      lastKindRef.current = next.kind;
      setState(next);
    };
    window.addEventListener("scriptr:update-state", handler);
    return () => {
      cancelled = true;
      window.removeEventListener("scriptr:update-state", handler);
    };
  }, [bridge]);

  const checkNow = useCallback(async () => {
    if (!bridge) throw new Error("scriptrUpdates bridge is not available");
    return bridge.checkNow();
  }, [bridge]);

  const installNow = useCallback(async () => {
    if (!bridge) throw new Error("scriptrUpdates bridge is not available");
    return bridge.installNow();
  }, [bridge]);

  const openUpdateLog = useCallback(async () => {
    if (!bridge) throw new Error("scriptrUpdates bridge is not available");
    const path = await bridge.getLogPath();
    // Defer to the existing shell:openFile bridge so we reuse its
    // pathIsUnderAllowedRoot guard rather than introducing a second one.
    if (typeof window === "undefined" || !window.scriptr) {
      throw new Error("scriptr bridge is not available");
    }
    await window.scriptr.openFile(path);
  }, [bridge]);

  return {
    state,
    justFinishedNoUpdate,
    checkNow: bridge ? checkNow : null,
    installNow: bridge ? installNow : null,
    openUpdateLog: bridge ? openUpdateLog : null,
  };
}
