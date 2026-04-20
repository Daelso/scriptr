"use client";

import { useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface StreamOverlayProps {
  /**
   * Abort the current stream. Fire-and-forget; EditorPane's terminal effect
   * handles SWR revalidation + store reset.
   */
  onStop: () => void;
  /**
   * Stop the current stream and kick off a continue generation with the given
   * regen note. EditorPane orchestrates the stop → revalidate → start sequence
   * so the pivot uses the last persisted section id.
   */
  onSteer: (note: string) => void;
  /**
   * True while the overlay cannot initiate a new action — e.g. the stop has
   * already been dispatched and EditorPane is awaiting terminal revalidation.
   */
  disabled?: boolean;
}

/**
 * Floating "Stop & Steer" panel pinned to the bottom-center of the editor pane
 * while a stream is active. Purely presentational — EditorPane hosts the
 * `useStreamGenerate` hook instance and the store, and wires the callbacks.
 *
 * Keyboard:
 *   - Esc anywhere on the overlay stops the stream.
 *   - Ctrl/Cmd+Enter in the note input triggers Steer.
 */
export function StreamOverlay({ onStop, onSteer, disabled }: StreamOverlayProps) {
  const [note, setNote] = useState("");

  const handleSteer = () => {
    if (disabled) return;
    onSteer(note);
    setNote("");
  };

  const handleStop = () => {
    if (disabled) return;
    onStop();
  };

  const handleContainerKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      handleStop();
    }
  };

  const handleInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSteer();
    }
  };

  return (
    <div
      role="region"
      aria-label="Stream controls"
      onKeyDown={handleContainerKeyDown}
      className="fixed bottom-6 left-1/2 z-50 w-full max-w-lg -translate-x-1/2 rounded-lg border border-border bg-background/95 p-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80"
    >
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={handleStop}
          disabled={disabled}
          aria-label="Stop generation"
        >
          Stop
        </Button>
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder="Steer with a note…"
          aria-label="Steer with a note"
          disabled={disabled}
          className="flex-1"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleSteer}
          disabled={disabled}
          aria-label="Steer"
        >
          Steer
        </Button>
      </div>
    </div>
  );
}
