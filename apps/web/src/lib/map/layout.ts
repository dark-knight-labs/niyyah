import type { Side } from "./types";

/** A visible mind node with its visible children (collapsed and hidden branches are already left out). Roots carry their centre. */
export interface MindTree {
  id: string;
  /** Roots: centre of the map. */
  cx?: number;
  cy?: number;
  /** First-level branches: which side of the root. Deeper nodes follow their branch. */
  side?: Side | null;
  children: MindTree[];
}

export interface Size { w: number; h: number }
export interface Placed { x: number; y: number; w: number; h: number; side: 1 | -1; depth: number }

/** Gaps from the mock (map-v1.html): horizontal root->level 1 is 64, deeper 40; vertical level 1 is 22, deeper 10. */
export const HG = (depth: number) => (depth === 0 ? 64 : 40);
export const VG = (depth: number) => (depth <= 1 ? 22 : 10);
export const FALLBACK: Size = { w: 120, h: 32 };

/**
 * Tidy tree on both sides of each root. A port of the mock's sub()/place()/layout(): every subtree gets the height of its
 * stacked children (or its own height), children are centred on their parent's slot, and the first-level branches of a root
 * split into a right and a left stack, each centred on the root's y. Pure; sizes come from the measured DOM.
 */
export function layoutMindMap(roots: MindTree[], sizes: Map<string, Size>): Map<string, Placed> {
  const out = new Map<string, Placed>();
  const size = (id: string) => sizes.get(id) ?? FALLBACK;
  const sh = new Map<string, number>();

  const sub = (t: MindTree, depth: number): number => {
    const h = size(t.id).h;
    if (!t.children.length) { sh.set(t.id, h); return h; }
    const gap = VG(depth + 1);
    const total = t.children.reduce((a, c) => a + sub(c, depth + 1), 0) + gap * (t.children.length - 1);
    const v = Math.max(h, total);
    sh.set(t.id, v);
    return v;
  };

  const place = (t: MindTree, x: number, top: number, dir: 1 | -1, depth: number) => {
    const { w, h } = size(t.id);
    const nx = dir > 0 ? x : x - w;
    const subH = sh.get(t.id) ?? h;
    out.set(t.id, { x: nx, y: top + (subH - h) / 2, w, h, side: dir, depth });
    const gap = VG(depth + 1);
    const total = t.children.reduce((a, c) => a + (sh.get(c.id) ?? 0), 0) + gap * Math.max(0, t.children.length - 1);
    let y = top + (subH - total) / 2;
    for (const c of t.children) {
      place(c, dir > 0 ? nx + w + HG(depth) : nx - HG(depth), y, dir, depth + 1);
      y += (sh.get(c.id) ?? 0) + gap;
    }
  };

  for (const r of roots) {
    const { w, h } = size(r.id);
    const cx = r.cx ?? 0, cy = r.cy ?? 0;
    const rx = cx - w / 2, ry = cy - h / 2;
    out.set(r.id, { x: rx, y: ry, w, h, side: 1, depth: 0 });
    for (const side of ["R", "L"] as const) {
      const ch = r.children.filter((c) => (c.side ?? "R") === side);
      ch.forEach((c) => sub(c, 1));
      const total = ch.reduce((a, c) => a + (sh.get(c.id) ?? 0), 0) + VG(1) * Math.max(0, ch.length - 1);
      let y = cy - total / 2;
      for (const c of ch) {
        place(c, side === "R" ? rx + w + HG(0) : rx - HG(0), y, side === "R" ? 1 : -1, 1);
        y += (sh.get(c.id) ?? 0) + VG(1);
      }
    }
  }
  return out;
}
