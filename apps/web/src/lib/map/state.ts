import type { BoardEdge, BoardNode, Op } from "./types";
import { isKnownKind, opTarget } from "./types";

/** The client copy of a board: rows keyed by id. Replaced (not mutated) on every change so React sees it. */
export interface BoardData {
  nodes: Map<string, BoardNode>;
  edges: Map<string, BoardEdge>;
}

export const emptyData = (): BoardData => ({ nodes: new Map(), edges: new Map() });

export function dataFrom(nodes: BoardNode[], edges: BoardEdge[]): BoardData {
  return { nodes: new Map(nodes.map((n) => [n.id, n])), edges: new Map(edges.map((e) => [e.id, e])) };
}

/** Apply ops to a copy of the data. Deleting a node also removes the connectors that touch it (the server does the same). */
export function applyOps(data: BoardData, ops: Op[]): BoardData {
  const nodes = new Map(data.nodes);
  const edges = new Map(data.edges);
  for (const op of ops) {
    switch (op.op) {
      case "upsert_node": nodes.set(op.node.id, op.node); break;
      case "delete_node":
        nodes.delete(op.id);
        for (const [id, e] of edges) if (e.from_id === op.id || e.to_id === op.id) edges.delete(id);
        break;
      case "upsert_edge": edges.set(op.edge.id, op.edge); break;
      case "delete_edge": edges.delete(op.id); break;
    }
  }
  return { nodes, edges };
}

/**
 * Stamp each node op with the updated_at the client last saw for that row (the server's stale-write guard), and
 * return the ops that undo them, in reverse order. Rows written by this client take the server's `updated` stamp from each ops response (see use-board).
 */
export function stampAndInvert(data: BoardData, rawOps: Op[]): { ops: Op[]; inverse: Op[] } {
  // A row of a kind this build cannot draw is never written back (an older API would refuse the whole batch).
  const ops = rawOps.filter((o) => (o.op === "upsert_node" ? isKnownKind(o.node.kind) : o.op === "delete_node" ? isKnownKind(data.nodes.get(o.id)?.kind ?? "mind") : true));
  const stamped: Op[] = [];
  const inverse: Op[] = [];
  let cur = data;
  for (const raw of ops) {
    let op = raw;
    if (op.op === "upsert_node" || op.op === "delete_node") {
      const id = opTarget(op);
      const prev = cur.nodes.get(id);
      op = { ...op, base_updated_at: prev?.updated_at ?? null };
      inverse.push(prev ? { op: "upsert_node", node: prev, base_updated_at: null } : { op: "delete_node", id, base_updated_at: null });
      if (op.op === "delete_node") {
        // deleting a node removes its connectors: undo must bring them back too
        for (const e of cur.edges.values()) if (e.from_id === id || e.to_id === id) inverse.push({ op: "upsert_edge", edge: e, base_updated_at: null });
      }
    } else if (op.op === "upsert_edge") {
      const prev = cur.edges.get(op.edge.id);
      op = { ...op, base_updated_at: prev?.updated_at ?? null };
      inverse.push(prev ? { op: "upsert_edge", edge: prev, base_updated_at: null } : { op: "delete_edge", id: op.edge.id, base_updated_at: null });
    } else {
      const prev = cur.edges.get(op.id);
      op = { ...op, base_updated_at: prev?.updated_at ?? null };
      if (prev) inverse.push({ op: "upsert_edge", edge: prev, base_updated_at: null });
    }
    stamped.push(op);
    cur = applyOps(cur, [op]);
  }
  return { ops: orderForBatches(stamped, data.nodes), inverse: orderForBatches(inverse.reverse(), cur.nodes) };
}

/**
 * Order ops so any prefix of the list (a 500-op batch boundary) leaves the board consistent: connector deletes first, node deletes
 * children before parents, node upserts parents before children, connector upserts last. Within a group the given order is kept.
 */
export function orderForBatches(ops: Op[], nodes: Map<string, BoardNode>): Op[] {
  const rows = new Map<string, BoardNode>();
  for (const op of ops) if (op.op === "upsert_node") rows.set(op.node.id, op.node);
  const depthIn = (id: string, lookup: (i: string) => string | null | undefined): number => {
    let d = 0, cur = lookup(id);
    while (cur && d < 10_000) { d++; cur = lookup(cur); }
    return d;
  };
  const delDepth = (id: string) => depthIn(id, (i) => nodes.get(i)?.parent_id);
  const upDepth = (id: string) => depthIn(id, (i) => (rows.has(i) ? rows.get(i)!.parent_id : null));
  const group = (kind: Op["op"]) => ops.filter((o) => o.op === kind);
  return [
    ...group("delete_edge"),
    ...group("delete_node").sort((a, b) => delDepth(opTarget(b)) - delDepth(opTarget(a))),
    ...group("upsert_node").sort((a, b) => upDepth(opTarget(a)) - upDepth(opTarget(b))),
    ...group("upsert_edge"),
  ];
}
