"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type Editor, useEditorState } from "@tiptap/react";
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
 * Keybinds (when find/replace inputs have focus):
 *  - Enter        — next match
 *  - Shift+Enter  — previous match
 *  - Esc          — close (clears highlights, returns focus to editor)
 *
 * Esc also closes the bar from any focused control (handled at the wrapper),
 * so a user who clicked Replace All and then hits Esc gets the same dismissal.
 */
export function FindReplaceBar({ editor, mode, onModeChange, onClose }: FindReplaceBarProps) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const findInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  // Push the active SearchQuery into the prosemirror-search plugin whenever
  // the user changes the inputs. Meta-only transaction (no doc change), so
  // this does NOT fire the editor's onUpdate / dirty the autosave buffer.
  useEffect(() => {
    const tr = setSearchState(
      editor.state.tr,
      new SearchQuery({ search: query, replace: replacement, caseSensitive, wholeWord }),
    );
    editor.view.dispatch(tr);
  }, [editor, query, replacement, caseSensitive, wholeWord]);

  // On mode change, focus the input that just appeared (or stayed) so the
  // user can type immediately without an extra Tab. Also runs on initial
  // mount, replacing the previous "focus on mount" effect.
  useEffect(() => {
    const target = mode === "replace" ? replaceInputRef.current : findInputRef.current;
    target?.focus();
    target?.select();
  }, [mode]);

  // Cleanup: clear highlights + active query when the bar unmounts. The view
  // may already be torn down (parent unmount → useEditor disposes the view),
  // hence the try/catch — narrowly scoped to the dispatch only.
  useEffect(() => {
    return () => {
      try {
        const tr = setSearchState(editor.state.tr, new SearchQuery({ search: "" }));
        editor.view.dispatch(tr);
      } catch {
        // editor torn down — nothing to clean.
      }
    };
  }, [editor]);

  // Match counter + active-match index, derived from the plugin's decoration
  // set. `useEditorState` re-evaluates on every transaction with reference
  // equality on the returned object — exactly what we need for the counter
  // and the disabled-state of replace buttons.
  const { total, current } = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (query === "") return { total: 0, current: 0 };
      const decos = getMatchHighlights(e.state).find();
      const sel = e.state.selection;
      let activeIdx = 0;
      for (let i = 0; i < decos.length; i++) {
        const d = decos[i];
        if (d.from === sel.from && d.to === sel.to) {
          activeIdx = i + 1;
          break;
        }
      }
      return { total: decos.length, current: activeIdx };
    },
    equalityFn: (a, b) => a.total === b?.total && a.current === b?.current,
  }) ?? { total: 0, current: 0 };

  const announce = useCallback((msg: string) => setAnnouncement(msg), []);

  const announceForCount = useCallback(
    (active: number, totalNow: number) => {
      if (totalNow === 0) {
        announce("No matches");
      } else {
        announce(`Match ${active || 1} of ${totalNow}`);
      }
    },
    [announce],
  );

  // ProseMirror's built-in scrollIntoView (triggered by findNext's
  // tr.scrollIntoView()) bails when the DOM selection's focusNode isn't
  // inside view.dom — see prosemirror-view/src/index.ts scrollToSelection.
  // While the user is typing in the find input, focus IS in the input, so
  // the scroll silently no-ops. Manually scroll the active match's DOM node
  // instead. `block: "center"` also clears the sticky bar at the top of the
  // scroll container.
  //
  // We skip the scroll when the match is already comfortably visible —
  // re-centering text the user can already see is more disruptive than
  // helpful. The sticky find bar covers the top of the scroll pane, so
  // matches whose top edge sits behind it are treated as "not visible"
  // and still get scrolled.
  const scrollActiveMatchIntoView = useCallback(() => {
    const active = editor.view.dom.querySelector(".ProseMirror-active-search-match");
    if (!(active instanceof HTMLElement)) return;

    const doc = active.ownerDocument;
    const viewportBottom = doc.defaultView?.innerHeight ?? doc.documentElement.clientHeight;
    const findBar = doc.querySelector('[role="search"]');
    const findBarBottom =
      findBar instanceof HTMLElement ? findBar.getBoundingClientRect().bottom : 0;
    const r = active.getBoundingClientRect();
    if (r.top >= findBarBottom && r.bottom <= viewportBottom) return;

    active.scrollIntoView({ block: "center", behavior: "auto" });
  }, [editor]);

  const next = useCallback(() => {
    if (query === "") return;
    findNext(editor.state, editor.view.dispatch);
    scrollActiveMatchIntoView();
    // Counter updates via useEditorState on the next paint; for the SR
    // announcement we read the post-transaction selection synchronously.
    const decos = getMatchHighlights(editor.state).find();
    const sel = editor.state.selection;
    const idx = decos.findIndex((d) => d.from === sel.from && d.to === sel.to);
    announceForCount(idx >= 0 ? idx + 1 : 0, decos.length);
  }, [editor, query, announceForCount, scrollActiveMatchIntoView]);

  const prev = useCallback(() => {
    if (query === "") return;
    findPrev(editor.state, editor.view.dispatch);
    scrollActiveMatchIntoView();
    const decos = getMatchHighlights(editor.state).find();
    const sel = editor.state.selection;
    const idx = decos.findIndex((d) => d.from === sel.from && d.to === sel.to);
    announceForCount(idx >= 0 ? idx + 1 : 0, decos.length);
  }, [editor, query, announceForCount, scrollActiveMatchIntoView]);

  const doReplace = useCallback(() => {
    if (query === "" || total === 0) return;
    // replaceCurrent only acts when the selection IS the active match;
    // if the user's caret is elsewhere, jump to the next match first so
    // their first Replace click never silently no-ops.
    const sel = editor.state.selection;
    const decos = getMatchHighlights(editor.state).find();
    const onMatch = decos.some((d) => d.from === sel.from && d.to === sel.to);
    if (!onMatch) {
      findNext(editor.state, editor.view.dispatch);
      scrollActiveMatchIntoView();
      announce(`Match 1 of ${decos.length}`);
      return;
    }
    replaceCurrent(editor.state, editor.view.dispatch);
    findNext(editor.state, editor.view.dispatch);
    scrollActiveMatchIntoView();
    const after = getMatchHighlights(editor.state).find();
    announce(after.length === 0 ? "Replaced; no more matches" : `Replaced; ${after.length} remaining`);
  }, [editor, query, total, announce, scrollActiveMatchIntoView]);

  const doReplaceAll = useCallback(() => {
    if (query === "" || total === 0) return;
    const before = total;
    replaceAll(editor.state, editor.view.dispatch);
    announce(`Replaced ${before} match${before === 1 ? "" : "es"}`);
  }, [editor, query, total, announce]);

  const onInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) prev();
        else next();
      }
    },
    [next, prev, onClose],
  );

  const counterText =
    query === ""
      ? ""
      : total === 0
        ? "No matches"
        : current === 0
          ? `${total} match${total === 1 ? "" : "es"}`
          : `${current} of ${total}`;

  const replaceDisabled = query === "" || total === 0;

  return (
    <div
      role="search"
      aria-label={mode === "replace" ? "Find and replace in section" : "Find in section"}
      onKeyDown={(e) => {
        // Catches Escape after a button click (when focus isn't on an input).
        // Input-level handlers stopPropagation, so this only fires for
        // non-input descendants.
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
      className="sticky top-0 z-20 mb-2 flex flex-col gap-1.5 rounded-md border bg-background/95 p-2 text-sm shadow-sm backdrop-blur-sm"
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
        <span className="min-w-[5.5rem] text-center text-xs tabular-nums text-muted-foreground">
          {counterText}
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
          aria-label="Toggle replace mode"
          title="Toggle replace mode"
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={replaceDisabled}
            onClick={doReplace}
          >
            Replace
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={replaceDisabled}
            onClick={doReplaceAll}
          >
            Replace all
          </Button>
        </div>
      )}
      {/* Hidden live region — only updated on explicit nav/replace actions
          so screen readers don't get a torrent on every keystroke. */}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}
