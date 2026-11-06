import type { Lane, MonthKey, PipelineItemData, PipelinesData, QuarterData, VaultObjectivesData } from "@/lib/vault-types";
import { MONTH_LABEL } from "@/lib/streams";
import type { BoardData } from "./state";
import type { BoardEdge, BoardNode, Side } from "./types";

/**
 * The Life board: a tree built from Plan on every load, merged with what the board stores (thoughts, and per-key state rows
 * of kind "ref"). Derived nodes are given the id of their KEY ("task:12"), so a node keeps its identity whether or not a state
 * row exists. Pure: no React, no network.
 */

export interface PlanInput {
  quarter: QuarterData | null;
  pipelines: PipelinesData | null;
  objectives: VaultObjectivesData | null;
}

export type LiveType = "quarter" | "stream" | "checkpoint" | "week" | "task" | "unplaced";

/** What the canvas needs to know about a derived node beyond its row: how to label it and how to edit the real Plan row. */
export interface LiveInfo {
  key: string;
  type: LiveType;
  stream?: string;
  streamName?: string;
  month?: MonthKey;
  week?: string;
  item?: PipelineItemData;
  lane?: Lane;
  tag: string;
  tagNow?: boolean;
  /** Mono micro-label above the title (root: "Q4 · Super Objective"). */
  sub?: string;
  /** The Plan object behind a stored row is gone. */
  gone?: boolean;
  done?: boolean;
}

export interface LifeView {
  /** Rows as the canvas sees them: derived nodes (kind "ref", id = key) plus stored thoughts, re-parented onto derived nodes. */
  data: BoardData;
  info: Map<string, LiveInfo>;
  /** Stored state row by key (promote-created rows included). */
  rowOfKey: Map<string, BoardNode>;
}

export const UNPLACED = "unplaced:life";
/** A key (derived id) always contains a colon; stored row ids are UUIDs and never do. */
export const isKey = (id: string) => id.includes(":");

export const LANE_TAG: Record<Lane, string> = { now: "NOW", next: "NEXT", backlog: "SOMEDAY", done: "DONE" };

/** Deterministic id for a state row the client creates (<= 36 chars): the same key always maps to the same row. */
export function stateRowId(key: string): string {
  let h1 = 0xdeadbeef ^ key.length, h2 = 0x41c6ce57 ^ key.length;
  for (let i = 0; i < key.length; i++) { const c = key.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `k-${(h2 >>> 0).toString(36)}${(h1 >>> 0).toString(36)}-${key.length.toString(36)}`;
}

const blank = (id: string, p: Partial<BoardNode>): BoardNode => ({
  id, kind: "ref", parent_id: null, parent_key: null, position: 0, x: 0, y: 0, w: 0, h: 0, text: "", notes: "", style: {}, collapsed: false,
  hidden: false, ref_key: null, frame_id: null, updated_at: null, ...p,
});

export function deriveLifeTree(plan: PlanInput, stored: BoardData, opts: { showDone: boolean }): LifeView {
  const nodes = new Map<string, BoardNode>();
  const info = new Map<string, LiveInfo>();
  const rowOfKey = new Map<string, BoardNode>();
  const keyOfRow = new Map<string, string>();
  for (const n of stored.nodes.values()) if (n.kind === "ref" && n.ref_key) { rowOfKey.set(n.ref_key, n); keyOfRow.set(n.id, n.ref_key); }

  /** Add a derived node; the stored state row (if any) supplies collapsed / hidden / side. */
  const add = (key: string, parent: string | null, position: number, text: string, i: LiveInfo, style: BoardNode["style"] = {}) => {
    const row = rowOfKey.get(key);
    nodes.set(key, blank(key, {
      parent_id: parent, position, text, ref_key: key, collapsed: row?.collapsed ?? false, hidden: row?.hidden ?? false,
      style, updated_at: row?.updated_at ?? null, notes: row?.notes ?? "",
    }));
    info.set(key, i);
  };

  const q = plan.quarter, pl = plan.pipelines;
  if (q && pl) {
    const rootKey = `quarter:${q.quarter}`;
    const qn = /Q\d/.exec(q.quarter)?.[0] ?? q.quarter;
    add(rootKey, null, 0, q.objective || "Super Objective", { key: rootKey, type: "quarter", tag: "", sub: `${qn} · Super Objective` });
    const quarterStreams = new Map(q.streams.map((s) => [s.stream, s]));
    let blockIdx = 0;
    for (const ps of pl.streams) {
      if (ps.status === "archived") continue;
      const qs = quarterStreams.get(ps.stream);
      const key = `stream:${ps.stream}`;
      const defaultSide: Side = blockIdx % 2 === 0 ? "R" : "L";
      const storedSide = rowOfKey.get(key)?.style.side;
      add(key, rootKey, blockIdx, ps.name, { key, type: "stream", stream: ps.stream, streamName: ps.name, tag: "" }, { color: ps.color || "slate", side: storedSide ?? defaultSide });
      blockIdx++;
      let pos = 0;
      const visible = ps.items.filter((it) => opts.showDone || (it.lane !== "done" && !it.done));
      const monthsWithItems = new Set(visible.filter((it) => it.checkpoint).map((it) => it.checkpoint as MonthKey));
      for (const cp of qs?.checkpoints ?? []) {
        if (!cp.text.trim() && !monthsWithItems.has(cp.month)) continue;
        const ck = `cp:${ps.stream}:${cp.month}`;
        add(ck, key, pos++, cp.text.trim() || MONTH_LABEL[cp.month], { key: ck, type: "checkpoint", stream: ps.stream, streamName: ps.name, month: cp.month, tag: cp.month.toUpperCase() });
      }
      // a checkpoint a pipeline item names that the quarter note does not list still gets its node
      for (const m of monthsWithItems) {
        const ck = `cp:${ps.stream}:${m}`;
        if (!nodes.has(ck)) add(ck, key, pos++, MONTH_LABEL[m], { key: ck, type: "checkpoint", stream: ps.stream, streamName: ps.name, month: m, tag: m.toUpperCase() });
      }
      const wk = plan.objectives?.items.find((o) => o.stream === ps.stream && o.text.trim());
      if (wk && plan.objectives) {
        const wkKey = `week:${ps.stream}:${plan.objectives.week}`;
        add(wkKey, key, pos++, wk.text, { key: wkKey, type: "week", stream: ps.stream, streamName: ps.name, week: plan.objectives.week, tag: `W${plan.objectives.week.split("W")[1] ?? ""}`, done: wk.done });
      }
      for (const it of visible) {
        const k = `task:${it.line}`;
        const parent = it.checkpoint && nodes.has(`cp:${ps.stream}:${it.checkpoint}`) ? `cp:${ps.stream}:${it.checkpoint}` : key;
        add(k, parent, pos++, it.text, { key: k, type: "task", stream: ps.stream, streamName: ps.name, item: it, lane: it.lane, tag: LANE_TAG[it.lane], tagNow: it.lane === "now", done: it.lane === "done" || it.done });
      }
    }
  }
  const derived = new Set(nodes.keys());
  const rootKey = [...nodes.values()].find((n) => n.parent_id === null)?.id ?? null;

  // Stored rows whose Plan object is gone, and thoughts hung under a key nobody derives, collect under Unplaced on the root.
  const orphanRows = [...rowOfKey.entries()].filter(([k]) => !derived.has(k) && !k.startsWith("quarter:") && !(k.startsWith("stream:") || k.startsWith("cp:") || k.startsWith("week:")));
  const lostParent = (n: BoardNode) => !!n.parent_key && !derived.has(n.parent_key);
  const thoughts = [...stored.nodes.values()].filter((n) => n.kind !== "ref");
  const hasOrphan = orphanRows.length > 0 || thoughts.some((n) => n.kind === "mind" && lostParent(n));
  // With no quarter loaded there is no root to hang anything on: show the stored thoughts as they are.
  const unplacedOk = hasOrphan && rootKey !== null;
  if (unplacedOk) {
    add(UNPLACED, rootKey, 9999, "Unplaced", { key: UNPLACED, type: "unplaced", tag: "PLAN ITEM GONE", gone: true }, { color: "slate", side: "R" });
  }
  for (const [k, row] of orphanRows) {
    if (!unplacedOk) break;
    nodes.set(k, blank(k, { parent_id: UNPLACED, position: row.position, text: row.text || k, ref_key: k, collapsed: row.collapsed, hidden: row.hidden, updated_at: row.updated_at }));
    info.set(k, { key: k, type: "task", tag: "GONE", gone: true });
    derived.add(k);
  }

  const resolve = (n: BoardNode): string | null => {
    if (n.parent_key) {
      if (derived.has(n.parent_key)) return n.parent_key;
      return unplacedOk ? UNPLACED : null;
    }
    if (n.parent_id) return keyOfRow.get(n.parent_id) ?? n.parent_id;
    return null;
  };
  for (const n of thoughts) {
    const parent = resolve(n);
    // a thought whose parent row was deleted server-side would dangle: show it as a root rather than lose it
    nodes.set(n.id, parent === null || nodes.has(parent) || stored.nodes.has(parent) ? { ...n, parent_id: parent, parent_key: null } : { ...n, parent_id: null, parent_key: null });
  }

  const edges = new Map<string, BoardEdge>();
  for (const e of stored.edges.values()) edges.set(e.id, { ...e, from_id: keyOfRow.get(e.from_id) ?? e.from_id, to_id: keyOfRow.get(e.to_id) ?? e.to_id });
  return { data: { nodes, edges }, info, rowOfKey };
}

/**
 * A free board shows promoted thoughts (kind "ref") with their live title and tag when the Plan item is still there.
 * Other rows pass through unchanged.
 */
export function enrichRefs(stored: BoardData, plan: PlanInput): LifeView {
  const items = new Map<string, { item: PipelineItemData; stream: string; name: string }>();
  for (const s of plan.pipelines?.streams ?? []) for (const it of s.items) items.set(`task:${it.line}`, { item: it, stream: s.stream, name: s.name });
  const nodes = new Map(stored.nodes);
  const info = new Map<string, LiveInfo>();
  const rowOfKey = new Map<string, BoardNode>();
  for (const n of stored.nodes.values()) {
    if (n.kind !== "ref" || !n.ref_key) continue;
    rowOfKey.set(n.ref_key, n);
    const hit = items.get(n.ref_key);
    if (hit) {
      nodes.set(n.id, { ...n, text: hit.item.text });
      info.set(n.id, { key: n.ref_key, type: "task", stream: hit.stream, streamName: hit.name, item: hit.item, lane: hit.item.lane, tag: LANE_TAG[hit.item.lane], tagNow: hit.item.lane === "now", done: hit.item.lane === "done" });
    } else if (plan.pipelines) info.set(n.id, { key: n.ref_key, type: "task", tag: "GONE", gone: true });
  }
  return { data: { nodes, edges: stored.edges }, info, rowOfKey };
}

/**
 * Canvas ops speak in view ids (keys for derived nodes). Stored rows are UUIDs. This rewrites an op list for storage:
 * a derived node's state change becomes an upsert of its "ref" row; a thought under a derived node stores the parent's key.
 * Derived nodes never get a row until some state changes, and never a row for the Unplaced branch.
 */
export function toStored(ops: import("./types").Op[], view: LifeView | null, stored: BoardData): import("./types").Op[] {
  if (!view) return ops;
  const out: import("./types").Op[] = [];
  const rowId = (key: string) => view.rowOfKey.get(key)?.id ?? stateRowId(key);
  const seenState = new Set<string>();
  for (const op of ops) {
    if (op.op === "upsert_node") {
      const n = op.node;
      if (isKey(n.id)) {
        if (n.id === UNPLACED || n.id.startsWith("unplaced:")) continue;
        if (seenState.has(n.id)) continue;
        seenState.add(n.id);
        const prev = view.rowOfKey.get(n.id);
        // Only state is stored for a derived node; its title and place come from Plan.
        out.push({ op: "upsert_node", base_updated_at: null, node: {
          ...(prev ?? blank(rowId(n.id), {})), id: rowId(n.id), kind: "ref", ref_key: n.id, parent_id: null, parent_key: null,
          text: prev?.text || n.text, collapsed: n.collapsed, hidden: n.hidden, style: { ...(prev?.style ?? {}), ...(n.style.side ? { side: n.style.side } : {}) },
        } });
        continue;
      }
      if (n.kind === "ref") { out.push(op); continue; }   // a promoted row edited as a stored row (rare): pass through
      if (n.parent_id && isKey(n.parent_id)) { out.push({ ...op, node: { ...n, parent_id: null, parent_key: n.parent_id } }); continue; }
      if (n.parent_id && !stored.nodes.has(n.parent_id)) {
        // the parent is a stored state row seen under its key id? (rows are keyed by key in the view): nothing to rewrite
        out.push(op); continue;
      }
      out.push(op);
    } else if (op.op === "delete_node") {
      if (isKey(op.id)) continue;   // live nodes are hidden, never deleted
      out.push(op);
    } else out.push(op);
  }
  return out;
}
