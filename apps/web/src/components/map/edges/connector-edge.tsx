"use client";

import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, useInternalNode, type EdgeProps, type InternalNode } from "@xyflow/react";

function centre(n: InternalNode) {
  const w = n.measured.width ?? 0, h = n.measured.height ?? 0;
  return { x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, w, h };
}

/** Where the line from the rectangle's centre toward (tx, ty) leaves the rectangle (6px outside, so the arrow does not touch the border). */
function clip(r: { x: number; y: number; w: number; h: number }, tx: number, ty: number): [number, number] {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, dx = tx - cx, dy = ty - cy;
  if (!dx && !dy) return [cx, cy];
  const s = Math.min(Math.abs((r.w / 2 + 6) / (dx || 1e-9)), Math.abs((r.h / 2 + 6) / (dy || 1e-9)));
  return [cx + dx * s, cy + dy * s];
}

/** Dashed arrow between any two objects; it floats to the nearest side of each. */
export const ConnectorEdge = memo(function ConnectorEdge({ id, source, target, markerEnd, selected, data }: EdgeProps) {
  const a = useInternalNode(source), b = useInternalNode(target);
  if (!a || !b) return null;
  const ra = centre(a), rb = centre(b);
  const [x1, y1] = clip(ra, rb.x + rb.w / 2, rb.y + rb.h / 2);
  const [x2, y2] = clip(rb, ra.x + ra.w / 2, ra.y + ra.h / 2);
  const label = (data as { label?: string } | undefined)?.label;
  return (
    <>
      <BaseEdge id={id} path={`M${x1} ${y1}L${x2} ${y2}`} markerEnd={markerEnd} interactionWidth={16} className={`nm-link ${selected ? "sel" : ""}`}
        style={{ stroke: selected ? "var(--accent)" : "var(--muted-foreground)", strokeDasharray: "5 4", strokeWidth: 1.5 }} />
      {label ? <EdgeLabelRenderer><div className="mono nodrag nopan" style={{ position: "absolute", transform: `translate(-50%,-50%) translate(${(x1 + x2) / 2}px,${(y1 + y2) / 2}px)`, background: "var(--surface)", padding: "2px 4px" }}>{label}</div></EdgeLabelRenderer> : null}
    </>
  );
});
