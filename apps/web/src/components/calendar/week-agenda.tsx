"use client";

import { allDayItems, CalDay, timedItems } from "@/lib/calendar";
import { itemRef } from "@/lib/items";
import { fmtDay } from "@/lib/week";
import { ItemHandlers, ItemRow, MICRO } from "@/components/calendar/item-bits";
import { MiniStrip } from "@/components/calendar/mini-strip";

/** One section per day: a 24h mini strip over a plain list, all-day items first. */
export function WeekAgenda({ days, colours, h }: { days: CalDay[]; colours: (iso: string) => string[]; h: ItemHandlers }) {
  return (
    <div>
      {days.map((cd) => {
        const timed = timedItems(cd.items);
        const allDay = allDayItems(cd.items);
        return (
          <section key={cd.iso} aria-label={fmtDay(cd.iso, { weekday: "long", day: "numeric", month: "long" })} data-agenda-day={cd.iso} className="border-t border-[var(--border)] py-2.5">
            <div className="flex flex-wrap items-baseline gap-x-2.5">
              <h3 className={`font-serif text-[17px] font-medium ${cd.today ? "text-[var(--accent)]" : ""}`}>{fmtDay(cd.iso, { weekday: "short", day: "numeric" })}</h3>
              {cd.today && <span className={`bg-[var(--accent-light)] px-1.5 ${MICRO} !text-[var(--accent)]`}>today</span>}
              <span className="ml-auto text-xs text-[var(--muted-foreground)]">{timed.length} timed · {allDay.length} all day{cd.day?.dayType === "weekend" ? " · weekend schedule" : ""}</span>
            </div>
            <MiniStrip cd={cd} colours={colours(cd.iso)} h={h} />
            {allDay.map((i) => <ItemRow key={itemRef(i)} item={i} cd={cd} h={h} />)}
            {timed.map((i, n) => <ItemRow key={itemRef(i)} item={i} cd={cd} h={h} n={n + 1} />)}
            {!cd.items.length && <p className="text-xs text-[var(--muted-foreground)]">Nothing on this day.</p>}
          </section>
        );
      })}
    </div>
  );
}
