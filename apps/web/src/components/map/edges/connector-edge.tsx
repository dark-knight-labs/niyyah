"use client";

import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, useInternalNode, type EdgeProps, type InternalNode } from "@xyflow/react";
import { connectorGeometry, DASH, headShape, pointAlong, readEdgeStyle } from "@/lib/map/connector";

function rectOf(n: InternalNode) {
  return { x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, w: n.measured.width ?? 0, h: n.measured.height ?? 0 };
}
export const edgeColor = (key: string) => (key === "ink" ? "var(--muted-foreground)" : `var(--stream-${key})`);

/** A connector between any two objects: straight, curved or elbow, 1/2/3/5 px, solid, dashed or dotted, an arrowhead at each end, a colour, a label that can sit anywhere along it. */
export const ConnectorEdge = memo(function ConnectorEdge({ id, source, target, selected, data }: EdgeProps) {
  const a = useInternalNode(source), b = useInternalNode(target);
  if (!a || !b) return null;
  const d = (data ?? {}) as { label?: string; style?: Record<string, unknown> };
  const st = readEdgeStyle(d.style);
  const g = connectorGeometry(rectOf(a), rectOf(b), st);
  const color = selected ? "var(--accent)" : edgeColor(st.color);
  const sHead = headShape(st.start, g.start.x, g.start.y, g.start.angle, st.width);
  const eHead = headShape(st.end, g.end.x, g.end.y, g.end.angle, st.width);
  const mid = pointAlong(g.pts, st.labelPos);
  const head = (h: NonNullable<ReturnType<typeof headShape>>, k: string) => (
    <path key={k} d={h.d} fill={h.filled ? color : "none"} stroke={color} strokeWidth={st.width <= 2 ? 1.5 : 2} strokeLinejoin="round" strokeLinecap="round" />
  );
  return (
    <>
      <BaseEdge id={id} path={g.d} interactionWidth={18} className={`nm-link ${selected ? "sel" : ""}`}
        style={{ stroke: color, strokeWidth: st.width, strokeDasharray: DASH[st.dash] ?? "none", strokeLinecap: st.dash === "dotted" ? "round" : "butt", fill: "none" }} />
      {sHead && head(sHead, "s")}{eHead && head(eHead, "e")}
      {d.label ? <EdgeLabelRenderer><div className="mono nodrag nopan nm-elabel" style={{ position: "absolute", transform: `translate(-50%,-50%) translate(${mid.x}px,${mid.y}px)`, background: "var(--surface)", padding: "2px 4px" }}>{d.label}</div></EdgeLabelRenderer> : null}
    </>
  );
});
