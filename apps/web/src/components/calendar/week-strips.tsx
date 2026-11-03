"use client";

import { allDayItems, bookedMin, CalDay, timedItems } from "@/lib/calendar";
import { formatDuration } from "@/lib/ring";
import { fmtDay } from "@/lib/week";
import { ItemHandlers } from "@/components/calendar/item-bits";
import { MiniStrip } from "@/components/calendar/mini-strip";

const COLS = "grid grid-cols-[3.5rem_minmax(0,1fr)_7.5rem] items-center gap-2.5";

/** Seven 24h strips on one axis, to compare days: the schedule band, prayer ticks, items stacked under it; booked time on the right. */
export function WeekStrips({ days, colours, h, onOpenDay }: { days: CalDay[]; colours: (iso: string) => string[]; h: ItemHandlers; onOpenDay: (iso: string) => void }) {
  return (
    <div>
      <div className={`${COLS} mt-1`} aria-hidden="true">
        <span />
        <div className="relative h-3.5">
          {Array.from({ length: 9 }, (_, k) => <span key={k} className="absolute -translate-x-1/2 font-mono text-[9.5px] text-[var(--muted-foreground)]" style={{ left: `${(k / 8) * 100}%` }}>{String((k * 3) % 24).padStart(2, "0")}</span>)}
        </div>
        <span />
      </div>
      {days.map((cd) => (
        <div key={cd.iso} data-strip-day={cd.iso} className={`${COLS} border-t border-[var(--border)] py-1.5 ${cd.today ? "bg-[var(--accent-light)]" : ""}`}>
          <div>
            <button type="button" data-open-day={cd.iso} onClick={() => onOpenDay(cd.iso)} aria-label={`Open ${fmtDay(cd.iso, { weekday: "long", day: "numeric", month: "long" })}`} className={`block text-left font-serif text-[15px] font-medium hover:underline ${cd.today ? "text-[var(--accent)]" : ""}`}>{fmtDay(cd.iso, { weekday: "short", day: "numeric" })}</button>
            <span className="text-[10.5px] text-[var(--muted-foreground)]">{cd.day?.dayType ?? ""}</span>
          </div>
          <MiniStrip cd={cd} colours={colours(cd.iso)} h={h} band={16} bar={12} labels />
          <div className="text-right font-mono text-[11px] text-[var(--muted-foreground)]">
            <b className="block font-medium text-[var(--foreground)]">{formatDuration(bookedMin(cd.items))}</b>
            {timedItems(cd.items).length} timed · {allDayItems(cd.items).length} all day
          </div>
        </div>
      ))}
    </div>
  );
}
