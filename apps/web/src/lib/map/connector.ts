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
