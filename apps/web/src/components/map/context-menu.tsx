"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MenuItem } from "@/lib/map/commands";

/**
 * The right-click menu. Groups divided by hairlines; items with choices open a submenu. Keyboard: Up/Down/Home/End move, Right opens a
 * submenu, Left or Esc closes it (Esc on the top level closes the menu), Enter or Space runs. Opens at (x, y) and flips at the edges.
 */
export function ContextMenu({ x, y, groups, label, onRun, onClose }: {
  x: number; y: number; groups: MenuItem[][]; label: string; onRun: (id: string, choice?: string) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const flat = groups.flat();
  const [active, setActive] = useState(() => Math.max(0, flat.findIndex((i) => !i.disabled)));
  const [open, setOpen] = useState<string | null>(null);
  const [subActive, setSubActive] = useState(0);
  const subRef = useRef<HTMLDivElement | null>(null);
  const [subPos, setSubPos] = useState<{ left: number; top: number } | null>(null);

  // A submenu is fixed to the viewport (the menu itself scrolls when it is taller than the window, which would clip an absolute child):
  // beside its row, flipped to the left at the right edge, pulled up to fit.
  useLayoutEffect(() => {
    const sub = subRef.current, row = sub?.parentElement;
    if (!open || !sub || !row) { setSubPos(null); return; }
    const r = row.getBoundingClientRect(), w = sub.offsetWidth, h = sub.offsetHeight;
    const left = r.right + 2 + w > window.innerWidth - 4 ? Math.max(4, r.left - w - 2) : r.right + 2;
    setSubPos({ left, top: Math.max(4, Math.min(r.top - 5, window.innerHeight - h - 4)) });
  }, [open, pos]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)), y: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) });
  }, [x, y]);

  useEffect(() => {
    const el = ref.current;
    const items = el?.querySelectorAll<HTMLElement>(open ? `[data-sub="${open}"] [role=menuitemradio]` : "[data-top-item]");
    items?.[open ? subActive : active]?.focus();
  }, [active, open, subActive]);

  useEffect(() => {
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const blur = () => onClose();
    document.addEventListener("pointerdown", down, true);
    window.addEventListener("blur", blur);
    window.addEventListener("resize", blur);
    return () => { document.removeEventListener("pointerdown", down, true); window.removeEventListener("blur", blur); window.removeEventListener("resize", blur); };
  }, [onClose]);

  const step = (from: number, dir: 1 | -1, list: readonly object[]) => {
    for (let k = 1; k <= list.length; k++) { const j = (from + dir * k + list.length * 2) % list.length; if (!(list[j] as { disabled?: boolean }).disabled) return j; }
    return from;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const cur = flat[active];
    const subs = open ? cur?.choices ?? [] : [];
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.key === "Escape") { stop(); if (open) setOpen(null); else onClose(); return; }
    if (e.key === "Tab") { stop(); onClose(); return; }
    if (open) {
      if (e.key === "ArrowDown") { stop(); setSubActive(step(subActive, 1, subs)); }
      else if (e.key === "ArrowUp") { stop(); setSubActive(step(subActive, -1, subs)); }
      else if (e.key === "ArrowLeft") { stop(); setOpen(null); }
      else if (e.key === "Enter" || e.key === " ") { stop(); const c = subs[subActive]; if (c) { onRun(cur.id, c.id); onClose(); } }
      return;
    }
    if (e.key === "ArrowDown") { stop(); setActive(step(active, 1, flat)); }
    else if (e.key === "ArrowUp") { stop(); setActive(step(active, -1, flat)); }
    else if (e.key === "Home") { stop(); setActive(step(-1, 1, flat)); }
    else if (e.key === "End") { stop(); setActive(step(flat.length, -1, flat)); }
    else if (e.key === "ArrowRight" && cur?.choices) { stop(); setOpen(cur.id); setSubActive(Math.max(0, cur.choices.findIndex((c) => c.checked))); }
    else if ((e.key === "Enter" || e.key === " ") && cur && !cur.disabled) {
      stop();
      if (cur.choices) { setOpen(cur.id); setSubActive(Math.max(0, cur.choices.findIndex((c) => c.checked))); } else { onRun(cur.id); onClose(); }
    }
  };

  let n = -1;
  return (
    <div ref={ref} className="nm-cm nodrag nopan" role="menu" aria-label={label} data-testid="context-menu" data-top style={{ left: pos.x, top: pos.y }} onKeyDown={onKeyDown} onScroll={() => setOpen(null)} onContextMenu={(e) => e.preventDefault()}>
      {groups.map((g, gi) => (
        <div key={gi} className="nm-cm-grp" role="group">
          {gi > 0 && <hr />}
          {g.map((it) => {
            const i = ++n;
            const sub = open === it.id && it.choices;
            return (
              <div key={it.id} className="nm-cm-row" onPointerEnter={() => { if (!it.disabled) { setActive(i); setOpen(it.choices ? it.id : null); setSubActive(0); } }}>
                <button type="button" role={it.checked !== undefined ? "menuitemcheckbox" : "menuitem"} aria-checked={it.checked} aria-haspopup={it.choices ? "menu" : undefined} aria-expanded={it.choices ? open === it.id : undefined}
                  aria-disabled={it.disabled || undefined} tabIndex={-1} data-top-item data-cmd={it.id} className={it.danger ? "danger" : undefined}
                  onClick={() => { if (it.disabled) return; if (it.choices) { setOpen(it.id); return; } onRun(it.id); onClose(); }}>
                  <span className="nm-cm-ck" aria-hidden="true">{it.checked ? "✓" : ""}</span>
                  <span className="nm-cm-l">{it.label}</span>
                  {it.kbd && <kbd>{it.kbd}</kbd>}
                  {it.choices && <span className="nm-cm-ar" aria-hidden="true">▸</span>}
                </button>
                {sub && (
                  <div ref={subRef} className="nm-cm nm-cm-sub" role="menu" aria-label={it.label} data-sub={it.id} style={subPos ? { left: subPos.left, top: subPos.top } : { visibility: "hidden" }}>
                    {it.choices!.map((c, ci) => (
                      <button key={c.id || "none"} type="button" role="menuitemradio" aria-checked={c.checked} tabIndex={-1} data-choice={c.id} className={ci === subActive ? "act" : undefined}
                        onPointerEnter={() => setSubActive(ci)} onClick={() => { onRun(it.id, c.id); onClose(); }}>
                        <span className="nm-cm-ck" aria-hidden="true">{c.checked ? "✓" : ""}</span>
                        {c.swatch && <i className="nm-cm-sw" style={{ background: c.swatch }} />}
                        <span className="nm-cm-l">{c.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** A one-line prompt (links, labels): Enter accepts, Esc cancels, an empty answer is returned as "". */
export function PromptDialog({ title, initial, onDone }: { title: string; initial: string; onDone: (value: string | null) => void }) {
  const [v, setV] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  return (
    <div className="nm-prompt-wrap" onPointerDown={(e) => { if (e.target === e.currentTarget) onDone(null); }}>
      <form className="nm-ui nm-prompt" role="dialog" aria-label={title} onSubmit={(e) => { e.preventDefault(); onDone(v); }}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") { e.preventDefault(); onDone(null); } }}>
        <label className="mono">{title}</label>
        <input ref={input} value={v} maxLength={500} onChange={(e) => setV(e.target.value)} data-testid="prompt-input" />
        <div className="row"><button type="button" onClick={() => onDone(null)}>Cancel</button><button type="submit" className="pri">OK</button></div>
      </form>
    </div>
  );
}
