import * as A from "./actions";
import { childIndex, nextBranchOf, subtreeIds } from "./tree";
import type { BoardData } from "./state";
import type { BoardEdge, BoardNode, Op } from "./types";

/** What copy puts on the internal clipboard: full rows (ids as they were), the connectors between them, and the text twin (an outline). */
export interface Clip { nodes: BoardNode[]; edges: BoardEdge[]; text: string; /** where the first item sat, to offset a paste */ at: { x: number; y: number } }

let held: Clip | null = null;
export const getClip = () => held;
export const setClip = (c: Clip | null) => { held = c; };

const isMindKind = (n: BoardNode) => n.kind === "mind" || n.kind === "ref";

/** Markdown outline of mind subtrees (and the text of other objects): two spaces per level. */
export function outlineOf(data: BoardData, ids: string[]): string {
  const idx = childIndex(data.nodes);
  const lines: string[] = [];
  const walk = (n: BoardNode, depth: number) => {
    lines.push(`${"  ".repeat(depth)}- ${n.text.replace(/\n+/g, " ").trim()}`);
    for (const c of idx.get(n.id) ?? []) if (!c.hidden) walk(c, depth + 1);
  };
  const picked = new Set(ids);
  for (const id of ids) {
    const n = data.nodes.get(id);
    if (!n) continue;
    if (isMindKind(n)) { if (!n.parent_id || !picked.has(n.parent_id)) walk(n, 0); }
    else if (n.text.trim()) lines.push(`- ${n.text.replace(/\n+/g, " ").trim()}`);
  }
  return lines.join("\n");
}

/** Copy the selection: mind nodes with their branches, frames with what sits in them. Live (Plan) nodes are not copied as rows, only as text. */
export function copySelection(data: BoardData, ids: string[]): Clip | null {
  const idx = childIndex(data.nodes);
  const take = new Set<string>();
  for (const id of ids) {
    const n = data.nodes.get(id);
    if (!n || n.kind === "ref") continue;
    if (n.kind === "mind") subtreeIds(idx, id).forEach((x) => { if (data.nodes.get(x)?.kind === "mind") take.add(x); });
    else if (n.kind === "frame") { take.add(id); for (const m of data.nodes.values()) if (m.frame_id === id) take.add(m.id); }
    else take.add(id);
  }
  const text = outlineOf(data, ids);
  if (!take.size && !text) return null;
  const nodes = [...take].map((id) => data.nodes.get(id)!).filter(Boolean);
  const edges = [...data.edges.values()].filter((e) => take.has(e.from_id) && take.has(e.to_id));
  const first = nodes.find((n) => !n.parent_id) ?? nodes[0];
  return { nodes, edges, text, at: { x: first?.x ?? 0, y: first?.y ?? 0 } };
}

export interface PasteTarget {
  /** A mind node to paste under (children), or null for the board. */
  parent: BoardNode | null;
  /** Board position for a paste onto the board (the clicked point), else a nudge from the original place is used. */
  pos: { x: number; y: number } | null;
  data: BoardData;
}

/** Ops that create copies of a clip: fresh ids, links between copies remapped, frame membership kept only when the frame came along. */
export function pasteClip(clip: Clip, t: PasteTarget): { ops: Op[]; ids: string[] } {
  const map = new Map(clip.nodes.map((n) => [n.id, A.newId()]));
  const idx = childIndex(t.data.nodes);
  const dx = t.pos ? Math.round(t.pos.x - clip.at.x) : 28, dy = t.pos ? Math.round(t.pos.y - clip.at.y) : 28;
  const ops: Op[] = [];
  const tops: string[] = [];
  let pos = t.parent ? ((idx.get(t.parent.id) ?? []).at(-1)?.position ?? -1) + 1 : 0;
  for (const n of clip.nodes) {
    const id = map.get(n.id)!;
    const inClip = n.parent_id ? map.has(n.parent_id) : false;
    let row: BoardNode = { ...n, id, updated_at: null, ref_key: null, parent_key: null, style: { ...n.style } };
    if (n.kind === "mind") {
      if (inClip) row.parent_id = map.get(n.parent_id!)!;
      else if (t.parent) {
        row.parent_id = t.parent.id; row.position = pos++;
        const sty = row.style as Record<string, unknown>;
        if (!t.parent.parent_id) { const b = nextBranchOf(idx, t.parent.id, pos - 1); sty.side = b.side; sty.color = n.style.color ?? b.color; } else { delete sty.side; delete sty.color; }
        row.x = 0; row.y = 0; row.frame_id = null;
      } else { row.parent_id = null; row.position = 0; row.x = n.x + dx; row.y = n.y + dy; row.frame_id = n.frame_id && map.has(n.frame_id) ? map.get(n.frame_id)! : null; delete (row.style as Record<string, unknown>).side; }
      if (!inClip) tops.push(id);
    } else {
      row = { ...row, parent_id: null, x: n.x + dx, y: n.y + dy, frame_id: n.frame_id && map.has(n.frame_id) ? map.get(n.frame_id)! : null };
      tops.push(id);
    }
    ops.push({ op: "upsert_node", node: row, base_updated_at: null });
  }
  for (const e of clip.edges) ops.push({ op: "upsert_edge", edge: { ...e, id: A.newId(), from_id: map.get(e.from_id)!, to_id: map.get(e.to_id)!, updated_at: null }, base_updated_at: null });
  return { ops, ids: tops };
}

// ---- outline text -> subtree ----

export interface OutlineNode { text: string; children: OutlineNode[] }

/** Parse an indented list (spaces, tabs, "-", "*", "•", "1.") into a forest. Blank lines are skipped; indentation of 2/4 spaces or a tab is one level. */
export function parseOutline(text: string): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: { level: number; node: OutlineNode }[] = [];
  const raw = text.replace(/\r/g, "").split("\n").filter((l) => l.trim());
  const indents = raw.map((l) => (/^[ \t]*/.exec(l)![0]).replace(/\t/g, "    ").length).filter((n) => n > 0);
  const unit = indents.length ? Math.min(...indents) : 2;
  for (const line of raw) {
    const lead = (/^[ \t]*/.exec(line)![0]).replace(/\t/g, "    ").length;
    const body = line.trim().replace(/^([-*•+]|\d+[.)])\s+/, "").trim();
    if (!body) continue;
    const level = Math.round(lead / (unit || 1));
    const node: OutlineNode = { text: body.slice(0, 4000), children: [] };
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    if (stack.length) stack[stack.length - 1].node.children.push(node); else roots.push(node);
    stack.push({ level, node });
  }
  return roots;
}
export const looksLikeOutline = (text: string) => { const f = parseOutline(text); return f.length > 1 || (f[0]?.children.length ?? 0) > 0; };
export const countOutline = (f: OutlineNode[]): number => f.reduce((a, n) => a + 1 + countOutline(n.children), 0);

/** An outline as new mind nodes: under `parent` (its top lines become children) or, on the board, as a new map at `pos` whose root is the first line. */
export function outlineOps(forest: OutlineNode[], parent: BoardNode | null, pos: { x: number; y: number }, data: BoardData): { ops: Op[]; ids: string[] } {
  const idx = childIndex(data.nodes);
  const ops: Op[] = [];
  const ids: string[] = [];
  let tops = forest;
  let rootRow: BoardNode | null = null;
  if (!parent) {
    const [first, ...rest] = forest;
    rootRow = A.blank("mind", { x: Math.round(pos.x), y: Math.round(pos.y), text: first.text });
    ops.push({ op: "upsert_node", node: rootRow, base_updated_at: null });
    ids.push(rootRow.id);
    tops = [...first.children, ...rest];
  }
  const base = parent ?? rootRow!;
  const baseKids = parent ? (idx.get(parent.id) ?? []) : [];
  const add = (n: OutlineNode, parentRow: BoardNode, position: number, branch: { side: "R" | "L"; color: string } | null) => {
    const style: BoardNode["style"] = branch ? { side: branch.side, color: branch.color } : {};
    const row = A.blank("mind", { parent_id: parentRow.id, position, text: n.text, style });
    ops.push({ op: "upsert_node", node: row, base_updated_at: null });
    if (parentRow.id === base.id) ids.push(row.id);
    n.children.forEach((c, i) => add(c, row, i, null));
  };
  const first0 = (baseKids.at(-1)?.position ?? -1) + 1;
  tops.forEach((n, i) => {
    const atRoot = !base.parent_id;
    add(n, base, first0 + i, atRoot ? nextBranchOf(idx, base.id, first0 + i) : null);
  });
  return { ops, ids };
}
