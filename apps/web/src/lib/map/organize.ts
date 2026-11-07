import { layoutMindMap, type Layout, type Size } from "./layout";
import type { BoardData } from "./state";
import { childIndex, descendantCount, layoutOfRoot, visibleForest } from "./tree";
import type { BoardNode, Op, Side } from "./types";

export interface Rect { x: number; y: number; w: number; h: number }
const MARGIN = 48;
const hit = (a: Rect, b: Rect, m = 0) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;

/** Split a balanced root's first-level branches over both sides by subtree weight, keeping their order (a greedy fill: each goes to the lighter side). */
export function balancedSides(children: BoardNode[], idx: Map<string | null, BoardNode[]>): Map<string, Side> {
  const out = new Map<string, Side>();
  let r = 0, l = 0;
  for (const c of children) {
    const w = 1 + descendantCount(idx, c.id);
    if (r <= l) { out.set(c.id, "R"); r += w; } else { out.set(c.id, "L"); l += w; }
  }
  return out;
}

/** The map a root draws, as one rectangle (its visible nodes). Null when none of it has been measured. */
function mapRect(data: BoardData, idx: Map<string | null, BoardNode[]>, sizes: Map<string, Size>, rootId: string): Rect | null {
  const forest = visibleForest(data.nodes, idx).filter((t) => t.id === rootId);
  const placed = layoutMindMap(forest, sizes);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of placed.values()) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + p.w); y1 = Math.max(y1, p.y + p.h); }
  return placed.size ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/**
 * Organize the given maps: set their layout (or keep it), rebalance a balanced map's sides, then move maps that now overlap another map or a
 * free item out of the way (the first map stays; later ones move along the axis of least overlap). One list of ops = one undo step.
 * `obstacles` are rectangles that must not be covered (free items); `sizes` are the measured node sizes.
 */
export function organizeOps(data: BoardData, idx: Map<string | null, BoardNode[]>, rootIds: string[], layout: Layout | "keep", sizes: Map<string, Size>, obstacles: Rect[] = []): Op[] {
  const rows = new Map<string, BoardNode>();
  const roots = rootIds.map((id) => data.nodes.get(id)).filter((n): n is BoardNode => !!n && !n.parent_id && !n.hidden);
  for (const r of roots) {
    const next = layout === "keep" ? layoutOfRoot(r) : layout;
    rows.set(r.id, { ...r, style: { ...r.style, layout: next } });
    if (next === "both") {
      const kids = (idx.get(r.id) ?? []).filter((c) => !c.hidden);
      for (const [id, side] of balancedSides(kids, idx)) { const c = data.nodes.get(id)!; if (c.style.side !== side) rows.set(id, { ...c, style: { ...c.style, side } }); }
    }
  }
  const virtual: BoardData = { nodes: new Map(data.nodes), edges: data.edges };
  for (const [id, n] of rows) virtual.nodes.set(id, n);

  const vidx = childIndex(virtual.nodes);   // the rows as they will be: their layout and sides, not the ones idx was built from

  // Push apart: maps in the given order; a later map moves off every earlier map and every obstacle.
  const rects = new Map<string, Rect>();
  const fixed: Rect[] = [...obstacles];
  for (const [id, n] of virtual.nodes) if (!n.parent_id && (n.kind === "mind" || n.kind === "ref") && !n.hidden && !rootIds.includes(id)) { const m = mapRect(virtual, vidx, sizes, id); if (m) fixed.push(m); }
  const shift = new Map<string, { dx: number; dy: number }>();
  for (const r of roots) {
    const m = mapRect(virtual, vidx, sizes, r.id);
    if (!m) continue;
    let dx = 0, dy = 0;
    for (let guard = 0; guard < 60; guard++) {
      const cur = { x: m.x + dx, y: m.y + dy, w: m.w, h: m.h };
      const o = fixed.find((f) => hit(cur, f, MARGIN));
      if (!o) break;
      const right = o.x + o.w + MARGIN - cur.x, left = cur.x + cur.w + MARGIN - o.x, down = o.y + o.h + MARGIN - cur.y, up = cur.y + cur.h + MARGIN - o.y;
      const best = Math.min(right, left, down, up);
      if (best === right) dx += right; else if (best === left) dx -= left; else if (best === down) dy += down; else dy -= up;
    }
    shift.set(r.id, { dx, dy });
    rects.set(r.id, { x: m.x + dx, y: m.y + dy, w: m.w, h: m.h });
    fixed.push(rects.get(r.id)!);
  }

  const ops: Op[] = [];
  for (const [id, n] of rows) {
    const orig = data.nodes.get(id)!;
    const s = shift.get(id);
    const moved = s && (s.dx || s.dy) ? { ...n, x: Math.round(n.x + s.dx), y: Math.round(n.y + s.dy) } : n;
    if (moved.x !== orig.x || moved.y !== orig.y || JSON.stringify(moved.style) !== JSON.stringify(orig.style)) ops.push({ op: "upsert_node", node: moved, base_updated_at: null });
  }
  return ops;
}

/** The maps a command acts on: the selection's maps when something mind is selected, else every visible root. */
export function mapsOf(data: BoardData, idx: Map<string | null, BoardNode[]>, selected: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const id of selected) {
    let n = data.nodes.get(id);
    if (!n || (n.kind !== "mind" && n.kind !== "ref")) continue;
    while (n.parent_id && data.nodes.has(n.parent_id)) n = data.nodes.get(n.parent_id)!;
    out.add(n.id);
  }
  return out.size ? [...out] : (idx.get(null) ?? []).filter((r) => !r.hidden).map((r) => r.id);
}
