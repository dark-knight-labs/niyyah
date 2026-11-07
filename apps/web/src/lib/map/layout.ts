import type { Side } from "./types";

/** How a map grows from its root: balanced on both sides, or all one way. `down` is the top-down org chart. */
export type Layout = "both" | "right" | "left" | "down" | "up";
export const LAYOUTS: Layout[] = ["both", "right", "left", "down", "up"];
export const isLayout = (v: unknown): v is Layout => typeof v === "string" && (LAYOUTS as string[]).includes(v);
export const orientOf = (l: Layout): "h" | "v" => (l === "down" || l === "up" ? "v" : "h");

/** A visible mind node with its visible children (collapsed and hidden branches are already left out). Roots carry their centre and layout. */
export interface MindTree {
  id: string;
  /** Roots: centre of the map. */
  cx?: number;
  cy?: number;
  /** Roots: how the map grows (default both). */
  layout?: Layout;
  /** First-level branches: which side of the root (layout both only). Deeper nodes follow their branch. */
  side?: Side | null;
  children: MindTree[];
}

export interface Size { w: number; h: number }
/** `side` 1 = right/down, -1 = left/up (the way the node grows from its parent); `orient` h = horizontal map, v = vertical. */
export interface Placed { x: number; y: number; w: number; h: number; side: 1 | -1; depth: number; orient: "h" | "v" }

/** Gaps: along the growth axis root->level 1 is wider than deeper levels; across it, level 1 siblings sit further apart than deeper ones.
 *  Vertical maps get more room across (boxes are wide) and less along. */
export const AXIS_GAP = (depth: number, orient: "h" | "v") => (orient === "h" ? (depth === 0 ? 64 : 40) : depth === 0 ? 56 : 36);
export const CROSS_GAP = (depth: number, orient: "h" | "v") => (orient === "h" ? (depth <= 1 ? 22 : 10) : depth <= 1 ? 28 : 16);
export const FALLBACK: Size = { w: 120, h: 32 };

/**
 * Tidy tree per root, in any of five directions. The classic recursion runs once in "growth space" (a = along the growth axis,
 * c = across it) and is mapped back to the board: every subtree gets the cross extent of its stacked children (or its own),
 * children are centred on their parent's slot, and a balanced root splits its first-level branches into two stacks centred on it.
 * Pure and deterministic; sizes come from the measured DOM.
 */
export function layoutMindMap(roots: MindTree[], sizes: Map<string, Size>): Map<string, Placed> {
  const out = new Map<string, Placed>();
  const size = (id: string) => sizes.get(id) ?? FALLBACK;

  for (const r of roots) {
    const layout = r.layout ?? "both";
    const orient = orientOf(layout);
    const A = (id: string) => (orient === "h" ? size(id).w : size(id).h);   // extent along the growth axis
    const C = (id: string) => (orient === "h" ? size(id).h : size(id).w);   // extent across it
    const cx = r.cx ?? 0, cy = r.cy ?? 0;
    const sub = new Map<string, number>();

    const measure = (t: MindTree, depth: number): number => {
      const own = C(t.id);
      if (!t.children.length) { sub.set(t.id, own); return own; }
      const gap = CROSS_GAP(depth + 1, orient);
      const total = t.children.reduce((a, c) => a + measure(c, depth + 1), 0) + gap * (t.children.length - 1);
      const v = Math.max(own, total);
      sub.set(t.id, v);
      return v;
    };

    /** Board coordinates of a node whose near edge is at growth-space `a` (forward from the root centre) and whose cross range starts at `c`. */
    const put = (id: string, a: number, c: number, dir: 1 | -1, depth: number) => {
      const { w, h } = size(id);
      const along = orient === "h" ? w : h;
      const phys = dir > 0 ? a : -(a + along);
      out.set(id, orient === "h"
        ? { x: cx + phys, y: cy + c, w, h, side: dir, depth, orient }
        : { x: cx + c, y: cy + phys, w, h, side: dir, depth, orient });
    };

    const place = (t: MindTree, a: number, top: number, dir: 1 | -1, depth: number) => {
      const own = C(t.id);
      const subC = sub.get(t.id) ?? own;
      put(t.id, a, top + (subC - own) / 2, dir, depth);
      const gap = CROSS_GAP(depth + 1, orient);
      const total = t.children.reduce((s, c) => s + (sub.get(c.id) ?? 0), 0) + gap * Math.max(0, t.children.length - 1);
      let c = top + (subC - total) / 2;
      for (const ch of t.children) {
        place(ch, a + A(t.id) + AXIS_GAP(depth, orient), c, dir, depth + 1);
        c += (sub.get(ch.id) ?? 0) + gap;
      }
    };

    const { w, h } = size(r.id);
    out.set(r.id, { x: cx - w / 2, y: cy - h / 2, w, h, side: 1, depth: 0, orient });
    const rootHalf = A(r.id) / 2;
    const stack = (kids: MindTree[], dir: 1 | -1) => {
      kids.forEach((c) => measure(c, 1));
      const total = kids.reduce((a, c) => a + (sub.get(c.id) ?? 0), 0) + CROSS_GAP(1, orient) * Math.max(0, kids.length - 1);
      let c = -total / 2;
      for (const k of kids) {
        place(k, rootHalf + AXIS_GAP(0, orient), c, dir, 1);
        c += (sub.get(k.id) ?? 0) + CROSS_GAP(1, orient);
      }
    };
    if (layout === "both") {
      stack(r.children.filter((c) => (c.side ?? "R") === "R"), 1);
      stack(r.children.filter((c) => (c.side ?? "R") === "L"), -1);
    } else stack(r.children, layout === "left" || layout === "up" ? -1 : 1);
  }
  return out;
}

/** The direction a first-level branch of a root grows (1 = right/down, -1 = left/up). */
export function growth(layout: Layout, side: Side | null | undefined): 1 | -1 {
  if (layout === "both") return side === "L" ? -1 : 1;
  return layout === "left" || layout === "up" ? -1 : 1;
}

/** The handles a branch edge leaves from and arrives at, for a child placed `side`/`orient` from its parent. */
export function branchHandles(side: 1 | -1, orient: "h" | "v"): { source: string; target: string } {
  if (orient === "h") return side > 0 ? { source: "sr", target: "tl" } : { source: "sl", target: "tr" };
  return side > 0 ? { source: "sb", target: "tt" } : { source: "st", target: "tb" };
}
