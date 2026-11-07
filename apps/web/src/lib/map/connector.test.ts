import { describe, expect, it } from "vitest";
import { anchorPoint, branchPath, connectorGeometry, facingSide, headShape, pointAlong, readEdgeStyle } from "./connector";

const A = { x: 0, y: 0, w: 100, h: 40 }, B = { x: 300, y: 100, w: 100, h: 40 };

describe("connector geometry", () => {
  it("straight, unported ends float to the facing sides and stay off the box", () => {
    const g = connectorGeometry(A, B, { path: "straight" });
    expect(g.pts).toHaveLength(2);
    expect(g.pts[0].x).toBeGreaterThan(100 - 1); expect(g.pts[1].x).toBeLessThan(300 + 1);
  });
  it("ports pin the ends to the chosen sides", () => {
    const g = connectorGeometry(A, B, { path: "straight", sp: "b", tp: "t" });
    expect(g.pts[0].x).toBeCloseTo(50, 5); expect(g.pts[0].y).toBeGreaterThan(40); expect(g.pts[1].x).toBeCloseTo(350, 5); expect(g.pts[1].y).toBeLessThan(100);
  });
  it("curved leaves a right port to the right and arrives at a left port from the left", () => {
    const g = connectorGeometry(A, B, { path: "curved", sp: "r", tp: "l" });
    expect(g.d.startsWith("M104 20C")).toBe(true);
    expect(Math.cos(g.end.angle)).toBeGreaterThan(0.9);          // travelling right when it arrives
    expect(g.pts).toHaveLength(25);
  });
  it("elbow only has horizontal and vertical segments", () => {
    for (const [sp, tp] of [["r", "l"], ["b", "t"], ["r", "t"], ["b", "l"]] as const) {
      const g = connectorGeometry(A, B, { path: "elbow", sp, tp });
      for (let i = 1; i < g.pts.length; i++) expect(Math.abs(g.pts[i].x - g.pts[i - 1].x) < 1e-6 || Math.abs(g.pts[i].y - g.pts[i - 1].y) < 1e-6, `${sp}${tp} seg ${i}`).toBe(true);
    }
  });
  it("facingSide picks the dominant axis", () => {
    expect(facingSide(A, B)).toBe("r"); expect(facingSide(B, A)).toBe("l");
    expect(facingSide({ x: 0, y: 0, w: 100, h: 40 }, { x: 10, y: 400, w: 100, h: 40 })).toBe("b");
  });
  it("pointAlong walks the polyline by length", () => {
    const p = pointAlong([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 0.75);
    expect(p.x).toBeCloseTo(10, 5); expect(p.y).toBeCloseTo(5, 5);
    expect(pointAlong([{ x: 0, y: 0 }, { x: 10, y: 0 }], 0)).toEqual({ x: 0, y: 0 });
  });
  it("anchor points are side midpoints", () => { expect(anchorPoint(A, "t")).toEqual({ x: 50, y: 0 }); expect(anchorPoint(A, "l")).toEqual({ x: 0, y: 20 }); });
});

describe("edge style", () => {
  it("an old connector (no style) keeps its look, a new one gets the defaults, junk falls back", () => {
    expect(readEdgeStyle({})).toMatchObject({ path: "straight", dash: "dashed", width: 2, end: "arrow" });
    expect(readEdgeStyle({ path: "elbow", width: 5, dash: "dotted", start: "dot", end: "bar", color: "rose", labelPos: 0.2 })).toMatchObject({ path: "elbow", width: 5, dash: "dotted", start: "dot", end: "bar", color: "rose", labelPos: 0.2 });
    expect(readEdgeStyle({ path: "zigzag", width: 9, end: "x", labelPos: 7 })).toMatchObject({ path: "curved", width: 2, end: "arrow", labelPos: 0.5 });
  });
});

describe("heads and branch lines", () => {
  it("every head but none draws something", () => {
    expect(headShape("none", 0, 0, 0, 2)).toBeNull();
    for (const k of ["arrow", "open", "dot", "diamond", "bar"] as const) expect(headShape(k, 10, 10, 0.5, 2)!.d.length).toBeGreaterThan(5);
    expect(headShape("arrow", 10, 10, 0, 2)!.filled).toBe(true); expect(headShape("open", 10, 10, 0, 2)!.filled).toBe(false);
  });
  it("branch paths: curved and elbow start and end where asked", () => {
    expect(branchPath(0, 0, 100, 50, "straight", "h")).toBe("M0 0L100 50");
    expect(branchPath(0, 0, 100, 50, "curved", "h").startsWith("M0 0C")).toBe(true);
    const e = branchPath(0, 0, 100, 50, "elbow", "h"); expect(e.startsWith("M0 0")).toBe(true); expect(e.endsWith("100 50")).toBe(true);
    const v = branchPath(0, 0, 50, 100, "elbow", "v"); expect(v.endsWith("50 100")).toBe(true);
  });
});
