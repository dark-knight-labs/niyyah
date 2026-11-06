import type { BoardNode, Op } from "./types";

export interface Rect { x: number; y: number; w: number; h: number }
export type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";
export type ZMode = "front" | "forward" | "backward" | "back";

const up = (node: BoardNode): Op => ({ op: "upsert_node", node, base_updated_at: null });
/** Items and mind roots can be moved by hand; a mind child sits where its tree puts it; frames carry what is inside and are left out here. */
export const movable = (n: BoardNode) => n.kind !== "frame" && n.kind !== "ref" && (n.kind !== "mind" || !n.parent_id) && !n.style.locked;

/** Row with its top-left moved to (x, y) given the rectangle it is drawn in (a mind root is stored by its centre). */
function placeAt(n: BoardNode, r: Rect, x: number, y: number): BoardNode {
  return n.kind === "mind" ? { ...n, x: Math.round(x + r.w / 2), y: Math.round(y + r.h / 2) } : { ...n, x: Math.round(x), y: Math.round(y) };
}
const sameSpot = (n: BoardNode, m: BoardNode) => n.x === m.x && n.y === m.y;

export function alignOps(nodes: BoardNode[], rects: ReadonlyMap<string, Rect>, mode: AlignMode): Op[] {
  const items = nodes.filter((n) => movable(n) && rects.has(n.id));
  if (items.length < 2) return [];
  const rs = items.map((n) => rects.get(n.id)!);
  const left = Math.min(...rs.map((r) => r.x)), right = Math.max(...rs.map((r) => r.x + r.w)), top = Math.min(...rs.map((r) => r.y)), bottom = Math.max(...rs.map((r) => r.y + r.h));
  const ops: Op[] = [];
  items.forEach((n, i) => {
    const r = rs[i];
    const x = mode === "left" ? left : mode === "right" ? right - r.w : mode === "center" ? (left + right) / 2 - r.w / 2 : r.x;
    const y = mode === "top" ? top : mode === "bottom" ? bottom - r.h : mode === "middle" ? (top + bottom) / 2 - r.h / 2 : r.y;
    const m = placeAt(n, r, x, y);
    if (!sameSpot(n, m)) ops.push(up(m));
  });
  return ops;
}

/** Equal gaps between three or more: the outer two stay, the others move. */
export function distributeOps(nodes: BoardNode[], rects: ReadonlyMap<string, Rect>, axis: "h" | "v"): Op[] {
  const items = nodes.filter((n) => movable(n) && rects.has(n.id));
  if (items.length < 3) return [];
  const pos = (n: BoardNode) => (axis === "h" ? rects.get(n.id)!.x : rects.get(n.id)!.y);
  const len = (n: BoardNode) => (axis === "h" ? rects.get(n.id)!.w : rects.get(n.id)!.h);
  const sorted = [...items].sort((a, b) => pos(a) - pos(b));
  const first = sorted[0], last = sorted[sorted.length - 1];
  const span = pos(last) + len(last) - pos(first);
  const gap = (span - sorted.reduce((s, n) => s + len(n), 0)) / (sorted.length - 1);
  const ops: Op[] = [];
  let at = pos(first);
  for (const n of sorted) {
    const r = rects.get(n.id)!;
    const m = axis === "h" ? placeAt(n, r, at, r.y) : placeAt(n, r, r.x, at);
    if (!sameSpot(n, m)) ops.push(up(m));
    at += len(n) + gap;
  }
  return ops;
}

/** Pack into a grid starting at the selection's top-left: reading order kept, cells as big as the biggest item plus a gap. */
export function tidyOps(nodes: BoardNode[], rects: ReadonlyMap<string, Rect>, gap = 24): Op[] {
  const items = nodes.filter((n) => movable(n) && rects.has(n.id));
  if (items.length < 2) return [];
  const rs = items.map((n) => rects.get(n.id)!);
  const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
  const cw = Math.max(...rs.map((r) => r.w)) + gap, ch = Math.max(...rs.map((r) => r.h)) + gap;
  const cols = Math.ceil(Math.sqrt(items.length));
  const order = items.map((n, i) => ({ n, r: rs[i] })).sort((a, b) => Math.round(a.r.y / ch) - Math.round(b.r.y / ch) || a.r.x - b.r.x);
  const ops: Op[] = [];
  order.forEach(({ n, r }, i) => { const m = placeAt(n, r, x0 + (i % cols) * cw, y0 + Math.floor(i / cols) * ch); if (!sameSpot(n, m)) ops.push(up(m)); });
  return ops;
}

/** Stacking order among free items by style.z (higher is in front). Renumbers so the order is explicit and compact; only rows whose z changes are written. */
export function zOps(all: BoardNode[], selected: ReadonlySet<string>, mode: ZMode): Op[] {
  const items = all.filter((n) => n.kind !== "mind" && n.kind !== "ref" && n.kind !== "frame");
  const order = [...items].sort((a, b) => (a.style.z ?? 0) - (b.style.z ?? 0) || a.id.localeCompare(b.id)).map((n) => n.id);
  const sel = order.filter((id) => selected.has(id));
  const rest = order.filter((id) => !selected.has(id));
  let next: string[];
  if (mode === "front") next = [...rest, ...sel];
  else if (mode === "back") next = [...sel, ...rest];
  else {
    next = [...order];
    const ids = mode === "forward" ? [...sel].reverse() : sel;
    for (const id of ids) {
      const i = next.indexOf(id), j = mode === "forward" ? i + 1 : i - 1;
      if (j < 0 || j >= next.length || selected.has(next[j])) continue;
      [next[i], next[j]] = [next[j], next[i]];
    }
  }
  if (next.every((id, i) => id === order[i])) return [];
  const byId = new Map(items.map((n) => [n.id, n]));
  const ops: Op[] = [];
  next.forEach((id, z) => { const n = byId.get(id)!; if ((n.style.z ?? 0) !== z) ops.push(up({ ...n, style: { ...n.style, z } })); });
  return ops;
}

/** A frame fitted to what sits in it (+32 around, 44 above for the title). */
export function fitFrameOps(frame: BoardNode, members: Rect[]): Op[] {
  if (!members.length) return [];
  const x0 = Math.min(...members.map((r) => r.x)) - 32, y0 = Math.min(...members.map((r) => r.y)) - 44;
  const x1 = Math.max(...members.map((r) => r.x + r.w)) + 32, y1 = Math.max(...members.map((r) => r.y + r.h)) + 32;
  return [up({ ...frame, x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) })];
}

export interface Snap { dx: number; dy: number; vx: number[]; hy: number[] }
/** Snap a moving rectangle's edges and centre to those of others within `thr` px; returns the nudge and the guide lines (x of vertical, y of horizontal). */
export function snapMove(r: Rect, others: Rect[], thr: number): Snap {
  let bx = thr + 1, by = thr + 1, dx = 0, dy = 0;
  const xs = [r.x, r.x + r.w / 2, r.x + r.w], ys = [r.y, r.y + r.h / 2, r.y + r.h];
  for (const o of others) {
    for (const ox of [o.x, o.x + o.w / 2, o.x + o.w]) for (const mx of xs) { const d = ox - mx; if (Math.abs(d) < Math.abs(bx)) { bx = d; dx = d; } }
    for (const oy of [o.y, o.y + o.h / 2, o.y + o.h]) for (const my of ys) { const d = oy - my; if (Math.abs(d) < Math.abs(by)) { by = d; dy = d; } }
  }
  if (Math.abs(bx) > thr) dx = 0;
  if (Math.abs(by) > thr) dy = 0;
  const vx: number[] = [], hy: number[] = [];
  const m = { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h };
  for (const o of others) {
    for (const ox of [o.x, o.x + o.w / 2, o.x + o.w]) for (const mx of [m.x, m.x + m.w / 2, m.x + m.w]) if (Math.abs(ox - mx) < 0.5 && dx !== undefined && (dx !== 0 || Math.abs(bx) <= thr)) vx.push(ox);
    for (const oy of [o.y, o.y + o.h / 2, o.y + o.h]) for (const my of [m.y, m.y + m.h / 2, m.y + m.h]) if (Math.abs(oy - my) < 0.5 && (dy !== 0 || Math.abs(by) <= thr)) hy.push(oy);
  }
  return { dx, dy, vx: [...new Set(vx)], hy: [...new Set(hy)] };
}
