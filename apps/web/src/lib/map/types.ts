/**
 * Every request/response shape of /api/v1/boards, in ONE place. When Phase 1 (the API) lands and a field differs,
 * this file and boards-api.ts are the only places to touch. Contract: spec.md + planner v2/v3 deltas.
 */

export type BoardKind = "life" | "free";
export type NodeKind = "mind" | "ref" | "sticky" | "text" | "shape" | "frame" | "image" | "file";
/** Every kind this build can draw. A row of any other kind (written by a later release) stays on the board untouched: it is shown inert and never sent back in ops. */
export const KNOWN_KINDS: ReadonlySet<string> = new Set(["mind", "ref", "sticky", "text", "shape", "frame", "image", "file"]);
export const isKnownKind = (kind: string): kind is NodeKind => KNOWN_KINDS.has(kind);
export type Side = "L" | "R";
export type StickyColor = "yellow" | "orange" | "green" | "teal" | "blue" | "violet" | "pink" | "gray";

/** Free-form per-node style. `color`: a stream colour key ("violet") on mind nodes, a StickyColor on stickies. `side`: which side of its root a first-level branch sits on. */
export interface NodeStyle {
  color?: string;
  side?: Side;
  /** Mind roots: how the map grows (both | right | left | down | up). Default both. */
  layout?: "both" | "right" | "left" | "down" | "up";
  /** Mind roots: shape of the branch lines in this map. */
  edge?: "curved" | "elbow" | "straight";
  /** Mind nodes and shapes: how the box is filled. */
  fill?: "outline" | "tint" | "solid";
  /** Mind nodes: box corners; shape objects: one of the 12 shapes. */
  shape?: string;
  bold?: boolean;
  size?: "S" | "M" | "L";
  /** An emoji shown before the text. */
  icon?: string;
  /** A link: shown as a chip, Ctrl/Cmd-click opens it. */
  url?: string;
  locked?: boolean;
  /** Stacking order among free items (higher is in front). */
  z?: number;
  /** Shapes and text. */
  border?: string; dash?: "solid" | "dashed" | "dotted"; bw?: 1 | 2 | 4; align?: "left" | "center" | "right";
  /** Image and file nodes: the id of the uploaded file. */
  file_id?: string;
}

export interface BoardNode {
  id: string;
  kind: NodeKind;
  /** Mind tree parent (another node of this board); null for roots and free items. */
  parent_id: string | null;
  /** Derived Life key the node hangs under (Phase 3); unused by the canvas for now. */
  parent_key: string | null;
  /** Order among siblings. */
  position: number;
  /** Absolute board coordinates. Authoritative for free items and mind roots; mind children are laid out client-side. */
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  /** Longer free text (max 10,000). */
  notes: string;
  style: NodeStyle;
  collapsed: boolean;
  hidden: boolean;
  ref_key: string | null;
  /** The frame this free item sits in (membership only; x/y stay absolute). */
  frame_id: string | null;
  /** Server clock of the last write; sent back as base_updated_at. Null for rows not yet saved. */
  updated_at: string | null;
}

export interface BoardEdge {
  id: string;
  from_id: string;
  to_id: string;
  label: string;
  style: Record<string, unknown>;
  updated_at?: string | null;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface Board {
  id: string;
  title: string;
  kind: BoardKind;
  viewport: Viewport | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface BoardDetail extends Board {
  nodes: BoardNode[];
  edges: BoardEdge[];
}

export type Op =
  | { op: "upsert_node"; node: BoardNode; base_updated_at: string | null }
  | { op: "delete_node"; id: string; base_updated_at: string | null }
  | { op: "upsert_edge"; edge: BoardEdge; base_updated_at: string | null }
  | { op: "delete_edge"; id: string; base_updated_at: string | null };

export interface OpsRequest {
  ops: Op[];
}

export interface OpsResponse {
  revision: number;
  /** id -> updated_at of every node and edge this batch wrote: the next base_updated_at for those rows. */
  updated?: Record<string, string>;
  /** Ids of ops the server refused (422): dropped by the client, which then reloads. */
  bad_ops?: string[];
  /** Ops skipped because the stored row was newer than base_updated_at (200). */
  stale_ops?: string[];
}

/** 422/413 body: `detail` plus the ids of the refused ops. */
export interface BadOpsBody {
  detail?: string;
  bad_ops?: string[];
}

export interface CreateBoardRequest {
  title: string;
}

export interface PromoteRequest {
  stream: string;
  lane: "now" | "next" | "backlog";
  checkpoint: string | null;
  product?: string;
}

export interface PromoteResponse {
  task_id: number;
  revision: number;
  node: BoardNode;
}

export interface PatchBoardRequest {
  title?: string;
  viewport?: Viewport;
}

/** The id an op is about (node or edge). */
export function opTarget(op: Op): string {
  switch (op.op) {
    case "upsert_node": return op.node.id;
    case "upsert_edge": return op.edge.id;
    default: return op.id;
  }
}

export const MAX_NODES = 5000;
export const MAX_EDGES = 5000;
export const MAX_TEXT = 4000;
export const MAX_OPS = 500;

export const STICKY_COLORS: StickyColor[] = ["yellow", "orange", "green", "teal", "blue", "violet", "pink", "gray"];
/** New stickies take these in turn (the first four, as before); all eight stay available. */
export const STICKY_CYCLE: StickyColor[] = ["yellow", "green", "blue", "pink"];
/** Branch colours for first-level branches of a free board's mind map (stream colour keys, so they follow the skin). */
export const BRANCH_COLORS = ["violet", "cyan", "orange", "indigo", "lime", "fuchsia", "rose", "sky", "emerald", "amber"];
