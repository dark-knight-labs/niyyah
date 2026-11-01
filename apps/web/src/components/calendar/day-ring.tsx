"use client";

import { CalDay, lanes, RING_INFO, RingVariant, timedItems } from "@/lib/calendar";
import { fmtDay } from "@/lib/week";
import { AllDayStrip, ItemHandlers, Legend } from "@/components/calendar/item-bits";
import { ItemRing } from "@/components/calendar/ring-lanes";

const SWATCH: Record<string, string> = {
  solid: "bg-[var(--foreground)]",
  hatch: "bg-[repeating-linear-gradient(45deg,var(--foreground)_0_2px,var(--surface)_2px_4px)]",
  dots: "bg-[radial-gradient(var(--foreground)_1.1px,transparent_1.4px)] bg-[length:5px_5px]",
  cross: "bg-[repeating-linear-gradient(0deg,var(--foreground)_0_1px,transparent_1px_4px),repeating-linear-gradient(90deg,var(--foreground)_0_1px,transparent_1px_4px)]",
};

/** The day's 24h ring with its items on the inner lanes (variant A, B, C or the Overview's own), then the All day strip and a numbered list. */
export function DayRing({ cd, variant, colours, h }: { cd: CalDay; variant: RingVariant; colours: string[]; h: ItemHandlers }) {
  const l = lanes(timedItems(cd.items));
  return (
    <div>
      <p className="mb-1 max-w-[70ch] text-xs text-[var(--muted-foreground)]"><b className="font-semibold text-[var(--foreground)]">{RING_INFO[variant][0]}.</b> {RING_INFO[variant][1]} All-day items have no place on the ring, so they sit in the strip under it.</p>
      <ItemRing cd={cd} variant={variant} colours={colours} h={h} weekday={fmtDay(cd.iso, { weekday: "short" })} label={`24-hour ring, ${fmtDay(cd.iso, { weekday: "long", day: "numeric", month: "long" })}`} />
      <AllDayStrip cd={cd} h={h} />
      {variant === "C" && l.calendars.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--muted-foreground)]" aria-label="Calendars">
          {l.calendars.map((c) => <span key={c.name} className="inline-flex items-center gap-1.5"><i aria-hidden="true" className={`inline-block h-2.5 w-4 border border-[var(--foreground)] bg-[var(--surface)] ${SWATCH[c.texture]}`} />{c.name}</span>)}
        </div>
      )}
      <Legend cd={cd} h={h} />
    </div>
  );
}
