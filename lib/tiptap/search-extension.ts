import { Extension } from "@tiptap/core";
import { search } from "prosemirror-search";

/**
 * Tiptap wrapper around `prosemirror-search` (MIT, by ProseMirror's author).
 * The plugin maintains the active search query + range and decorates matches
 * with `ProseMirror-search-match` / `ProseMirror-active-search-match`. The
 * actual find/replace UI dispatches transactions via the prosemirror-search
 * commands directly against the editor's view.
 */
export const SearchExtension = Extension.create({
  name: "scriptrSearch",
  addProseMirrorPlugins() {
    return [search()];
  },
});
