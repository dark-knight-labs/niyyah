"use client";

import { memo } from "react";
import { BaseEdge, type EdgeProps } from "@xyflow/react";
import { branchPath, branchWidth } from "@/lib/map/connector";

/** Parent-to-child line in the branch colour. The map's `edge` style picks curved, elbow or straight; thickness tapers with depth. */
export const BranchEdge = memo(function BranchEdge({ sourceX, sourceY, targetX, targetY, data }: EdgeProps) {
  const d = (data ?? {}) as { color?: string; kind?: string; depth?: number; orient?: "h" | "v" };
  const path = branchPath(sourceX, sourceY, targetX, targetY, (d.kind as "curved") ?? "curved", d.orient ?? "h");
  return <BaseEdge path={path} style={{ stroke: d.color ?? "var(--muted-foreground)", strokeWidth: branchWidth(d.depth ?? 1), fill: "none", strokeLinecap: "round", strokeLinejoin: "round" }} />;
});
