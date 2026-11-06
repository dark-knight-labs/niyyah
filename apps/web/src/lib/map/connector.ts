/** Pure geometry for lines on the board: mind branch edges now, free connectors in the same file (W2). */

export type BranchKind = "curved" | "elbow" | "straight";

/** Thickness tapers by depth: 3 -> 2 -> 1.5. */
export const branchWidth = (depth: number) => (depth <= 1 ? 3 : depth === 2 ? 2 : 1.5);

/** Path of a branch edge from (sx,sy) to (tx,ty). `orient` v bends along the vertical axis. Elbow corners are rounded. */
export function branchPath(sx: number, sy: number, tx: number, ty: number, kind: BranchKind, orient: "h" | "v"): string {
  if (kind === "straight") return `M${sx} ${sy}L${tx} ${ty}`;
  if (kind === "elbow") {
    const r = 8;
    if (orient === "h") {
      const mx = (sx + tx) / 2, dy = ty - sy, k = Math.min(r, Math.abs(dy) / 2, Math.abs(mx - sx)), vy = Math.sign(dy), hx = Math.sign(tx - sx);
      if (Math.abs(dy) < 1) return `M${sx} ${sy}L${tx} ${ty}`;
      return `M${sx} ${sy}L${mx - hx * k} ${sy}Q${mx} ${sy} ${mx} ${sy + vy * k}L${mx} ${ty - vy * k}Q${mx} ${ty} ${mx + hx * k} ${ty}L${tx} ${ty}`;
    }
    const my = (sy + ty) / 2, dx = tx - sx, k = Math.min(r, Math.abs(dx) / 2, Math.abs(my - sy)), hx = Math.sign(dx), vy = Math.sign(ty - sy);
    if (Math.abs(dx) < 1) return `M${sx} ${sy}L${tx} ${ty}`;
    return `M${sx} ${sy}L${sx} ${my - vy * k}Q${sx} ${my} ${sx + hx * k} ${my}L${tx - hx * k} ${my}Q${tx} ${my} ${tx} ${my + vy * k}L${tx} ${ty}`;
  }
  if (orient === "h") { const mx = (sx + tx) / 2; return `M${sx} ${sy}C${mx} ${sy} ${mx} ${ty} ${tx} ${ty}`; }
  const my = (sy + ty) / 2;
  return `M${sx} ${sy}C${sx} ${my} ${tx} ${my} ${tx} ${ty}`;
}

// ---- free connectors (W2) ----

export type PortSide = "t" | "r" | "b" | "l";
export type EdgePath = "straight" | "curved" | "elbow";
export type Head = "none" | "arrow" | "open" | "dot" | "diamond" | "bar";
export interface EdgeStyle { path: EdgePath; width: 1 | 2 | 3 | 5; dash: "solid" | "dashed" | "dotted"; start: Head; end: Head; color: string; labelPos: number; sp?: PortSide; tp?: PortSide }
export const EDGE_DEFAULT: EdgeStyle = { path: "curved", width: 2, dash: "solid", start: "none", end: "arrow", color: "ink", labelPos: 0.5 };
export const EDGE_PATHS: EdgePath[] = ["straight", "curved", "elbow"];
export const EDGE_WIDTHS = [1, 2, 3, 5] as const;
export const EDGE_DASHES = ["solid", "dashed", "dotted"] as const;
export const HEADS: Head[] = ["none", "arrow", "open", "dot", "diamond", "bar"];

const oneOf = <T,>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);
/** A stored (free-form) edge style read safely: unknown or missing values fall back to the defaults. Old connectors (no keys) keep their look: dashed, straight. */
export function readEdgeStyle(raw: Record<string, unknown> | undefined): EdgeStyle {
  const r = raw ?? {};
  const legacy = Object.keys(r).length === 0;
  const lp = typeof r.labelPos === "number" && r.labelPos >= 0 && r.labelPos <= 1 ? r.labelPos : 0.5;
  return {
    path: legacy ? "straight" : oneOf(r.path, EDGE_PATHS, EDGE_DEFAULT.path),
    width: oneOf(r.width, EDGE_WIDTHS, legacy ? 2 : EDGE_DEFAULT.width) as EdgeStyle["width"],
    dash: legacy ? "dashed" : oneOf(r.dash, EDGE_DASHES, "solid"),
    start: oneOf(r.start, HEADS, "none"), end: oneOf(r.end, HEADS, "arrow"),
    color: typeof r.color === "string" && r.color ? r.color : "ink", labelPos: lp,
    sp: oneOf(r.sp, ["t", "r", "b", "l"] as const, undefined as unknown as PortSide) || undefined,
    tp: oneOf(r.tp, ["t", "r", "b", "l"] as const, undefined as unknown as PortSide) || undefined,
  };
}

export interface Rect { x: number; y: number; w: number; h: number }
export interface Pt { x: number; y: number }
const OUT: Record<PortSide, Pt> = { t: { x: 0, y: -1 }, r: { x: 1, y: 0 }, b: { x: 0, y: 1 }, l: { x: -1, y: 0 } };

export function anchorPoint(r: Rect, side: PortSide): Pt {
  return side === "t" ? { x: r.x + r.w / 2, y: r.y } : side === "b" ? { x: r.x + r.w / 2, y: r.y + r.h } : side === "l" ? { x: r.x, y: r.y + r.h / 2 } : { x: r.x + r.w, y: r.y + r.h / 2 };
}
/** The side of `a` that faces `b` (dominant axis, scaled by the boxes' sizes). */
export function facingSide(a: Rect, b: Rect): PortSide {
  const dx = (b.x + b.w / 2) - (a.x + a.w / 2), dy = (b.y + b.h / 2) - (a.y + a.h / 2);
  return Math.abs(dx) / (a.w / 2 + b.w / 2 || 1) >= Math.abs(dy) / (a.h / 2 + b.h / 2 || 1) ? (dx >= 0 ? "r" : "l") : dy >= 0 ? "b" : "t";
}
/** Where the line from the rectangle's centre toward (tx, ty) leaves it (gap px outside). */
export function clipToward(r: Rect, tx: number, ty: number, gap = 6): Pt {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, dx = tx - cx, dy = ty - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const s = Math.min(Math.abs((r.w / 2 + gap) / (dx || 1e-9)), Math.abs((r.h / 2 + gap) / (dy || 1e-9)));
  return { x: cx + dx * s, y: cy + dy * s };
}

export interface Geometry { d: string; pts: Pt[]; start: Pt & { angle: number }; end: Pt & { angle: number } }
const ang = (a: Pt, b: Pt) => Math.atan2(b.y - a.y, b.x - a.x);
const bez = (p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt => { const u = 1 - t; return { x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x, y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y }; };

/** Path, polyline (for the label position) and the end tangents of a connector between two rectangles. Unported ends float to the facing side (straight lines to the clipped centre line). */
export function connectorGeometry(a: Rect, b: Rect, st: Pick<EdgeStyle, "path" | "sp" | "tp">): Geometry {
  if (st.path === "straight" && !st.sp && !st.tp) {
    const p1 = clipToward(a, b.x + b.w / 2, b.y + b.h / 2), p2 = clipToward(b, a.x + a.w / 2, a.y + a.h / 2);
    return { d: `M${p1.x} ${p1.y}L${p2.x} ${p2.y}`, pts: [p1, p2], start: { ...p1, angle: ang(p2, p1) }, end: { ...p2, angle: ang(p1, p2) } };
  }
  const s1 = st.sp ?? facingSide(a, b), s2 = st.tp ?? facingSide(b, a);
  const gap = 4;
  const o1 = OUT[s1], o2 = OUT[s2];
  const p1 = anchorPoint(a, s1), p2 = anchorPoint(b, s2);
  p1.x += o1.x * gap; p1.y += o1.y * gap; p2.x += o2.x * gap; p2.y += o2.y * gap;
  if (st.path === "straight") return { d: `M${p1.x} ${p1.y}L${p2.x} ${p2.y}`, pts: [p1, p2], start: { ...p1, angle: ang(p2, p1) }, end: { ...p2, angle: ang(p1, p2) } };
  if (st.path === "curved") {
    const k = Math.max(40, Math.hypot(p2.x - p1.x, p2.y - p1.y) / 2.2);
    const c1 = { x: p1.x + o1.x * k, y: p1.y + o1.y * k }, c2 = { x: p2.x + o2.x * k, y: p2.y + o2.y * k };
    const pts = Array.from({ length: 25 }, (_, i) => bez(p1, c1, c2, p2, i / 24));
    return { d: `M${p1.x} ${p1.y}C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p2.x} ${p2.y}`, pts, start: { ...p1, angle: ang(c1, p1) }, end: { ...p2, angle: ang(c2, p2) } };
  }
  // elbow: leave each end along its outward direction, meet in the middle with right angles
  const e1 = { x: p1.x + o1.x * 18, y: p1.y + o1.y * 18 }, e2 = { x: p2.x + o2.x * 18, y: p2.y + o2.y * 18 };
  const h1 = s1 === "l" || s1 === "r", h2 = s2 === "l" || s2 === "r";
  let mid: Pt[];
  if (h1 && h2) { const mx = (e1.x + e2.x) / 2; mid = [{ x: mx, y: e1.y }, { x: mx, y: e2.y }]; }
  else if (!h1 && !h2) { const my = (e1.y + e2.y) / 2; mid = [{ x: e1.x, y: my }, { x: e2.x, y: my }]; }
  else if (h1) mid = [{ x: e2.x, y: e1.y }];
  else mid = [{ x: e1.x, y: e2.y }];
  const pts = [p1, e1, ...mid, e2, p2];
  return { d: `M${pts.map((p) => `${p.x} ${p.y}`).join("L")}`, pts, start: { ...p1, angle: ang(e1, p1) }, end: { ...p2, angle: ang(e2, p2) } };
}

/** The point `t` (0..1) of the way along a polyline, by length. */
export function pointAlong(pts: Pt[], t: number): Pt {
  if (pts.length === 1) return pts[0];
  const seg: number[] = []; let total = 0;
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); seg.push(l); total += l; }
  let want = Math.min(1, Math.max(0, t)) * total;
  for (let i = 0; i < seg.length; i++) { if (want <= seg[i] || i === seg.length - 1) { const k = seg[i] ? Math.min(1, want / seg[i]) : 0; return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * k, y: pts[i].y + (pts[i + 1].y - pts[i].y) * k }; } want -= seg[i]; }
  return pts[pts.length - 1];
}

/** SVG for an arrowhead whose tip is at (x,y) and which points along `angle` (the way the line arrives). `filled`: fill with the line colour. */
export function headShape(kind: Head, x: number, y: number, angle: number, width: number): { d: string; filled: boolean } | null {
  if (kind === "none") return null;
  const L = 7 + width * 2.2, W = 3.4 + width * 1.3;
  const c = Math.cos(angle), s = Math.sin(angle);
  const at = (back: number, side: number): string => `${(x - c * back - s * side).toFixed(2)} ${(y - s * back + c * side).toFixed(2)}`;
  if (kind === "arrow") return { d: `M${at(0, 0)}L${at(L, W)}L${at(L, -W)}Z`, filled: true };
  if (kind === "open") return { d: `M${at(L, W)}L${at(0, 0)}L${at(L, -W)}`, filled: false };
  if (kind === "diamond") return { d: `M${at(0, 0)}L${at(L / 2, W)}L${at(L, 0)}L${at(L / 2, -W)}Z`, filled: true };
  if (kind === "bar") return { d: `M${at(1, W + 1)}L${at(1, -W - 1)}`, filled: false };
  const r = (W + 1.2), cx = x - c * r, cy = y - s * r;
  return { d: `M${(cx - r).toFixed(2)} ${cy.toFixed(2)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`, filled: true };
}

export const DASH: Record<EdgeStyle["dash"], string | undefined> = { solid: undefined, dashed: "7 5", dotted: "1.5 5" };
