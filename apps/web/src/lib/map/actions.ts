import { isDescendant, nextBranch, subtreeIds, type NodeMap } from "./tree";
import type { BoardEdge, BoardNode, NodeKind, Op, Side, StickyColor } from "./types";
import { MAX_TEXT, STICKY_COLORS, STICKY_CYCLE } from "./types";

/** Pure op builders for the canvas. Each returns the ops (unstamped: use-board stamps base_updated_at) and the id of what it made. */

export const newId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 3) | 8).toString(16); });

export const clampText = (t: string) => t.slice(0, MAX_TEXT);

export function blank(kind: NodeKind, p: Partial<BoardNode> = {}): BoardNode {
  return {
    id: newId(), kind, parent_id: null, parent_key: null, position: 0, x: 0, y: 0, w: 0, h: 0, text: "", notes: "", style: {}, collapsed: false,
    hidden: false, ref_key: null, frame_id: null, updated_at: null, ...p,
  };
}

const up = (node: BoardNode): Op => ({ op: "upsert_node", node, base_updated_at: null });
const del = (id: string): Op => ({ op: "delete_node", id, base_updated_at: null });

export const ITEM_SIZE: Record<"sticky" | "text" | "shape" | "frame", { w: number; h: number }> = {
  sticky: { w: 170, h: 130 }, text: { w: 220, h: 32 }, shape: { w: 170, h: 80 }, frame: { w: 420, h: 300 },
};

/** Siblings of `parentId` in order (for mind children) or the roots when null. */
function siblings(idx: Map<string | null, BoardNode[]>, parentId: string | null): BoardNode[] {
  return idx.get(parentId) ?? [];
}

export function addRoot(cx: number, cy: number, text = "", frameId: string | null = null): { ops: Op[]; id: string } {
  const n = blank("mind", { x: Math.round(cx), y: Math.round(cy), text, frame_id: frameId });
  return { ops: [up(n)], id: n.id };
}

export function addChild(nodes: NodeMap, idx: Map<string | null, BoardNode[]>, parentId: string): { ops: Op[]; id: string } {
  const parent = nodes.get(parentId)!;
  const ops: Op[] = [];
  if (parent.collapsed) ops.push(up({ ...parent, collapsed: false }));
  const sibs = siblings(idx, parentId);
  const style: BoardNode["style"] = {};
  if (!parent.parent_id) {
    const b = nextBranch(idx, parentId);
    style.side = b.side;
    style.color = b.color;
  }
  const n = blank("mind", { parent_id: parentId, position: (sibs.at(-1)?.position ?? -1) + 1, style });
  ops.push(up(n));
  return { ops, id: n.id };
}

export function addSibling(nodes: NodeMap, idx: Map<string | null, BoardNode[]>, id: string): { ops: Op[]; id: string } {
  const me = nodes.get(id)!;
  if (!me.parent_id) return addChild(nodes, idx, id);
  const parent = nodes.get(me.parent_id)!;
  const sibs = siblings(idx, me.parent_id);
  const i = sibs.findIndex((s) => s.id === id);
  const style: BoardNode["style"] = {};
  if (!parent.parent_id) {
    const b = nextBranch(idx, parent.id);
    style.side = me.style.side ?? b.side;
    style.color = b.color;
  }
  const n = blank("mind", { parent_id: parent.id, position: me.position + 1, style });
  const ops: Op[] = [];
  // make room: every later sibling moves one place down
  sibs.slice(i + 1).forEach((s, k) => { if (s.position !== me.position + 2 + k) ops.push(up({ ...s, position: me.position + 2 + k })); });
  ops.push(up(n));
  return { ops, id: n.id };
}

/** A thought and everything below it, plus the connectors touching them (the server drops those with the node). */
export function deleteSubtree(idx: Map<string | null, BoardNode[]>, id: string): Op[] {
  return subtreeIds(idx, id).map(del);
}

/** Move a branch under another node. First-level branches under a root get a side (from the drop point) and a colour. */
export function reparent(
  nodes: NodeMap, idx: Map<string | null, BoardNode[]>, id: string, targetId: string, side: Side,
): Op[] {
  const me = nodes.get(id), target = nodes.get(targetId);
  if (!me || !target || id === targetId || isDescendant(nodes, targetId, id)) return [];
  const sibs = siblings(idx, targetId).filter((s) => s.id !== id);
  const style = { ...me.style };
  if (!target.parent_id) {
    style.side = side;
    style.color = me.style.color ?? nextBranch(idx, targetId).color;
  } else {
    delete style.side; // deeper levels follow their branch
    delete style.color;
  }
  const ops: Op[] = [up({ ...me, parent_id: targetId, position: (sibs.at(-1)?.position ?? -1) + 1, style, frame_id: null, x: 0, y: 0 })];
  if (target.collapsed) ops.push(up({ ...target, collapsed: false }));
  return ops;
}

export function addItem(kind: "sticky" | "text" | "shape" | "frame", cx: number, cy: number, existing: NodeMap, frameId: string | null): { ops: Op[]; id: string } {
  const s = ITEM_SIZE[kind];
  const count = [...existing.values()].filter((n) => n.kind === kind).length;
  const style: BoardNode["style"] = kind === "sticky" ? { color: STICKY_CYCLE[count % STICKY_CYCLE.length] } : {};
  const n = blank(kind, {
    x: Math.round(cx - s.w / 2), y: Math.round(cy - s.h / 2), w: s.w, h: s.h, style, frame_id: kind === "frame" ? null : frameId,
    text: kind === "frame" ? `Frame ${count + 1}` : "",
  });
  return { ops: [up(n)], id: n.id };
}

export function edgeBetween(from: string, to: string): { op: Op; id: string } {
  const edge: BoardEdge = { id: newId(), from_id: from, to_id: to, label: "", style: {}, updated_at: null };
  return { op: { op: "upsert_edge", edge, base_updated_at: null }, id: edge.id };
}

export function setColor(n: BoardNode, color: StickyColor): Op {
  return up({ ...n, style: { ...n.style, color } });
}

export const setText = (n: BoardNode, text: string): Op => up({ ...n, text: clampText(text) });

/** The smallest frame whose rectangle contains the point (frames are not nested). */
export function frameAt(nodes: NodeMap, px: number, py: number, skip?: string): BoardNode | null {
  let best: BoardNode | null = null;
  for (const n of nodes.values()) {
    if (n.kind !== "frame" || n.id === skip) continue;
    if (px >= n.x && py >= n.y && px <= n.x + n.w && py <= n.y + n.h && (!best || n.w * n.h < best.w * best.h)) best = n;
  }
  return best;
}

// ---- style, order, structure (command registry) ----

/** Set (or, with undefined, remove) style keys on rows: one upsert per row. Rows whose style does not change are skipped. */
export function patchStyle(nodes: BoardNode[], patch: Record<string, unknown>): Op[] {
  const ops: Op[] = [];
  for (const n of nodes) {
    const style: Record<string, unknown> = { ...n.style };
    let changed = false;
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null) { if (k in style) { delete style[k]; changed = true; } } else if (style[k] !== v) { style[k] = v; changed = true; }
    }
    if (changed) ops.push(up({ ...n, style: style as BoardNode["style"] }));
  }
  return ops;
}

export function patchEdgeStyle(edges: BoardEdge[], patch: Record<string, unknown>): Op[] {
  const ops: Op[] = [];
  for (const e of edges) {
    const style: Record<string, unknown> = { ...e.style };
    let changed = false;
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null) { if (k in style) { delete style[k]; changed = true; } } else if (style[k] !== v) { style[k] = v; changed = true; }
    }
    if (changed) ops.push({ op: "upsert_edge", edge: { ...e, style }, base_updated_at: null });
  }
  return ops;
}

/** Swap a mind node with its previous (-1) or next (+1) sibling: positions are renumbered so they stay unique and ordered. */
export function moveSibling(idx: Map<string | null, BoardNode[]>, node: BoardNode, delta: -1 | 1): Op[] {
  const sibs = idx.get(node.parent_id) ?? [];
  const i = sibs.findIndex((s) => s.id === node.id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= sibs.length) return [];
  const order = sibs.map((s) => s.id);
  [order[i], order[j]] = [order[j], order[i]];
  const ops: Op[] = [];
  order.forEach((id, k) => { const s = sibs.find((x) => x.id === id)!; if (s.position !== k) ops.push(up({ ...s, position: k })); });
  return ops;
}

/** A new node between a thought and its parent: the thought hangs under it. */
export function insertParent(nodes: NodeMap, node: BoardNode): { ops: Op[]; id: string } {
  const parent = node.parent_id ? nodes.get(node.parent_id) : undefined;
  const style: BoardNode["style"] = {};
  if (parent && !parent.parent_id) { style.side = node.style.side ?? "R"; style.color = node.style.color; }
  const mid = blank("mind", { parent_id: node.parent_id, position: node.position, style });
  const moved = { ...node, parent_id: mid.id, position: 0, style: { ...node.style } };
  if (parent && !parent.parent_id) { delete moved.style.side; delete moved.style.color; }
  return { ops: [up(mid), up(moved)], id: mid.id };
}

/** A branch becomes the root of its own map where it stands (`rect` = where it is drawn now). Its colour is kept, the side is dropped. */
export function detach(nodes: NodeMap, node: BoardNode, rect: { x: number; y: number; w: number; h: number }, colorKey: string): Op[] {
  void nodes;
  const style: BoardNode["style"] = { ...node.style, color: node.style.color ?? colorKey };
  delete style.side;
  return [up({ ...node, parent_id: null, position: 0, x: Math.round(rect.x + rect.w / 2), y: Math.round(rect.y + rect.h / 2), style, frame_id: null })];
}

/** Convert between objects, keeping text and place. A thought can only become a sticky when it has no branches (the caller checks). */
export function convertTo(n: BoardNode, to: "mind" | "sticky" | "text" | "shape", rect: { x: number; y: number; w: number; h: number }): Op {
  if (to === "mind") return up({ ...n, kind: "mind", parent_id: null, position: 0, x: Math.round(rect.x + rect.w / 2), y: Math.round(rect.y + rect.h / 2), w: 0, h: 0, style: {} });
  const s = ITEM_SIZE[to];
  const w = n.kind === "mind" ? s.w : n.w || s.w;
  const h = n.kind === "mind" ? s.h : to === "text" ? s.h : n.h || s.h;
  const style: BoardNode["style"] = to === "sticky" ? { color: n.style.color && STICKY_COLOR_SET.has(n.style.color) ? n.style.color : "yellow" } : {};
  return up({ ...n, kind: to, parent_id: null, position: 0, x: Math.round(rect.x), y: Math.round(rect.y), w, h, style, frame_id: n.frame_id });
}
const STICKY_COLOR_SET = new Set<string>(STICKY_COLORS);
