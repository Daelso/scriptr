"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  SearchQuery,
  findNext,
  findPrev,
  getMatchHighlights,
  replaceCurrent,
  replaceAll,
  setSearchState,
} from "prosemirror-search";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export type FindBarMode = "find" | "replace";

interface FindReplaceBarProps {
  editor: Editor;
  mode: FindBarMode;
  onModeChange: (mode: FindBarMode) => void;
  onClose: () => void;
}

/**
 * Find / find-and-replace bar bound to a single Tiptap (ProseMirror) editor.
 * Driven by `prosemirror-search` — see lib/tiptap/search-extension.ts.
 *
 * Keybinds (when the find/replace inputs have focus):
 *  - Enter           — next match
 *  - Shift+Enter     — previous match
 *  - Esc             — close (clears highlights)
 *  - Tab             — moves to the next control (browser default)
 */
export function FindReplaceBar({ editor, mode, onModeChange, onClose }: FindReplaceBarProps) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const findInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  // Trigger a re-render on any editor transaction so the match counter and
  // active-match index stay in sync with the editor state.
  const [, forceUpdate] = useState({});
  useEffect(() => {
    const handler = () => forceUpdate({});
    editor.on("transaction", handler);
    return () => {
      editor.off("transaction", handler);
    };
  }, [editor]);

  // Build the active SearchQuery from current bar state.
  const buildQuery = useCallback(
    (search: string, replace: string): SearchQuery =>
      new SearchQuery({
        search,
        replace,
        caseSensitive,
        wholeWord,
      }),
    [caseSensitive, wholeWord],
  );

  // Push the query into the prosemirror-search plugin whenever it changes.
  useEffect(() => {
    const tr = setSearchState(editor.state.tr, buildQuery(query, replacement));
    editor.view.dispatch(tr);
  }, [editor, query, replacement, buildQuery]);

  // Focus the appropriate input on mount + when mode changes.
  useEffect(() => {
    const target = mode === "replace" && replaceInputRef.current?.value
      ? replaceInputRef.current
      : findInputRef.current;
    target?.focus();
    target?.select();
  }, [mode]);

  // Cleanup: clear highlights + active query when the bar unmounts.
  useEffect(() => {
    return () => {
      // The editor view may already be destroyed (e.g., parent unmounting).
      try {
        const tr = setSearchState(editor.state.tr, new SearchQuery({ search: "" }));
        editor.view.dispatch(tr);
      } catch {
        // editor torn down — nothing to clean.
      }
    };
  }, [editor]);

  // Match counter + current-active index, derived from the plugin's
  // decoration set. `getMatchHighlights().find()` returns decorations in
  // document order, so the active index is just whichever decoration overlaps
  // the current selection.
  const { total, current } = useMemo(() => {
    if (query === "") return { total: 0, current: 0 };
    const decos = getMatchHighlights(editor.state).find();
    const sel = editor.state.selection;
    let activeIdx = 0;
    for (let i = 0; i < decos.length; i++) {
      const d = decos[i];
      if (d.from === sel.from && d.to === sel.to) {
        activeIdx = i + 1;
        break;
      }
    }
    return { total: decos.length, current: activeIdx };
    // Re-run on every transaction (forceUpdate ticks the dependency)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, query, caseSensitive, wholeWord, editor.state]);

  const next = useCallback(() => {
    if (query === "") return;
    findNext(editor.state, editor.view.dispatch);
    editor.view.focus();
  }, [editor, query]);

  const prev = useCallback(() => {
    if (query === "") return;
    findPrev(editor.state, editor.view.dispatch);
    editor.view.focus();
  }, [editor, query]);

  const doReplace = useCallback(() => {
    if (query === "") return;
    // replaceCurrent replaces the active selection if it matches; if nothing
    // is selected yet, jump to the first match instead so the user's first
    // click on Replace doesn't silently no-op.
    const sel = editor.state.selection;
    const decos = getMatchHighlights(editor.state).find();
    const onMatch = decos.some((d) => d.from === sel.from && d.to === sel.to);
    if (!onMatch) {
      findNext(editor.state, editor.view.dispatch);
      return;
    }
    replaceCurrent(editor.state, editor.view.dispatch);
    findNext(editor.state, editor.view.dispatch);
  }, [editor, query]);

  const doReplaceAll = useCallback(() => {
    if (query === "") return;
    replaceAll(editor.state, editor.view.dispatch);
  }, [editor, query]);

  const onInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) prev();
        else next();
      }
    },
    [next, prev, onClose],
  );

  const counter =
    query === ""
      ? ""
      : total === 0
        ? "0/0"
        : `${current === 0 ? "·" : current}/${total}`;

  return (
    <div
      role="dialog"
      aria-label={mode === "replace" ? "Find and replace" : "Find"}
      onKeyDown={(e) => {
        // Catch Escape anywhere in the bar (e.g., after clicking a button,
        // when focus is no longer on an input). The input-level handler
        // covers the typing-then-Esc path; this covers the clicking path.
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
      className="mb-2 flex flex-col gap-1.5 rounded-md border bg-muted/40 p-2 text-sm shadow-sm"
    >
      <div className="flex items-center gap-2">
        <Input
          ref={findInputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder="Find"
          aria-label="Find"
          className="h-8 flex-1"
        />
        <span
          aria-live="polite"
          className="min-w-[3.5rem] text-center text-xs tabular-nums text-muted-foreground"
        >
          {counter}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={caseSensitive}
          aria-label="Match case"
          title="Match case"
          className={caseSensitive ? "bg-accent" : ""}
          onClick={() => setCaseSensitive((v) => !v)}
        >
          Aa
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={wholeWord}
          aria-label="Whole word"
          title="Whole word"
          className={wholeWord ? "bg-accent" : ""}
          onClick={() => setWholeWord((v) => !v)}
        >
          W
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Previous match"
          title="Previous (Shift+Enter)"
          onClick={prev}
        >
          ↑
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Next match"
          title="Next (Enter)"
          onClick={next}
        >
          ↓
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={mode === "replace"}
          aria-label={mode === "replace" ? "Hide replace" : "Show replace"}
          title={mode === "replace" ? "Hide replace" : "Replace…"}
          className={mode === "replace" ? "bg-accent" : ""}
          onClick={() => onModeChange(mode === "replace" ? "find" : "replace")}
        >
          ⇄
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Close find bar"
          title="Close (Esc)"
          onClick={onClose}
        >
          ✕
        </Button>
      </div>
      {mode === "replace" && (
        <div className="flex items-center gap-2">
          <Input
            ref={replaceInputRef}
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Replace"
            aria-label="Replace"
            className="h-8 flex-1"
          />
          <Button type="button" variant="outline" size="sm" onClick={doReplace}>
            Replace
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={doReplaceAll}>
            Replace all
          </Button>
        </div>
      )}
    </div>
  );
}
