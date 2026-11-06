"use client";

import { useLayoutEffect, useRef } from "react";
import { useStore } from "@xyflow/react";
import { useMapActions } from "./map-context";
import { STICKY_COLORS, type StickyColor } from "@/lib/map/types";

/**
 * The floating bar above the selection (NodeToolbar). What it offers depends on the node: the canvas supplies the items.
 * It is nudged sideways to stay inside the board: clear of the tool rail on the left and of the side card on the right.
 */
export function ContextBar({ id }: { id: string }) {
  const { barItems, runBar } = useMapActions();
  const ref = useRef<HTMLDivElement>(null);
  const transform = useStore((s) => s.transform);   // re-fit when the view moves
  const items = barItems(id);

  useLayoutEffect(() => {
    const el = ref.current;
    const board = el?.closest(".niyyah-map");
    if (!el || !board) return;
    el.style.transform = "";
    const b = board.getBoundingClientRect(), r = el.getBoundingClientRect();
    const card = board.querySelector(".nm-card")?.getBoundingClientRect();
    const right = card && card.width < b.width - 100 && card.left > b.left + b.width / 2 ? card.left : b.right;
    const left = b.left + 60;                           // the tool rail
    let shift = 0;
    if (r.right > right - 8) shift = right - 8 - r.right;
    if (r.left + shift < left) shift = left - r.left;
    if (shift) el.style.transform = `translateX(${Math.round(shift)}px)`;
  });
  void transform;

  return (
    <div ref={ref} className="nm-ctx nodrag nopan" role="toolbar" aria-label="Selection actions">
      {items.map((it) => it.swatch ? (
        <button key={it.key} type="button" className={`sw nm-sw-${it.swatch}`} style={{ background: `var(--map-sticky-${it.swatch})` }} title={it.label} aria-label={it.label} onClick={() => runBar(id, it.key)} />
      ) : (
        <button key={it.key} type="button" onClick={() => runBar(id, it.key)}>{it.label}{it.kbd && <kbd>{it.kbd}</kbd>}</button>
      ))}
    </div>
  );
}

/** The bar for a selection of several objects: how many, a colour when they are all stickies, and Delete. */
export function MultiBar({ count, stickies, onColor, onDelete }: { count: number; stickies: boolean; onColor: (c: StickyColor) => void; onDelete: () => void }) {
  return (
    <div className="nm-ctx nm-multi nodrag nopan" role="toolbar" aria-label="Selection actions" data-testid="multi-bar">
      <span className="nm-n mono" data-testid="multi-count">{count} selected</span>
      {stickies && STICKY_COLORS.map((c) => (
        <button key={c} type="button" className={`sw nm-sw-${c}`} style={{ background: `var(--map-sticky-${c})` }} title={c} aria-label={c} onClick={() => onColor(c)} />
      ))}
      <button type="button" onClick={onDelete}>Delete<kbd>Del</kbd></button>
    </div>
  );
}
