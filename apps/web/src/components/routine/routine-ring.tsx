"use client";

import { Maximize2 } from "lucide-react";
import { useState } from "react";
import { ROUTINE_BLOCKS, ResolvedDay, formatMinutes } from "@/lib/routine";
import { duration, formatDuration } from "@/lib/ring";
import { FullScreenClock } from "@/components/routine/fullscreen-clock";
import { RingGraphic } from "@/components/routine/ring-graphic";

export interface RoutineRingProps {
  day: ResolvedDay;
  nowMin: number;
}

/** The 24h ring with a hover card per block and a button that opens the full-screen clock. */
export function RoutineRing({ day, nowMin }: RoutineRingProps) {
  const [hover, setHover] = useState<number | null>(null);
  const [at, setAt] = useState({ x: 0, y: 0 });
  const [full, setFull] = useState(false);
  const block = hover === null ? null : day.blocks[hover];

  return (
    <div className="relative mx-auto w-full max-w-[560px]">
      <button onClick={() => setFull(true)} aria-label="Full screen clock"
        className="absolute right-0 top-0 z-10 flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--border)] bg-[var(--background)] px-3.5 text-[13px] font-semibold hover:bg-[var(--muted)]">
        <Maximize2 size={14} /> Full screen
      </button>
      <svg viewBox="0 0 540 400" className="block h-auto w-full select-none" role="group" aria-label="24-hour routine ring">
        <RingGraphic day={day} nowMin={nowMin} cx={270} cy={200} r={146} t={32} height={400} nameSize={11} clockSize={40} pop={1.13}
          hover={hover} onHover={(i, p) => { setHover(i); if (p) setAt(p); }} prayers sideLabels={false} idPrefix="ring" />
      </svg>

      {block && (
        <div role="tooltip" className="pointer-events-none fixed z-50 w-56 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3.5 py-3 text-[13px] shadow-xl"
          style={{ left: Math.min(at.x + 14, (typeof window === "undefined" ? 9999 : window.innerWidth) - 240), top: at.y + 14 }}>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: ROUTINE_BLOCKS[block.block].color }} />
            <b className="flex-1 text-sm">{ROUTINE_BLOCKS[block.block].label}</b>
            <span className="font-bold" style={{ color: ROUTINE_BLOCKS[block.block].color }}>{formatDuration(duration(block))}</span>
          </div>
          <p className="mt-1 tabular-nums text-[var(--muted-foreground)]">{formatMinutes(block.startMin)} – {formatMinutes(block.endMin)}</p>
          <p className="mt-2 border-t border-[var(--border)] pt-2">{block.what}</p>
        </div>
      )}

      {full && <FullScreenClock day={day} nowMin={nowMin} onClose={() => setFull(false)} />}
    </div>
  );
}
