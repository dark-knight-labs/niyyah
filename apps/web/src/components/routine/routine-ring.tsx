"use client";

import { Maximize2 } from "lucide-react";
import { useState } from "react";
import { ROUTINE_BLOCKS, ResolvedDay, formatMinutes } from "@/lib/routine";
import { VaultEvent } from "@/lib/vault-types";
import { duration, formatDuration } from "@/lib/ring";
import { FullScreenClock } from "@/components/routine/fullscreen-clock";
import { RingGraphic, timedEvents } from "@/components/routine/ring-graphic";

export interface RoutineRingProps {
  day: ResolvedDay;
  nowMin: number;
  /** Today's calendar events (owner only); drawn on the ring's inner lane. */
  events?: VaultEvent[];
}

/** The 24h ring with a hover card per block and a button that opens the full-screen clock. */
export function RoutineRing({ day, nowMin, events }: RoutineRingProps) {
  const [hover, setHover] = useState<number | null>(null);
  const [at, setAt] = useState({ x: 0, y: 0 });
  const [full, setFull] = useState(false);
  const [hoverEvent, setHoverEvent] = useState<number | null>(null);
  const block = hover === null ? null : day.blocks[hover];
  const event = hoverEvent === null ? null : timedEvents(events)[hoverEvent];

  return (
    <div className="relative mx-auto w-full max-w-[600px]">
      <button onClick={() => setFull(true)} aria-label="Full screen clock"
        className="absolute right-0 top-0 z-10 flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--border)] bg-[var(--background)] px-3.5 text-[13px] font-semibold hover:bg-[var(--muted)]">
        <Maximize2 size={14} /> Full screen
      </button>
      <svg viewBox="0 0 540 400" className="block h-auto w-full select-none" role="group" aria-label="24-hour routine ring">
        <RingGraphic day={day} nowMin={nowMin} cx={270} cy={200} r={146} t={32} height={400} nameSize={11} clockSize={40}
          hover={hover} onHover={(i, p) => { setHover(i); if (p) setAt(p); }} prayers sideLabels={false} centre="block" idPrefix="ring" events={events}
          hoverEvent={hoverEvent} onHoverEvent={(i, p) => { setHoverEvent(i); if (p) setAt(p); }} />
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

      {event && event.start_min !== null && event.end_min !== null && (
        <div role="tooltip" className="pointer-events-none fixed z-50 w-60 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3.5 py-3 text-[13px] shadow-xl"
          style={{ left: Math.min(at.x + 14, (typeof window === "undefined" ? 9999 : window.innerWidth) - 256), top: at.y + 14 }}>
          <div className="flex items-start gap-2">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: event.color ?? "var(--muted-foreground)" }} />
            <b className="flex-1 break-words text-sm">{event.title}</b>
            <span className="font-bold">{formatDuration(event.end_min - event.start_min)}</span>
          </div>
          <p className="mt-1 tabular-nums text-[var(--muted-foreground)]">{formatMinutes(event.start_min)} – {formatMinutes(event.end_min)}</p>
          <p className="mt-2 border-t border-[var(--border)] pt-2 text-[var(--muted-foreground)]">{event.calendar}{event.location ? ` · ${event.location}` : ""}</p>
        </div>
      )}

      {full && <FullScreenClock day={day} nowMin={nowMin} onClose={() => setFull(false)} events={events} />}
    </div>
  );
}
