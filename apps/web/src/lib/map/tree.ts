import type { BoardNode, Side } from "./types";
import { BRANCH_COLORS } from "./types";
import { growth, isLayout, orientOf, type Layout, type MindTree } from "./layout";

/** Pure helpers over a board's mind nodes (kind mind/ref with a parent chain). */

export type NodeMap = Map<string, BoardNode>;
export const isMind = (n: BoardNode) => n.kind === "mind" || n.kind === "ref";

/** Children index built once per render; childrenOf scans the whole map. */
export function childIndex(nodes: NodeMap): Map<string | null, BoardNode[]> {
  const idx = new Map<string | null, BoardNode[]>();
  for (const n of nodes.values()) {
    if (!isMind(n)) continue;
    const k = n.parent_id && nodes.has(n.parent_id) ? n.parent_id : null;
    const l = idx.get(k);
    if (l) l.push(n); else idx.set(k, [n]);
  }
  for (const l of idx.values()) l.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  return idx;
}

export function depthOf(nodes: NodeMap, id: string): number {
  let d = 0;
  let n = nodes.get(id);
  while (n?.parent_id && nodes.has(n.parent_id)) { d++; n = nodes.get(n.parent_id); }
  return d;
}

/** The first-level ancestor (or the node itself when it is a root or first-level). */
export function topOf(nodes: NodeMap, id: string): BoardNode | undefined {
  let n = nodes.get(id);
  if (!n) return undefined;
  while (n.parent_id && nodes.get(n.parent_id)?.parent_id) n = nodes.get(n.parent_id)!;
  return n;
}

export function rootOf(nodes: NodeMap, id: string): BoardNode | undefined {
  let n = nodes.get(id);
  while (n?.parent_id && nodes.has(n.parent_id)) n = nodes.get(n.parent_id);
  return n;
}

/** How the map a node belongs to grows (a root's own style.layout; both when unset). */
export function layoutOfRoot(root: BoardNode | undefined): Layout {
  return root && isLayout(root.style.layout) ? root.style.layout : "both";
}
export function layoutOf(nodes: NodeMap, id: string): Layout { return layoutOfRoot(rootOf(nodes, id)); }

/** 1 = right/down of the root, -1 = left/up, 0 = the root (the way the branch grows along its map's axis). */
export function dirOf(nodes: NodeMap, id: string): 1 | -1 | 0 {
  const n = nodes.get(id);
  if (!n || !n.parent_id) return 0;
  return growth(layoutOf(nodes, id), topOf(nodes, id)?.style.side);
}
export const orientOfNode = (nodes: NodeMap, id: string) => orientOf(layoutOf(nodes, id));

/** The branch colour key: the nearest own colour going up. */
export function colorKeyOf(nodes: NodeMap, id: string): string {
  let n = nodes.get(id);
  while (n) {
    if (n.style.color) return n.style.color;
    n = n.parent_id ? nodes.get(n.parent_id) : undefined;
  }
  return "slate";
}
export const colorVar = (key: string) => `var(--stream-${key})`;

export function isDescendant(nodes: NodeMap, id: string, anc: string): boolean {
  let n = nodes.get(id);
  while (n?.parent_id) {
    if (n.parent_id === anc) return true;
    n = nodes.get(n.parent_id);
  }
  return false;
}

/** The node and everything under it (document order). */
export function subtreeIds(idx: Map<string | null, BoardNode[]>, id: string): string[] {
  const out = [id];
  for (const c of idx.get(id) ?? []) out.push(...subtreeIds(idx, c.id));
  return out;
}

export function descendantCount(idx: Map<string | null, BoardNode[]>, id: string): number {
  return (idx.get(id) ?? []).reduce((a, c) => a + 1 + descendantCount(idx, c.id), 0);
}

/** Is the node shown: not hidden itself and no collapsed or hidden ancestor. */
export function isVisible(nodes: NodeMap, id: string): boolean {
  let n = nodes.get(id);
  if (!n || n.hidden) return false;
  while (n.parent_id) {
    const p = nodes.get(n.parent_id);
    if (!p) break;
    if (p.collapsed || p.hidden) return false;
    n = p;
  }
  return true;
}

/** Visible forest ready for layoutMindMap. */
export function visibleForest(nodes: NodeMap, idx: Map<string | null, BoardNode[]>): MindTree[] {
  const walk = (n: BoardNode): MindTree => ({
    id: n.id,
    side: n.style.side ?? null,
    children: n.collapsed ? [] : (idx.get(n.id) ?? []).filter((c) => !c.hidden).map(walk),
  });
  return (idx.get(null) ?? []).filter((r) => !r.hidden).map((r) => ({ ...walk(r), cx: r.x, cy: r.y, layout: layoutOfRoot(r) }));
}

/** Side and colour a new first-level branch gets under a root: balance the sides, rotate the palette. */
export function nextBranch(idx: Map<string | null, BoardNode[]>, rootId: string): { side: Side; color: string } {
  const ch = idx.get(rootId) ?? [];
  const right = ch.filter((c) => (c.style.side ?? "R") === "R").length;
  return { side: right <= ch.length - right ? "R" : "L", color: BRANCH_COLORS[ch.length % BRANCH_COLORS.length] };
}
