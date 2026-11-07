import { growth } from "./layout";
import { dirOf, layoutOf, orientOfNode, type NodeMap } from "./tree";
import type { BoardNode } from "./types";

/** Where an arrow key moves the selection in a mind map (port of the mock's nav()). Null = nowhere to go. */
export function navigate(nodes: NodeMap, idx: Map<string | null, BoardNode[]>, id: string, rawKey: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown"): string | null {
  const n = nodes.get(id);
  if (!n) return null;
  // A vertical map reads the other way round: Down/Up walk the generations, Left/Right the siblings.
  const swap = orientOfNode(nodes, id) === "v";
  const key = !swap ? rawKey : ({ ArrowDown: "ArrowRight", ArrowUp: "ArrowLeft", ArrowRight: "ArrowDown", ArrowLeft: "ArrowUp" } as const)[rawKey];
  const kids = (x: BoardNode) => (x.collapsed ? [] : (idx.get(x.id) ?? []).filter((c) => !c.hidden));
  if (key === "ArrowLeft" || key === "ArrowRight") {
    const out = key === "ArrowRight" ? 1 : -1;
    if (!n.parent_id) {
      const lay = layoutOf(nodes, id);
      if (lay !== "both") return out === growth(lay, null) ? (kids(n)[0]?.id ?? null) : null;
      return kids(n).find((c) => (c.style.side ?? "R") === (out > 0 ? "R" : "L"))?.id ?? null;
    }
    return dirOf(nodes, id) === out ? (kids(n)[0]?.id ?? null) : n.parent_id;
  }
  if (!n.parent_id) return null;
  const p = nodes.get(n.parent_id);
  if (!p) return null;
  const sibs = kids(p).filter((c) => p.parent_id || layoutOf(nodes, id) !== "both" || (c.style.side ?? "R") === (n.style.side ?? "R"));
  const i = sibs.findIndex((s) => s.id === id);
  return sibs[key === "ArrowDown" ? i + 1 : i - 1]?.id ?? null;
}
