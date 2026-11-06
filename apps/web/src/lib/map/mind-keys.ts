import { dirOf, type NodeMap } from "./tree";
import type { BoardNode } from "./types";

/** Where an arrow key moves the selection in a mind map (port of the mock's nav()). Null = nowhere to go. */
export function navigate(nodes: NodeMap, idx: Map<string | null, BoardNode[]>, id: string, key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown"): string | null {
  const n = nodes.get(id);
  if (!n) return null;
  const kids = (x: BoardNode) => (x.collapsed ? [] : (idx.get(x.id) ?? []).filter((c) => !c.hidden));
  if (key === "ArrowLeft" || key === "ArrowRight") {
    const out = key === "ArrowRight" ? 1 : -1;
    if (!n.parent_id) return kids(n).find((c) => (c.style.side ?? "R") === (out > 0 ? "R" : "L"))?.id ?? null;
    return dirOf(nodes, id) === out ? (kids(n)[0]?.id ?? null) : n.parent_id;
  }
  if (!n.parent_id) return null;
  const p = nodes.get(n.parent_id);
  if (!p) return null;
  const sibs = kids(p).filter((c) => p.parent_id || (c.style.side ?? "R") === (n.style.side ?? "R"));
  const i = sibs.findIndex((s) => s.id === id);
  return sibs[key === "ArrowDown" ? i + 1 : i - 1]?.id ?? null;
}
