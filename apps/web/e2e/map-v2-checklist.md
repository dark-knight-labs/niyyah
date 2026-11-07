# Map v2 goal checklist (planner v2 B4)

Each line names the e2e test that proves it (`W1` = `map-v2.spec.ts`, `W2` = `map-v2b.spec.ts`, `F` = `map-files.spec.ts`). A line is ticked only when that test passed in the last full run (see `Last full run` at the bottom).

## W1 (map-v2.spec.ts)
- [x] every mind depth renders a box — "every mind depth renders a box (computed border on depth 3)"
- [x] Organize balanced / right / down / up: positions change along the right axis, no overlaps, one undo restores — "Organize balanced / right / down / up: positions change along the right axis, no overlaps, one undo restores"
- [x] Organize split menu offers horizontal and vertical — same test
- [x] right-click menu ids: mind, sticky, shape, text, frame, selection, pane — "right-click menu item ids per kind"
- [x] live node menu has none of Edit text, Delete, Delete branch, Cut, Convert, Detach as new map — "live node menu has none of Edit text, Delete, Delete branch, Cut, Convert, Detach as new map"
- [x] menu keyboard (context-menu key, arrows, Right opens a submenu, Enter runs, Esc closes) — "menu keyboard: context-menu key opens, arrows move, Right opens a submenu, Enter runs, Esc closes"
- [x] floating bar "⋯" opens the same menu — "the floating bar's more button opens the same menu; the menu runs commands"
- [x] mind style from the menu persists after reload; Link, Add parent, Move down, Detach, Convert to sticky, Focus branch — "mind style from the menu persists after reload; Link, Add parent, Move down, Detach, Convert to sticky, Focus branch"
- [x] Life board: layout and colour on a Life root and a live branch survive a reload; the Plan item is untouched — "Life board: layout and colour set on a Life root and on a live branch survive a reload; the Plan item is untouched"

## W2 (map-v2b.spec.ts)
- [x] all 12 shapes render; sticky offers 8 colours — "all 12 shapes render; a sticky offers 8 colours"
- [x] connector style (path, width, dash, heads, colour) persists after reload; edge menu ids — "connector style (path, width, dash, heads, colour) persists after reload; the edge menu edits it"
- [x] side ports remember their sides — "dragging from a side port connects to a side port and remembers the sides"
- [x] copy / cut / paste / duplicate; outline paste -> subtree; Copy as outline — "copy, cut, paste, duplicate; outline paste makes a subtree; Copy as outline"
- [x] a frame holding a promoted (live) item copies without a live copy and without a 422 — "copying or duplicating a frame that holds a promoted (live) item makes no live copy and no 422; the selection is the created rows"
- [x] a javascript: link is never drawn as a link — "a thought link with a javascript: scheme (old row, import) is never rendered as a link"
- [x] Ctrl+F search jumps to a node; only while focus is in the canvas — "Ctrl+F finds a thought and selects it; outside the canvas the browser keeps Ctrl+F"
- [x] lock — "lock: a locked sticky cannot be moved, edited or deleted; the menu offers Unlock"
- [x] z-order — "z-order: Bring to front puts the lower sticky on top"
- [x] align and distribute; alignment guides while dragging — "align and distribute from the selection menu; alignment guides show while dragging"
- [x] make a mind map from stickies; frame the selection — "make a mind map from stickies; frame the selection"
- [x] "?" shortcut sheet lists every command with a shortcut — "\"?\" opens the shortcut sheet listing every command that has a shortcut"

## F (map-files.spec.ts)
- [x] image paste -> node visible after reload — "pasting a big image downscales it to WebP, uploads it raw and shows it after reload"
- [x] image picker; image menu ids; Replace — "the picker adds an image; its menu offers caption, replace, reset size, open and download; Replace swaps the file"
- [x] file drop -> card; file card downloads the same bytes; file menu ids — "a dropped file becomes a card with its name and size; the card downloads the same bytes"
- [x] GIF keeps its bytes; SVG is a plain file — "a GIF keeps its bytes (animation); an SVG is a plain file, never an image"
- [x] attach an image to a thought with a connector — "a thought attaches an image and gets a connector to it"
- [x] Files panel lists files, marks unused, deletes — "the Files panel lists files, marks unused ones and deletes them; a deleted file shows File unavailable"
- [x] quota refusal says how much is used; a file over 10 MB never leaves the browser — "a refused upload (quota) says how much is used and opens the Files panel; a file over 10 MB never leaves the browser"

(Also in `map-v2.spec.ts`: Alt+arrows and Ctrl+B.)
