"use client";

import { allDayItems, CalDay, RingVariant, timedItems } from "@/lib/calendar";
import { fmtDay } from "@/lib/week";
import { ItemHandlers } from "@/components/calendar/item-bits";
import { ItemRing } from "@/components/calendar/ring-lanes";

/** One small ring per day, same colours and lanes as the day ring; a day's name opens its day ring. */
export function WeekRings({ days, variant, colours, h, onOpenDay }: { days: CalDay[]; variant: RingVariant; colours: (iso: string) => string[]; h: ItemHandlers; onOpenDay: (iso: string) => void }) {
  return (
    <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
      {days.map((cd) => (
        <div key={cd.iso} data-ring-day={cd.iso} className={`border px-1.5 pb-2 pt-1.5 text-center ${cd.today ? "border-[var(--accent)] bg-[var(--accent-light)]" : "border-[var(--border)]"}`}>
          <ItemRing cd={cd} variant={variant} colours={colours(cd.iso)} h={h} mini weekday={fmtDay(cd.iso, { weekday: "short" })} label={`24-hour ring, ${fmtDay(cd.iso, { weekday: "long", day: "numeric", month: "long" })}`} />
          <button type="button" data-open-day={cd.iso} onClick={() => onOpenDay(cd.iso)} aria-label={`Open the day ring for ${fmtDay(cd.iso, { weekday: "long", day: "numeric", month: "long" })}`}
            className="mt-1 text-xs text-[var(--muted-foreground)] underline-offset-2 hover:text-[var(--foreground)] hover:underline">
            {fmtDay(cd.iso, { weekday: "short", day: "numeric" })} · {timedItems(cd.items).length} timed · {allDayItems(cd.items).length} all day
          </button>
        </div>
      ))}
    </div>
  );
}
