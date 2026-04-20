"use client";

import { useEffect, useRef, useState, useCallback } from "react";

export type AutoSaveStatus = "idle" | "saving" | "saved" | "error";

export interface UseAutoSaveOptions {
  debounceMs?: number;
  /** When false, all saves are suppressed (e.g. while unmounting). */
  enabled?: boolean;
}

export interface UseAutoSaveReturn {
  status: AutoSaveStatus;
  /** Cancel the pending debounce timer and save immediately. */
  flush: () => Promise<void>;
}

/**
 * Generic debounced auto-save hook.
 *
 * On each change of `value`, schedules `save(value)` after `debounceMs`
 * (default 500). Rapid changes coalesce — only the latest value is sent.
 * The first render is skipped (no save for the initial mount value).
 *
 * On unmount, any pending unsaved changes are flushed synchronously (fire-and-
 * forget) so that navigating away mid-debounce never silently drops edits.
 *
 * Caller note: wrap `save` in `useCallback` to keep a stable reference.
 * Internally we track `save` via a ref so that identity changes between
 * renders don't cause the debounce effect to re-fire.
 */
export function useAutoSave<T>(
  value: T,
  save: (v: T) => Promise<void>,
  options?: UseAutoSaveOptions,
): UseAutoSaveReturn {
  const { debounceMs = 500, enabled = true } = options ?? {};

  const [status, setStatus] = useState<AutoSaveStatus>("idle");

  // Keep latest save fn and value in refs so the effect closure stays current
  // without needing them in its dependency array.
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; }, [save]);

  const valueRef = useRef(value);
  useEffect(() => { valueRef.current = value; }, [value]);

  // Track enabled via ref so the unmount cleanup can read the latest value.
  const enabledRef = useRef(enabled);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  // Track whether this is the initial render — skip the first save.
  const isFirstRender = useRef(true);

  // Whether the component is still mounted (guards against state updates after
  // unmount when the async save promise resolves).
  const mountedRef = useRef(true);

  // The last value that was successfully handed to executeSave. Initialised to
  // the mount-time value so that an untouched field never triggers an unmount
  // flush (value !== lastSavedValueRef → false on first compare).
  const lastSavedValueRef = useRef<T>(value);

  // Ref holding the pending debounce timer ID.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Internal execute-save function (extracted so flush can call it too).
  const executeSave = useCallback(async (v: T) => {
    if (!mountedRef.current) return;
    setStatus("saving");
    try {
      await saveRef.current(v);
      lastSavedValueRef.current = v;
      if (mountedRef.current) setStatus("saved");
    } catch {
      if (mountedRef.current) setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (!enabled) return;

    // Reset any pending timer.
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }

    // Capture the value at scheduling time; the closure holds a snapshot.
    const scheduled = value;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void executeSave(scheduled);
    }, debounceMs);

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [value, enabled, debounceMs, executeSave]);

  // Unmount-only cleanup: flush any unsaved changes so navigating away mid-
  // debounce never silently drops edits.
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      // Cancel any pending debounce timer (the debounce effect's own cleanup
      // won't run again after this point).
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      // Fire-and-forget flush if there are unsaved changes and saves are enabled.
      if (
        enabledRef.current &&
        !isFirstRender.current &&
        valueRef.current !== lastSavedValueRef.current
      ) {
        saveRef.current(valueRef.current).catch(() => {
          // Pending save failed on unmount — component is gone, nothing to show.
        });
      }
    };
  }, []);

  const flush = useCallback(async () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // Only flush if we're past the first render and saves are enabled.
    if (isFirstRender.current || !enabled) return;
    await executeSave(valueRef.current);
  }, [enabled, executeSave]);

  return { status, flush };
}
