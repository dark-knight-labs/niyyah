import { MarkerType, type Edge, type Node } from "@xyflow/react";
import { branchHandles, layoutMindMap, type Size } from "@/lib/map/layout";
import { colorKeyOf, colorVar, descendantCount, dirOf, isMind, rootOf, visibleForest } from "@/lib/map/tree";
import type { LiveInfo } from "@/lib/map/life-tree";
import type { BoardData } from "@/lib/map/state";
import { isKnownKind, type BoardNode, type StickyColor } from "@/lib/map/types";

export type MindData = {
  kind: "mind";
  text: string;
  depth: number;
  dir: 1 | -1 | 0;
  color: string;
  hasChildren: boolean;
  collapsed: boolean;
  hiddenCount: number;
  editing: boolean;
  bar: boolean;
  drop: boolean;
  refKey: string | null;
  parent: string;
  /** Live Plan node: mono tag (NOW, NOV, W45), the root's micro-label, state flags. */
  tag: string;
  tagNow: boolean;
  sub: string;
  gone: boolean;
  done: boolean;
  flash: boolean;
  /** Box style (node style keys). */
  fill: string;
  shape: string;
  size: string;
  bold: boolean;
  icon: string;
  url: string;
  hasNotes: boolean;
  locked: boolean;
  orient: "h" | "v";
  dim: boolean;
  own: boolean;
};
export type ItemData = {
  kind: "sticky" | "text" | "shape" | "frame" | "image" | "file" | "unknown";
  text: string;
  color: StickyColor;
  editing: boolean;
  bar: boolean;
  linkFrom: boolean;
  dim?: boolean;
};
export type MapNodeData = MindData | ItemData;
export type MapNode = Node<MapNodeData & Record<string, unknown>>;

/** Rectangle changes made by RF while the owner drags or resizes, in RF coordinates (relative to the frame for framed nodes). Committed on release. */
export type Live = { x?: number; y?: number; w?: number; h?: number };

export interface DeriveUi {
  selected: ReadonlySet<string>;
  editing: string | null;
  dropTarget: string | null;
  linkFrom: string | null;
  flash: string | null;
  info: ReadonlyMap<string, LiveInfo>;
  live: ReadonlyMap<string, Live>;
  sizes: ReadonlyMap<string, Size>;
  /** Focus mode: ids that stay bright (everything else is dimmed). Null = off. */
  focus?: ReadonlySet<string> | null;
}

export interface Derived {
  nodes: MapNode[];
  edges: Edge[];
  /** Absolute rectangles by node id (committed layout, no live overrides): minimap, fit, frame hit-testing. */
  rects: Map<string, { x: number; y: number; w: number; h: number }>;
}

const ITEM_KINDS = new Set(["sticky", "text", "shape", "frame", "image", "file"]);

function same(a: MapNode, b: MapNode): boolean {
  if (a.type !== b.type || a.position.x !== b.position.x || a.position.y !== b.position.y || a.parentId !== b.parentId || a.selected !== b.selected
    || a.width !== b.width || a.height !== b.height || a.measured?.width !== b.measured?.width || a.measured?.height !== b.measured?.height
    || a.draggable !== b.draggable || a.zIndex !== b.zIndex) return false;
  const da = a.data as Record<string, unknown>, db = b.data as Record<string, unknown>;
  for (const k in db) if (da[k] !== db[k]) return false;
  return Object.keys(da).length === Object.keys(db).length;
}

/**
 * Board rows + measured sizes + interaction state -> React Flow nodes and edges. Mind nodes are placed by layoutMindMap (positions
 * of mind children are never stored); free items and roots come from their rows. Unchanged nodes keep their previous object so
 * React Flow and the memoised node components skip them.
 */
export function derive(data: BoardData, idx: Map<string | null, BoardNode[]>, ui: DeriveUi, prev: Map<string, MapNode>): Derived {
  const { nodes } = data;
  const placed = layoutMindMap(visibleForest(nodes, idx), ui.sizes as Map<string, Size>);
  const out: MapNode[] = [];
  const rects = new Map<string, { x: number; y: number; w: number; h: number }>();
  const frames = new Map<string, BoardNode>();
  for (const n of nodes.values()) if (n.kind === "frame") frames.set(n.id, n);

  const meas = (id: string) => { const z = ui.sizes.get(id); return z ? { width: z.w, height: z.h } : undefined; };
  const single = (id: string) => ui.selected.size === 1 && ui.selected.has(id);
  const push = (n: MapNode) => { const p = prev.get(n.id); out.push(p && same(p, n) ? p : n); };
  const framed = (id: string | null) => (id ? frames.get(id) : undefined);

  // frames first: RF needs parents before children, and they paint beneath
  for (const f of frames.values()) {
    const l = ui.live.get(f.id);
    const w = l?.w ?? f.w, h = l?.h ?? f.h;
    rects.set(f.id, { x: f.x, y: f.y, w: f.w, h: f.h });
    push({
      id: f.id, type: "frame", position: { x: l?.x ?? f.x, y: l?.y ?? f.y }, width: w, height: h, measured: { width: w, height: h }, zIndex: 0,
      selected: ui.selected.has(f.id), data: { kind: "frame", text: f.text, color: "yellow", editing: ui.editing === f.id, bar: single(f.id), linkFrom: ui.linkFrom === f.id },
    });
  }

  for (const n of nodes.values()) {
    if (!isKnownKind(n.kind)) {
      if (n.hidden) continue;
      // a later release's object: drawn inert (no select, drag, connect, no rect for fit or organize) and never written back
      push({
        id: n.id, type: "unknown", position: { x: n.x, y: n.y }, width: Math.max(n.w, 120), height: Math.max(n.h, 44), measured: { width: Math.max(n.w, 120), height: Math.max(n.h, 44) }, zIndex: 1,
        selectable: false, draggable: false, connectable: false, focusable: false, deletable: false, data: { kind: "unknown", text: "", color: "yellow", editing: false, bar: false, linkFrom: false },
      } as MapNode);
      continue;
    }
    if (!ITEM_KINDS.has(n.kind) || n.kind === "frame") continue;
    const fr = framed(n.frame_id);
    const l = ui.live.get(n.id);
    const w = l?.w ?? n.w, h = l?.h ?? n.h;
    rects.set(n.id, { x: n.x, y: n.y, w: n.w, h: n.h });
    push({
      id: n.id, type: n.kind === "image" || n.kind === "file" ? "unavailable" : n.kind, parentId: fr?.id, position: { x: l?.x ?? n.x - (fr?.x ?? 0), y: l?.y ?? n.y - (fr?.y ?? 0) },
      width: w, height: n.kind === "text" ? undefined : h, measured: n.kind === "text" ? meas(n.id) ?? { width: w, height: h } : { width: w, height: h },
      zIndex: 1, selected: ui.selected.has(n.id),
      data: { kind: n.kind as ItemData["kind"], text: n.text, color: (n.style.color as StickyColor) ?? "yellow", editing: ui.editing === n.id, bar: single(n.id), linkFrom: ui.linkFrom === n.id, dim: !!ui.focus && !ui.focus.has(n.id) },
    } as MapNode);
  }

  const edges: Edge[] = [];
  for (const [id, p] of placed) {
    const n = nodes.get(id);
    if (!n || !isMind(n)) continue;
    const root = rootOf(nodes, id);
    const fr = framed(root?.frame_id ?? null);
    const l = ui.live.get(id);
    const depth = p.depth;
    const abs = { x: p.x, y: p.y, w: p.w, h: p.h };
    rects.set(id, abs);
    const kids = idx.get(id) ?? [];
    push({
      id, type: "mind", parentId: fr?.id, position: { x: l?.x ?? p.x - (fr?.x ?? 0), y: l?.y ?? p.y - (fr?.y ?? 0) },
      measured: meas(id), zIndex: 2, selected: ui.selected.has(id), draggable: true,
      data: {
        kind: "mind", text: n.text, depth, dir: dirOf(nodes, id), color: colorVar(colorKeyOf(nodes, id)), hasChildren: kids.some((c) => !c.hidden),
        collapsed: n.collapsed, hiddenCount: n.collapsed ? descendantCount(idx, id) : 0, editing: ui.editing === id, bar: single(id), drop: ui.dropTarget === id, refKey: n.ref_key, parent: n.parent_id ?? "",
        fill: n.style.fill ?? (depth === 1 ? "tint" : "outline"), shape: n.style.shape ?? "rect", size: n.style.size ?? "M", bold: !!n.style.bold, icon: n.style.icon ?? "", url: n.style.url ?? "",
        hasNotes: !!n.notes.trim(), locked: !!n.style.locked, orient: p.orient, dim: !!ui.focus && !ui.focus.has(id), own: !!n.style.color,
        tag: ui.info.get(id)?.tag ?? "", tagNow: !!ui.info.get(id)?.tagNow, sub: ui.info.get(id)?.sub ?? "", gone: !!ui.info.get(id)?.gone, done: !!ui.info.get(id)?.done, flash: ui.flash === id,
      },
    });
    if (n.parent_id && placed.has(n.parent_id)) {
      const hs = branchHandles(p.side, p.orient);
      edges.push({
        id: `t:${id}`, source: n.parent_id, target: id, type: "branch", selectable: false, focusable: false,
        sourceHandle: hs.source, targetHandle: hs.target, data: { color: colorVar(colorKeyOf(nodes, id)), kind: rootOf(nodes, id)?.style.edge ?? "curved", depth, orient: p.orient },
      });
    }
  }

  for (const e of data.edges.values()) {
    if (!nodes.has(e.from_id) || !nodes.has(e.to_id)) continue;
    const vis = (id: string) => { const n = nodes.get(id)!; return isMind(n) ? placed.has(id) : !n.hidden; };
    if (!vis(e.from_id) || !vis(e.to_id)) continue;
    edges.push({
      id: e.id, source: e.from_id, target: e.to_id, type: "connector", sourceHandle: "cs", targetHandle: "ct", selected: ui.selected.has(e.id),
      markerEnd: { type: MarkerType.ArrowClosed, color: "var(--muted-foreground)", width: 14, height: 14 }, data: { label: e.label },
    });
  }

  // keep last render's objects for the next comparison
  prev.clear();
  for (const n of out) prev.set(n.id, n);
  return { nodes: out, edges, rects };
}
