"use client";

import { memo } from "react";
import { BaseEdge, type EdgeProps } from "@xyflow/react";

/** Parent-to-child bezier in the branch colour; the control points sit halfway across, like the mock. */
export const BranchEdge = memo(function BranchEdge({ sourceX, sourceY, targetX, targetY, data }: EdgeProps) {
  const mx = (sourceX + targetX) / 2;
  const d = `M${sourceX} ${sourceY}C${mx} ${sourceY} ${mx} ${targetY} ${targetX} ${targetY}`;
  return <BaseEdge path={d} style={{ stroke: (data as { color?: string } | undefined)?.color ?? "var(--muted-foreground)", strokeWidth: 1.5, fill: "none" }} />;
});
