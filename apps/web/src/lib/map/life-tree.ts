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

export type LiveType = "quarter" | "stream" | "checkpoint" | "week" | "product" | "lane" | "task" | "unplaced";

/** What the canvas needs to know about a derived node beyond its row: how to label it and how to edit the real Plan row. */
export interface LiveInfo {
  key: string;
  type: LiveType;
  stream?: string;
  streamName?: string;
  month?: MonthKey;
  week?: string;
  item?: PipelineItemData;
  /** The lane of a task or of a lane node. */
  lane?: Lane;
  /** A product node's label, and on a lane node or task the product (tag) it sits under, if any. */
  product?: string;
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
  /** The style Plan derives for each live node (a block's colour, the default side): what is not worth storing. */
  defaults: Map<string, BoardNode["style"]>;
}

export const UNPLACED = "unplaced:life";
/** A key (derived id) always contains a colon; stored row ids are UUIDs and never do. */
export const isKey = (id: string) => id.includes(":");

export const LANE_TAG: Record<Lane, string> = { now: "NOW", next: "NEXT", backlog: "SOMEDAY", done: "DONE" };
export const LANE_LABEL: Record<Lane, string> = { now: "Now", next: "Next", backlog: "Someday", done: "Done" };
/** What the API accepts as a promote product (schemas/board.py PRODUCT_TAG). Other tags still get product nodes, but cannot be set from the map. */
export const PRODUCT_TAG = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const LANE_ORDER: Lane[] = ["now", "next", "backlog", "done"];
const MONTH_ORDER: MonthKey[] = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** SHA-256 of a string as hex (synchronous: the tree is built in render, crypto.subtle is async). */
function sha256Hex(text: string): string {
  const K = new Uint32Array(64);
  for (let i = 0, n = 2; i < 64; n++) { let prime = true; for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; } if (prime) K[i++] = Math.floor((Math.cbrt(n) % 1) * 4294967296); }
  const H = new Uint32Array(8);
  for (let i = 0, n = 2; i < 8; n++) { let prime = true; for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; } if (prime) H[i++] = Math.floor((Math.sqrt(n) % 1) * 4294967296); }
  const bytes = new TextEncoder().encode(text);
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes); padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor((bytes.length * 8) / 4294967296)); view.setUint32(padded.length - 4, (bytes.length * 8) >>> 0);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) { const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0; }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  return [...H].map((x) => x.toString(16).padStart(8, "0")).join("");
}

/**
 * The key part of a product tag. Tags group case-insensitively (the label is the first spelling seen); a plain lowercase tag that starts with a
 * letter is its own key, anything else (spaces, non-ASCII, a leading digit, longer than 32) becomes _ + 16 hex of its SHA-256, so a
 * tag key can never equal a hash key. Keying lives only here, never on the server.
 */
export function tagKey(tag: string): string {
  const low = tag.toLowerCase();
  return /^[a-z][a-z0-9_-]{0,31}$/.test(low) ? low : `_${sha256Hex(low).slice(0, 16)}`;
}

/** Deterministic id for a state row the client creates (<= 36 chars): the same key always maps to the same row. */
export function stateRowId(key: string): string {
  let h1 = 0xdeadbeef ^ key.length, h2 = 0x41c6ce57 ^ key.length;
  for (let i = 0; i < key.length; i++) { const c = key.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `k-${(h2 >>> 0).toString(36)}${(h1 >>> 0).toString(36)}-${key.length.toString(36)}`;
}

/** The style keys a derived (live) node keeps in its state row: how it is drawn and laid out. Never its title or place, which Plan owns (planner v2 B2). */
export const LIFE_STYLE_KEYS = ["side", "layout", "edge", "color", "fill", "shape", "bold", "size", "icon", "locked", "z"] as const;
const pickStyle = (style: BoardNode["style"] | undefined): BoardNode["style"] => {
  const out: Record<string, unknown> = {};
  if (style) for (const k of LIFE_STYLE_KEYS) if (style[k] !== undefined) out[k] = style[k];
  return out as BoardNode["style"];
};

const blank = (id: string, p: Partial<BoardNode>): BoardNode => ({
  id, kind: "ref", parent_id: null, parent_key: null, position: 0, x: 0, y: 0, w: 0, h: 0, text: "", notes: "", style: {}, collapsed: false,
  hidden: false, ref_key: null, frame_id: null, updated_at: null, ...p,
});

export function deriveLifeTree(plan: PlanInput, stored: BoardData, opts: { showDone: boolean }): LifeView {
  const nodes = new Map<string, BoardNode>();
  const info = new Map<string, LiveInfo>();
  const rowOfKey = new Map<string, BoardNode>();
  const keyOfRow = new Map<string, string>();
  const defaults = new Map<string, BoardNode["style"]>();
  for (const n of stored.nodes.values()) if (n.kind === "ref" && n.ref_key) { rowOfKey.set(n.ref_key, n); keyOfRow.set(n.id, n.ref_key); }

  /** Add a derived node; the stored state row (if any) supplies collapsed / hidden / side. */
  const add = (key: string, parent: string | null, position: number, text: string, i: LiveInfo, style: BoardNode["style"] = {}) => {
    const row = rowOfKey.get(key);
    nodes.set(key, blank(key, {
      parent_id: parent, position, text, ref_key: key, collapsed: row?.collapsed ?? false, hidden: row?.hidden ?? false,
      style: { ...style, ...pickStyle(row?.style) }, updated_at: row?.updated_at ?? null, notes: row?.notes ?? "",
    }));
    defaults.set(key, style);
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
      // Goals: the month checkpoints, as leaves, in month order. Items no longer hang under them; they carry the month as a tag.
      const goals = new Map<MonthKey, string>();
      for (const cp of qs?.checkpoints ?? []) if (cp.text.trim() || monthsWithItems.has(cp.month)) goals.set(cp.month, cp.text.trim() || MONTH_LABEL[cp.month]);
      for (const m of monthsWithItems) if (!goals.has(m)) goals.set(m, MONTH_LABEL[m]);   // a month an item names that the quarter note does not list
      for (const m of MONTH_ORDER) {
        const text = goals.get(m);
        if (text === undefined) continue;
        const ck = `cp:${ps.stream}:${m}`;
        add(ck, key, pos++, text, { key: ck, type: "checkpoint", stream: ps.stream, streamName: ps.name, month: m, tag: m.toUpperCase() });
      }
      const wk = plan.objectives?.items.find((o) => o.stream === ps.stream && o.text.trim());
      if (wk && plan.objectives) {
        const wkKey = `week:${ps.stream}:${plan.objectives.week}`;
        add(wkKey, key, pos++, wk.text, { key: wkKey, type: "week", stream: ps.stream, streamName: ps.name, week: plan.objectives.week, tag: `W${plan.objectives.week.split("W")[1] ?? ""}`, done: wk.done });
      }
      // Products: the primary tag of each item, grouped case-insensitively. Untagged items keep their lanes directly under the block.
      const groups = new Map<string, { label: string; items: PipelineItemData[] }>();
      const untagged: PipelineItemData[] = [];
      for (const it of visible) {
        const tag = it.products?.[0]?.trim();
        if (!tag) { untagged.push(it); continue; }
        const k = tagKey(tag);
        const g = groups.get(k);
        if (g) g.items.push(it); else groups.set(k, { label: tag, items: [it] });
      }
      const addLanes = (parent: string, tk: string, label: string | undefined, items: PipelineItemData[], position: { n: number }) => {
        for (const lane of LANE_ORDER) {
          const inLane = items.filter((it) => (it.done ? "done" : it.lane) === lane);
          if (!inLane.length) continue;
          const lk = `lane:${ps.stream}:${tk}:${lane}`;
          add(lk, parent, position.n++, LANE_LABEL[lane], { key: lk, type: "lane", stream: ps.stream, streamName: ps.name, lane, product: label, tag: String(inLane.length) });
          inLane.forEach((it, j) => {
            const k = `task:${it.line}`;
            add(k, lk, j, it.text, { key: k, type: "task", stream: ps.stream, streamName: ps.name, item: it, lane: it.lane, product: label, month: it.checkpoint ?? undefined, tag: it.checkpoint ? it.checkpoint.toUpperCase() : "", done: it.lane === "done" || it.done });
          });
        }
      };
      const where = { n: pos };
      for (const [tk, g] of [...groups.entries()].sort((a, b) => a[1].label.toLowerCase().localeCompare(b[1].label.toLowerCase()) || a[0].localeCompare(b[0]))) {
        const pk = `prod:${ps.stream}:${tk}`;
        add(pk, key, where.n++, g.label, { key: pk, type: "product", stream: ps.stream, streamName: ps.name, product: g.label, tag: "" });
        addLanes(pk, tk, g.label, g.items, { n: 0 });
      }
      addLanes(key, "_", undefined, untagged, where);
    }
  }
  const derived = new Set(nodes.keys());
  // every item the Plan still has, shown or not (Show done off hides done items from the tree, but they are not gone)
  const planItems = new Set<string>();
  for (const ps of plan.pipelines?.streams ?? []) for (const it of ps.items) planItems.add(`task:${it.line}`);
  const rootKey = [...nodes.values()].find((n) => n.parent_id === null)?.id ?? null;

  // Stored rows whose Plan item is gone, and thoughts hung under a key nobody derives, collect under Unplaced on the root.
  const orphanRows = [...rowOfKey.entries()].filter(([k]) => !derived.has(k) && k.startsWith("task:") && !planItems.has(k));   // only a Plan item can be "gone"; goal, product and lane rows are state that simply stops applying
  const lostParent = (n: BoardNode) => !!n.parent_key && !derived.has(n.parent_key);
  // Thoughts under an item Plan still has but the tree leaves out (done, with Show done off) are hidden with it, with their branches;
  // they come back under it when Show done is on. Only an item truly gone from Plan sends its thoughts to Unplaced.
  const all = [...stored.nodes.values()].filter((n) => n.kind !== "ref");
  const withHiddenItem = new Set(all.filter((n) => n.parent_key && planItems.has(n.parent_key) && !derived.has(n.parent_key)).map((n) => n.id));
  for (let grew = withHiddenItem.size > 0; grew;) {
    grew = false;
    for (const n of all) if (n.parent_id && withHiddenItem.has(n.parent_id) && !withHiddenItem.has(n.id)) { withHiddenItem.add(n.id); grew = true; }
  }
  const thoughts = all.filter((n) => !withHiddenItem.has(n.id));
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
  return { data: { nodes, edges }, info, rowOfKey, defaults };
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
  return { data: { nodes, edges: stored.edges }, info, rowOfKey, defaults: new Map() };
}

/**
 * Canvas ops speak in view ids (keys for derived nodes). Stored rows are UUIDs. This rewrites an op list for storage:
 * a derived node's state change becomes an upsert of its "ref" row; a thought under a derived node stores the parent's key.
 * Derived nodes never get a row until some state changes, and never a row for the Unplaced branch.
 */
const withoutLifeKeys = (style: BoardNode["style"] | undefined): BoardNode["style"] => {
  const out: Record<string, unknown> = { ...(style ?? {}) };
  for (const k of LIFE_STYLE_KEYS) delete out[k];
  return out as BoardNode["style"];
};

/** What of a derived node's style goes to its state row: the allow-listed keys the owner set. A value equal to what Plan derives (a block's colour) stays out, so a Plan colour change still shows. */
function storedStyle(style: BoardNode["style"], derived: BoardNode["style"] | undefined): BoardNode["style"] {
  const out: Record<string, unknown> = {};
  const picked = pickStyle(style) as Record<string, unknown>;
  for (const k of Object.keys(picked)) if (k === "side" ? !!picked[k] : picked[k] !== (derived as Record<string, unknown> | undefined)?.[k]) out[k] = picked[k];
  return out as BoardNode["style"];
}

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
          text: prev?.text || n.text, collapsed: n.collapsed, hidden: n.hidden, style: { ...withoutLifeKeys(prev?.style), ...storedStyle(n.style, view.defaults.get(n.id)) },
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
