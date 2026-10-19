"use client";

import { useBlocks } from "@/lib/blocks";
import { Maximize2, Minimize2 } from "lucide-react";
import { useState } from "react";
import { ResolvedDay, formatMinutes } from "@/lib/routine";
import { VaultEvent } from "@/lib/vault-types";
import { duration, formatDuration } from "@/lib/ring";
import { RingGraphic, timedEvents } from "@/components/routine/ring-graphic";

export interface RoutineRingProps {
  day: ResolvedDay;
  nowMin: number;
  /** Today's calendar events (owner only); drawn on the ring's inner lane. */
  events?: VaultEvent[];
  /** The clock fills the page's columns (the calendar steps aside); the button toggles it. */
  expanded?: boolean;
  onToggleExpand?: () => void;
}

/** The 24h ring with a hover card per block and a button that expands it over the calendar's column. */
export function RoutineRing({ day, nowMin, events, expanded = false, onToggleExpand }: RoutineRingProps) {
  const blocks = useBlocks();
  const [hover, setHover] = useState<number | null>(null);
  const [at, setAt] = useState({ x: 0, y: 0 });
  const [hoverEvent, setHoverEvent] = useState<number | null>(null);
  const block = hover === null ? null : day.blocks[hover];
  const event = hoverEvent === null ? null : timedEvents(events)[hoverEvent];

  return (
    <div className={`relative mx-auto w-full ${expanded ? "max-w-[min(100%,calc((100vh-9rem)*1.019))]" : "max-w-[30rem]"}`}>
      {onToggleExpand && (
        <button type="button" onClick={onToggleExpand} aria-pressed={expanded} aria-label={expanded ? "Shrink clock" : "Expand clock over the calendar"} title={expanded ? "Shrink" : "Expand"}
          className="absolute right-0 top-0 z-10 grid h-8 w-8 place-items-center border border-[var(--border)] bg-[var(--surface)] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]">
          {expanded ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}
        </button>
      )}
      <svg viewBox="110 14 420 412" className="block h-auto w-full select-none" role="group" aria-label="24-hour routine ring">
        <RingGraphic day={day} nowMin={nowMin} cx={320} cy={220} r={148} t={36} height={440} nameSize={16} clockSize={60} labelSize={16}
          hover={hover} onHover={(i, p) => { setHover(i); if (p) setAt(p); }} prayers sideLabels={false} centre="block" idPrefix="ring" events={events}
          hoverEvent={hoverEvent} onHoverEvent={(i, p) => { setHoverEvent(i); if (p) setAt(p); }} />
      </svg>

      {block && (
        <div role="tooltip" className="pointer-events-none fixed z-50 w-56 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3.5 py-3 text-[0.8125rem] shadow-xl"
          style={{ left: Math.min(at.x + 14, (typeof window === "undefined" ? 9999 : window.innerWidth) - 240), top: at.y + 14 }}>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2" style={{ background: blocks.color(block.block) }} />
            <b className="flex-1 text-sm">{blocks.label(block.block)}</b>
            <span className="font-bold" style={{ color: blocks.color(block.block) }}>{formatDuration(duration(block))}</span>
          </div>
          <p className="mt-1 tabular-nums text-[var(--muted-foreground)]">{formatMinutes(block.startMin)} – {formatMinutes(block.endMin)}</p>
          <p className="mt-2 border-t border-[var(--border)] pt-2">{block.what}</p>
        </div>
      )}

      {event && event.start_min !== null && event.end_min !== null && (
        <div role="tooltip" className="pointer-events-none fixed z-50 w-60 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3.5 py-3 text-[0.8125rem] shadow-xl"
          style={{ left: Math.min(at.x + 14, (typeof window === "undefined" ? 9999 : window.innerWidth) - 256), top: at.y + 14 }}>
          <div className="flex items-start gap-2">
            <span className="mt-1.5 h-2 w-2 shrink-0" style={{ background: event.color ?? "var(--muted-foreground)" }} />
            <b className="flex-1 break-words text-sm">{event.title}</b>
            <span className="font-bold">{formatDuration(event.end_min - event.start_min)}</span>
          </div>
          <p className="mt-1 tabular-nums text-[var(--muted-foreground)]">{formatMinutes(event.start_min)} – {formatMinutes(event.end_min)}</p>
          <p className="mt-2 border-t border-[var(--border)] pt-2 text-[var(--muted-foreground)]">{event.calendar}{event.location ? ` · ${event.location}` : ""}</p>
        </div>
      )}

    </div>
  );
}
