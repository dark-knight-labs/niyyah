# Map v2 goal checklist (planner v2 B4): each line is one e2e test in `e2e/map-v2.spec.ts` (W1) or `e2e/map-v2b.spec.ts` (W2) or `e2e/map-files.spec.ts` (F).

## W1
- [x] every mind depth renders a box (computed border on depth 3)
- [x] Organize balanced / right / down / up: positions change along the right axis, no overlaps, one undo restores
- [x] Organize split menu offers horizontal and vertical options
- [x] right-click menu item ids: mind, sticky, shape, text, frame, selection, pane
- [x] live node menu has none of Edit text, Delete, Delete branch, Cut, Convert, Detach as new map
- [x] menu keyboard: context-menu key opens it, arrows move, Right opens a submenu, Enter runs, Esc closes
- [x] floating bar "⋯" opens the same menu
- [x] mind style from the menu (colour, fill, shape, size, icon) persists after reload
- [x] Life board: layout and colour set on a Life root and on a live branch survive a reload; the Plan item is untouched
- [x] Add parent, Move up/down (Alt+arrows), Detach as new map, Convert to sticky, Focus branch, Link…

## W2
- [x] all 12 shapes render; sticky offers 8 colours
- [x] connector style (path, width, dash, heads, colour) persists after reload; edge menu ids
- [x] copy / cut / paste / duplicate; outline paste -> subtree; Copy as outline
- [x] Ctrl+F search jumps to a node
- [x] lock: a locked item cannot be dragged or edited
- [x] z-order: bring to front / send to back
- [x] align and distribute from the selection menu; alignment guides while dragging
- [x] "?" shortcut sheet lists every command with a shortcut

## F
- [ ] image paste / drop / picker: node visible after reload
- [ ] file card downloads the file
- [ ] Files panel lists files, marks unused, deletes
- [ ] image and file menu ids; quota refusal shows how much is used

(W2 extras covered in `map-v2b.spec.ts`: side ports remember their sides; make a mind map from stickies; frame selection; Alt+arrows and Ctrl+B live in `map-v2.spec.ts`.)
