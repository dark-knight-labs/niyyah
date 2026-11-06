"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { filesApi, humanSize, type FileList } from "@/lib/map/files";
import { COMMANDS, labelOf, type Sel } from "@/lib/map/commands";

/** Ctrl+F: find a thought or object by its text. Enter = next, Shift+Enter = previous, Esc closes. */
export function SearchBar({ q, count, at, onQuery, onStep, onClose }: { q: string; count: number; at: number; onQuery: (q: string) => void; onStep: (d: 1 | -1) => void; onClose: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <div className="nm-ui nm-search" role="search" data-testid="search-bar">
      <input ref={ref} value={q} placeholder="Find on this board" aria-label="Find on this board" data-testid="search-input" onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") { e.preventDefault(); onClose(); } else if (e.key === "Enter") { e.preventDefault(); onStep(e.shiftKey ? -1 : 1); } }} />
      <span className="mono" data-testid="search-count">{q ? (count ? `${at + 1} / ${count}` : "0") : ""}</span>
      <button type="button" aria-label="Previous match" onClick={() => onStep(-1)}>↑</button>
      <button type="button" aria-label="Next match" onClick={() => onStep(1)}>↓</button>
      <button type="button" aria-label="Close search" onClick={onClose}>×</button>
    </div>
  );
}

const EXTRA: [string, string][] = [
  ["Tab", "Add a child to the selected thought"], ["Enter", "Add a sibling (thought) / edit (object)"], ["Arrow keys", "Move between thoughts; nudge an object (Shift = 40 px)"],
  ["Ctrl+Z / Ctrl+Shift+Z", "Undo / redo"], ["Space + drag", "Pan"], ["Right-click or Shift+F10", "Open the actions for what is selected"], ["Esc", "Clear the selection, leave a tool, close a menu"],
  ["V H M N T S F L", "Tools: select, hand, mind map, sticky, text, shape, frame, connector"],
];

/** The "?" sheet: every command that has a shortcut (read from the registry) plus the keys the canvas handles itself. */
export function HelpSheet({ onClose }: { onClose: () => void }) {
  const rows = COMMANDS.filter((c) => c.kbd).map((c) => [c.kbd!, typeof c.label === "string" ? c.label : labelOf(c, { nodes: [], edges: [], locked: false } as unknown as Sel)] as [string, string]);
  const seen = new Set<string>();
  const all = [...EXTRA, ...rows].filter(([k, l]) => { const key = `${k}|${l}`; if (seen.has(key)) return false; seen.add(key); return true; });
  return (
    <div className="nm-prompt-wrap" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="nm-ui nm-help-sheet" role="dialog" aria-label="Keyboard shortcuts" data-testid="help-sheet" tabIndex={-1} ref={(el) => el?.focus()}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape" || e.key === "?") { e.preventDefault(); onClose(); } }}>
        <div className="mono hd">Keyboard shortcuts <button type="button" aria-label="Close" onClick={onClose}>×</button></div>
        <dl>{all.map(([k, l]) => <div key={`${k}|${l}`} data-kbd={k}><dt className="mono">{k}</dt><dd>{l}</dd></div>)}</dl>
      </div>
    </div>
  );
}

/** The Files panel: every file this account uploaded, which ones no object uses any more, and delete. The quota refusal points here. */
export function FilesPanel({ onClose, onGone, notify }: { onClose: () => void; onGone: (id: string) => void; notify: (m: string) => void }) {
  const [list, setList] = useState<FileList | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { filesApi.list().then((l) => { setList(l); setErr(null); }).catch((e: Error) => setErr(e.message)); }, []);
  useEffect(() => { load(); }, [load]);
  const del = async (ids: string[]) => {
    try { for (const id of ids) { await filesApi.remove(id); onGone(id); } load(); notify(ids.length === 1 ? "File deleted" : `${ids.length} files deleted`); }
    catch (e) { notify((e as Error).message || "Could not delete"); load(); }
  };
  const unused = list?.files.filter((f) => !f.used) ?? [];
  return (
    <div className="nm-ui nm-files" role="dialog" aria-label="Files" data-testid="files-panel" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <div className="hd mono"><span>Files{list ? ` · ${humanSize(list.used_bytes)} of ${humanSize(list.quota_bytes)}` : ""}</span><button type="button" aria-label="Close files" onClick={onClose}>×</button></div>
      {err && <div className="row"><span className="un">{err}</span></div>}
      {list && list.files.length === 0 && <div className="row"><span className="mono">No files yet. Press I, paste an image, or drop one on the board.</span></div>}
      {list?.files.map((f) => (
        <div className="row" key={f.id} data-testid={`file-row-${f.id}`} data-used={f.used ? "1" : "0"}>
          <span className="nm" title={f.name}>{f.name}</span>
          <span className={`mono ${f.used ? "" : "un"}`}>{humanSize(f.size)} · {f.used ? "in use" : "unused"}</span>
          <button type="button" aria-label={`Delete ${f.name}`} onClick={() => void del([f.id])}>Delete</button>
        </div>
      ))}
      {unused.length > 0 && <div className="foot"><span>{unused.length} unused</span><button type="button" className="row-btn" data-testid="delete-unused" onClick={() => void del(unused.map((f) => f.id))}>Delete unused</button></div>}
    </div>
  );
}
