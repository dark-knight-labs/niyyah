import { describe, expect, it } from "vitest";
import { branchHandles, growth, LAYOUTS, layoutMindMap, type Layout, type MindTree, type Placed, type Size } from "./layout";

/** A root with 3 branches (sides alternate), the first with 3 children (one with 2 grandchildren), the second with 2, the third a leaf. */
function tree(): { roots: MindTree[]; sizes: Map<string, Size> } {
  const sizes = new Map<string, Size>();
  const mk = (id: string, w: number, h: number, children: MindTree[] = [], extra: Partial<MindTree> = {}): MindTree => { sizes.set(id, { w, h }); return { id, children, ...extra }; };
  const roots = [mk("r", 160, 48, [
    mk("a", 110, 34, [mk("a1", 90, 28), mk("a2", 140, 28, [mk("a2x", 80, 28), mk("a2y", 100, 40)]), mk("a3", 70, 28)], { side: "R" }),
    mk("b", 120, 34, [mk("b1", 100, 28), mk("b2", 100, 60)], { side: "L" }),
    mk("c", 100, 34, [], { side: "R" }),
  ], { cx: 200, cy: 100 })];
  return { roots, sizes };
}
const withLayout = (layout: Layout) => { const t = tree(); t.roots[0].layout = layout; return t; };
const overlap = (p: Placed, q: Placed) => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;

describe("layoutMindMap", () => {
  for (const layout of LAYOUTS) {
    it(`${layout}: no two boxes overlap and the result is deterministic`, () => {
      const { roots, sizes } = withLayout(layout);
      const a = layoutMindMap(roots, sizes);
      const b = layoutMindMap(roots, sizes);
      expect([...a.entries()]).toEqual([...b.entries()]);
      expect(a.size).toBe(11);
      const all = [...a.values()];
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(overlap(all[i], all[j]), `${i} vs ${j}`).toBe(false);
    });
  }

  it("right grows to the right of the root, left to the left, down below, up above", () => {
    const rootOf = (l: Layout) => { const t = withLayout(l); const p = layoutMindMap(t.roots, t.sizes); return { p, r: p.get("r")! }; };
    { const { p, r } = rootOf("right"); for (const id of ["a", "b", "c", "a1", "a2x"]) expect(p.get(id)!.x).toBeGreaterThanOrEqual(r.x + r.w); }
    { const { p, r } = rootOf("left"); for (const id of ["a", "b", "c", "a1", "a2x"]) expect(p.get(id)!.x + p.get(id)!.w).toBeLessThanOrEqual(r.x); }
    { const { p, r } = rootOf("down"); for (const id of ["a", "b", "c", "a1", "a2x"]) expect(p.get(id)!.y).toBeGreaterThanOrEqual(r.y + r.h); }
    { const { p, r } = rootOf("up"); for (const id of ["a", "b", "c", "a1", "a2x"]) expect(p.get(id)!.y + p.get(id)!.h).toBeLessThanOrEqual(r.y); }
  });

  it("both splits first-level branches by their side", () => {
    const t = withLayout("both"); const p = layoutMindMap(t.roots, t.sizes); const r = p.get("r")!;
    expect(p.get("a")!.x).toBeGreaterThan(r.x); expect(p.get("c")!.x).toBeGreaterThan(r.x); expect(p.get("b")!.x + p.get("b")!.w).toBeLessThan(r.x + 1);
    expect(p.get("b1")!.x + p.get("b1")!.w).toBeLessThan(p.get("b")!.x);
  });

  it("the root stays centred on its cx/cy and vertical maps centre children on the parent", () => {
    const t = withLayout("down"); const p = layoutMindMap(t.roots, t.sizes); const r = p.get("r")!;
    expect(r.x + r.w / 2).toBe(200); expect(r.y + r.h / 2).toBe(100);
    const one = layoutMindMap([{ id: "r", cx: 200, cy: 100, layout: "down", children: [{ id: "k", children: [] }] }], new Map([["r", { w: 160, h: 48 }], ["k", { w: 90, h: 28 }]]));
    expect(one.get("k")!.x + 45).toBeCloseTo(200, 5);
    expect(p.get("a")!.orient).toBe("v");
  });

  it("two roots do not influence each other and each keeps its own layout", () => {
    const t = tree(); const second: MindTree = { id: "r2", cx: 1500, cy: 100, layout: "down", children: [{ id: "k", children: [] }] };
    t.sizes.set("r2", { w: 100, h: 40 }); t.sizes.set("k", { w: 60, h: 30 });
    const p = layoutMindMap([...t.roots, second], t.sizes);
    expect(p.get("r2")!.orient).toBe("v"); expect(p.get("a")!.orient).toBe("h"); expect(p.get("k")!.y).toBeGreaterThan(p.get("r2")!.y);
  });

  it("falls back to a default size for an unmeasured node", () => {
    const p = layoutMindMap([{ id: "x", cx: 0, cy: 0, children: [{ id: "y", children: [] }] }], new Map());
    expect(p.get("y")!.w).toBeGreaterThan(0);
  });
});

describe("growth and handles", () => {
  it("maps layout and side to a direction and to edge handles", () => {
    expect(growth("both", "L")).toBe(-1); expect(growth("both", "R")).toBe(1); expect(growth("left", "R")).toBe(-1); expect(growth("up", null)).toBe(-1); expect(growth("down", "L")).toBe(1);
    expect(branchHandles(1, "h")).toEqual({ source: "sr", target: "tl" });
    expect(branchHandles(-1, "v")).toEqual({ source: "st", target: "tb" });
  });
});
