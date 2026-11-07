"use client";

import { useEffect, useRef, useState } from "react";
import type { SaveStatus } from "@/lib/map/ops";
import type { Board, BoardNode } from "@/lib/map/types";

type MenuKind = "boards" | "frames" | "organize" | null;

const STATUS_TEXT: Record<SaveStatus, string> = { saved: "Saved", saving: "Saving", retrying: "Not saved, retrying", offline: "Offline" };

/** Top-left: board name (menu: boards, new board, hidden thoughts), Frames list (zoom to frame), save status. */
export function BoardBar({ board, boards, frames, hidden, status, onOpen, onNew, onRename, onDelete, onZoomFrame, onUnhide, onRetry, showDone, onShowDone, onOrganize, onFiles, filesOpen }: {
  onFiles: () => void; filesOpen: boolean;
  onOrganize: (layout: "keep" | "both" | "right" | "down" | "up") => void;
  showDone: boolean | null; onShowDone: (v: boolean) => void;
  board: Board; boards: Board[]; frames: BoardNode[]; hidden: BoardNode[]; status: SaveStatus;
  onOpen: (id: string) => void; onNew: () => void; onRename: (title: string) => void; onDelete: () => void;
  onZoomFrame: (id: string) => void; onUnhide: (id: string) => void; onRetry: () => void;
}) {
  const [menu, setMenu] = useState<MenuKind>(null);
  const [renaming, setRenaming] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !wrap.current?.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close); };
  }, [menu]);

  const bad = status === "retrying" || status === "offline";
  const item = (n: BoardNode) => n.text || "Untitled";
  return (
    <div ref={wrap} className="nm-ui nm-bar" role="toolbar" aria-label="Board">
      {renaming ? (
        <span>
          <input autoFocus defaultValue={board.title} aria-label="Board name" maxLength={120}
            onBlur={(e) => { setRenaming(false); const t = e.target.value.trim(); if (t && t !== board.title) onRename(t); }}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { e.currentTarget.value = board.title; e.currentTarget.blur(); } e.stopPropagation(); }} />
        </span>
      ) : (
        <button type="button" aria-haspopup="menu" aria-expanded={menu === "boards"} data-testid="board-menu" onClick={() => setMenu(menu === "boards" ? null : "boards")}
          onDoubleClick={() => { if (board.kind !== "life") { setMenu(null); setRenaming(true); } }} title={board.kind === "life" ? "The Life board keeps its name" : "Double-click to rename"}>
          <span className="name" data-testid="board-name">{board.title}</span><span className="mono" style={{ color: "var(--muted-foreground)" }}>▾</span>
        </button>
      )}
      <button type="button" className="mono" aria-haspopup="menu" aria-expanded={menu === "frames"} data-testid="frames-menu" onClick={() => setMenu(menu === "frames" ? null : "frames")}>
        Frames{frames.length ? ` (${frames.length})` : ""}
      </button>
      <button type="button" className="mono" aria-pressed={filesOpen} data-testid="files-button" onClick={onFiles}>Files</button>
      <span className="nm-organize">
        <button type="button" className="mono" data-testid="organize" title="Organize the selected map (or every map) in its current layout" onClick={() => onOrganize("keep")}>Organize</button>
        <button type="button" aria-haspopup="menu" aria-expanded={menu === "organize"} aria-label="Organize options" data-testid="organize-menu" onClick={() => setMenu(menu === "organize" ? null : "organize")}><span className="mono" style={{ color: "var(--muted-foreground)" }}>▾</span></button>
      </span>
      <span className={`mono st ${bad ? "bad" : ""}`} role="status" data-testid="save-status" data-status={status}>
        {STATUS_TEXT[status]}
        {bad && <button type="button" onClick={onRetry} style={{ marginLeft: 8, textDecoration: "underline" }}>Retry</button>}
      </span>
      {menu === "boards" && (
        <div className="nm-menu" role="menu" style={{ left: 0, top: "100%", marginTop: 4 }}>
          <div className="mh mono">Boards</div>
          {boards.map((b) => (
            <button key={b.id} type="button" role="menuitem" aria-current={b.id === board.id ? "true" : undefined} data-board={b.id} onClick={() => { setMenu(null); onOpen(b.id); }}>
              {b.title}<span className="k">{b.kind === "life" ? "from Plan" : ""}</span>
            </button>
          ))}
          <button type="button" role="menuitem" data-testid="new-board" onClick={() => { setMenu(null); onNew(); }}>+ New board</button>
          {showDone !== null && (
            <>
              <hr />
              <button type="button" role="menuitemcheckbox" aria-checked={showDone} data-testid="show-done" onClick={() => { setMenu(null); onShowDone(!showDone); }}>Show done<span className="k">{showDone ? "on" : "off"}</span></button>
            </>
          )}
          {board.kind !== "life" && (
            <>
              <hr />
              <button type="button" role="menuitem" onClick={() => { setMenu(null); setRenaming(true); }}>Rename this board</button>
              <button type="button" role="menuitem" onClick={() => { setMenu(null); onDelete(); }}>Delete this board</button>
            </>
          )}
          {hidden.length > 0 && (
            <>
              <hr />
              <div className="mh mono">Hidden from this board</div>
              {hidden.map((n) => <button key={n.id} type="button" role="menuitem" onClick={() => { setMenu(null); onUnhide(n.id); }}>{item(n)}<span className="k">show</span></button>)}
            </>
          )}
        </div>
      )}
      {menu === "organize" && (
        <div className="nm-menu" role="menu" style={{ left: 0, top: "100%", marginTop: 4 }}>
          <div className="mh mono">Organize</div>
          {([["both", "Horizontal, balanced"], ["right", "Horizontal, to the right"], ["down", "Vertical, down"], ["up", "Vertical, up"]] as const).map(([l, t]) => (
            <button key={l} type="button" role="menuitem" data-layout={l} onClick={() => { setMenu(null); onOrganize(l); }}>{t}</button>
          ))}
        </div>
      )}
      {menu === "frames" && (
        <div className="nm-menu" role="menu" style={{ left: 0, top: "100%", marginTop: 4 }}>
          <div className="mh mono">Frames</div>
          {frames.length ? frames.map((f, i) => (
            <button key={f.id} type="button" role="menuitem" data-frame={f.id} onClick={() => { setMenu(null); onZoomFrame(f.id); }}>{f.text || "Frame"}<span className="k">{i + 1}</span></button>
          )) : <div className="mh">No frames yet. Press F and click the board.</div>}
        </div>
      )}
    </div>
  );
}
