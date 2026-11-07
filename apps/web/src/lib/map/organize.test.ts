import { describe, expect, it } from "vitest";
import { layoutMindMap, type Size } from "./layout";
import { organizeOps, mapsOf, balancedSides } from "./organize";
import { applyOps, dataFrom } from "./state";
import { childIndex, visibleForest } from "./tree";
import type { BoardNode } from "./types";

const row = (id: string, o: Partial<BoardNode> = {}): BoardNode => ({
  id, kind: "mind", parent_id: null, parent_key: null, position: 0, x: 0, y: 0, w: 0, h: 0, text: id, notes: "", style: {}, collapsed: false, hidden: false, ref_key: null, frame_id: null, updated_at: null, ...o,
});

function board() {
  const nodes = [
    row("r1", { x: 0, y: 0 }), row("a", { parent_id: "r1", position: 0, style: { side: "R" } }), row("b", { parent_id: "r1", position: 1, style: { side: "R" } }), row("c", { parent_id: "r1", position: 2, style: { side: "R" } }),
    row("a1", { parent_id: "a" }), row("a2", { parent_id: "a", position: 1 }), row("a3", { parent_id: "a", position: 2 }),
    row("r2", { x: 150, y: 20 }), row("k1", { parent_id: "r2", style: { side: "R" } }), row("k2", { parent_id: "r2", position: 1, style: { side: "L" } }),
  ];
  const data = dataFrom(nodes, []);
  const sizes = new Map<string, Size>(nodes.map((n) => [n.id, { w: 110, h: 34 }]));
  return { data, idx: childIndex(data.nodes), sizes };
}
function rectsAfter(b: ReturnType<typeof board>, ops: ReturnType<typeof organizeOps>) {
  const data = applyOps(b.data, ops); const idx = childIndex(data.nodes);
  const placed = layoutMindMap(visibleForest(data.nodes, idx), b.sizes);
  const byRoot = new Map<string, { x0: number; y0: number; x1: number; y1: number }>();
  for (const root of ["r1", "r2"]) {
    const ids = new Set<string>(); const walk = (id: string) => { ids.add(id); for (const c of idx.get(id) ?? []) walk(c.id); }; walk(root);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of ids) { const p = placed.get(id)!; x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + p.w); y1 = Math.max(y1, p.y + p.h); }
    byRoot.set(root, { x0, y0, x1, y1 });
  }
  return { byRoot, data };
}

describe("organizeOps", () => {
  it("sets the layout on every root asked and returns one batch", () => {
    const b = board();
    const ops = organizeOps(b.data, b.idx, ["r1", "r2"], "down", b.sizes);
    const { data } = rectsAfter(b, ops);
    expect(data.nodes.get("r1")!.style.layout).toBe("down"); expect(data.nodes.get("r2")!.style.layout).toBe("down");
  });

  for (const layout of ["both", "right", "down", "up"] as const) {
    it(`${layout}: maps that overlapped no longer overlap`, () => {
      const b = board();
      const { byRoot } = rectsAfter(b, organizeOps(b.data, b.idx, ["r1", "r2"], layout, b.sizes));
      const a = byRoot.get("r1")!, c = byRoot.get("r2")!;
      expect(a.x0 < c.x1 && c.x0 < a.x1 && a.y0 < c.y1 && c.y0 < a.y1, JSON.stringify([a, c])).toBe(false);
    });
  }

  it("is idempotent: organizing an organized board changes nothing", () => {
    const b = board();
    const first = applyOps(b.data, organizeOps(b.data, b.idx, ["r1", "r2"], "right", b.sizes));
    const again = organizeOps(first, childIndex(first.nodes), ["r1", "r2"], "right", b.sizes);
    expect(again).toEqual([]);
  });

  it("a map moves off a free item rather than covering it", () => {
    const b = board();
    const obstacle = { x: -60, y: -20, w: 170, h: 130 };
    const ops = organizeOps(b.data, b.idx, ["r1"], "right", b.sizes, [obstacle]);
    const r1 = applyOps(b.data, ops).nodes.get("r1")!;
    expect(r1.x !== 0 || r1.y !== 0).toBe(true);
  });

  it("balanced sides split by subtree weight", () => {
    const b = board();
    const kids = b.idx.get("r1")!;
    const sides = balancedSides(kids, b.idx);
    expect([...sides.values()].filter((s) => s === "R").length).toBeGreaterThanOrEqual(1);
    expect([...sides.values()].filter((s) => s === "L").length).toBeGreaterThanOrEqual(1);
    expect(sides.get("a")).toBe("R");                     // the heavy branch goes first, the lighter ones fill the other side
    expect(sides.get("b")).toBe("L");
  });

  it("mapsOf: the selection's maps, else every root", () => {
    const b = board();
    expect(mapsOf(b.data, b.idx, ["a1"])).toEqual(["r1"]);
    expect(mapsOf(b.data, b.idx, []).sort()).toEqual(["r1", "r2"]);
  });
});
