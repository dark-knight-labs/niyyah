import { describe, expect, it } from "vitest";
import { alignOps, distributeOps, fitFrameOps, snapMove, tidyOps, zOps, type Rect } from "./arrange";
import { applyOps, dataFrom } from "./state";
import type { BoardNode } from "./types";

const row = (id: string, o: Partial<BoardNode> = {}): BoardNode => ({
  id, kind: "sticky", parent_id: null, parent_key: null, position: 0, x: 0, y: 0, w: 100, h: 50, text: id, notes: "", style: {}, collapsed: false, hidden: false, ref_key: null, frame_id: null, updated_at: null, ...o,
});
const nodes = [row("a", { x: 0, y: 0 }), row("b", { x: 300, y: 80, w: 60 }), row("c", { x: 90, y: 200, h: 90 }), row("m", { kind: "mind", x: 500, y: 500 })];
const rects = new Map<string, Rect>([["a", { x: 0, y: 0, w: 100, h: 50 }], ["b", { x: 300, y: 80, w: 60, h: 50 }], ["c", { x: 90, y: 200, w: 100, h: 90 }], ["m", { x: 450, y: 480, w: 100, h: 40 }]]);
const data = dataFrom(nodes, []);
const get = (ops: ReturnType<typeof alignOps>, id: string) => applyOps(data, ops).nodes.get(id)!;

describe("align", () => {
  it("left / right / centre / top / bottom / middle", () => {
    expect(["a", "b", "c"].map((i) => get(alignOps(nodes.slice(0, 3), rects, "left"), i).x)).toEqual([0, 0, 0]);
    expect(["a", "b", "c"].map((i) => get(alignOps(nodes.slice(0, 3), rects, "right"), i).x + rects.get(i)!.w)).toEqual([360, 360, 360]);
    expect(get(alignOps(nodes.slice(0, 3), rects, "top"), "b").y).toBe(0);
    expect(get(alignOps(nodes.slice(0, 3), rects, "bottom"), "a").y + 50).toBe(290);
    const mid = ["a", "b", "c"].map((i) => get(alignOps(nodes.slice(0, 3), rects, "middle"), i).y + rects.get(i)!.h / 2); expect(new Set(mid).size).toBe(1);
    const cen = ["a", "b"].map((i) => get(alignOps(nodes.slice(0, 3), rects, "center"), i).x + rects.get(i)!.w / 2); expect(cen[0]).toBeCloseTo(cen[1], 0);
  });
  it("a mind root is moved by its centre", () => {
    const ops = alignOps([nodes[0], nodes[3]], rects, "left");
    expect(get(ops, "m").x).toBe(50);                  // left edge 0 + half of 100
  });
  it("needs two; locked and mind children are left alone", () => {
    expect(alignOps([nodes[0]], rects, "left")).toEqual([]);
    expect(alignOps([row("l", { style: { locked: true }, x: 40 }), nodes[0]], new Map([...rects, ["l", { x: 40, y: 0, w: 100, h: 50 }]]), "left")).toEqual([]);
  });
});

describe("distribute, tidy, z, frame, snap", () => {
  it("distribute makes equal gaps and leaves the outer two", () => {
    const ops = distributeOps(nodes.slice(0, 3), rects, "h"); const r = (i: string) => ({ x: get(ops, i).x, w: rects.get(i)!.w });
    const [a, c, b] = ["a", "c", "b"].map(r);
    expect(a.x).toBe(0); expect(b.x).toBe(300);
    expect(Math.round(c.x - (a.x + a.w))).toBe(Math.round(b.x - (c.x + c.w)));
  });
  it("tidy packs into a grid without overlap", () => {
    const ops = tidyOps(nodes.slice(0, 3), rects); const placed = ["a", "b", "c"].map((i) => ({ ...rects.get(i)!, x: get(ops, i).x, y: get(ops, i).y }));
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) { const p = placed[i], q = placed[j]; expect(p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h).toBe(false); }
  });
  it("z-order: front, back, forward, backward, compact numbering", () => {
    const z = (ops: ReturnType<typeof zOps>) => { const d = applyOps(data, ops); return ["a", "b", "c"].map((i) => d.nodes.get(i)!.style.z ?? 0); };
    expect(z(zOps(nodes, new Set(["a"]), "front"))).toEqual([2, 0, 1]);
    expect(z(zOps(nodes, new Set(["c"]), "back"))).toEqual([1, 2, 0]);
    expect(z(zOps(nodes, new Set(["a"]), "forward"))).toEqual([1, 0, 2]);
    expect(z(zOps(nodes, new Set(["b"]), "backward"))).toEqual([1, 0, 2]);
    expect(zOps(nodes, new Set(["c"]), "front")).toEqual([]);          // already in front: no write
  });
  it("fit frame wraps members with padding", () => {
    const [op] = fitFrameOps(row("f", { kind: "frame" }), [{ x: 10, y: 20, w: 100, h: 50 }, { x: 200, y: 100, w: 50, h: 50 }]);
    expect(op.op === "upsert_node" && [op.node.x, op.node.y, op.node.w, op.node.h]).toEqual([-22, -24, 304, 206]);
  });
  it("snap pulls an edge to a nearby one and reports the guide, ignores far ones", () => {
    const s = snapMove({ x: 103, y: 300, w: 80, h: 40 }, [{ x: 0, y: 0, w: 100, h: 50 }], 6);
    expect(s.dx).toBe(-3); expect(s.vx).toContain(100); expect(s.dy).toBe(0);
    expect(snapMove({ x: 140, y: 300, w: 80, h: 40 }, [{ x: 0, y: 0, w: 100, h: 50 }], 6)).toMatchObject({ dx: 0, dy: 0, vx: [], hy: [] });
    const c = snapMove({ x: 0, y: 57, w: 100, h: 40 }, [{ x: 0, y: 0, w: 100, h: 50 }], 8);
    expect(c.dy).toBe(-7); expect(c.hy).toContain(50);
  });
});
