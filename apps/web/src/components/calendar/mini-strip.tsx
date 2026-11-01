"use client";

import { useBlocks } from "@/lib/blocks";
import { CalDay, itemState, lanes, pieces, prayerMarks, STATE_CLASS, timedItems } from "@/lib/calendar";
import { itemRef } from "@/lib/items";
import { formatMinutes } from "@/lib/routine";
import { ItemHandlers, itemAttrs, labelOf } from "@/components/calendar/item-bits";

const pct = (m: number) => `${(m / 1440) * 100}%`;

/** A day as one 24h strip: the schedule as a coloured band, prayers as ticks, timed items as ink bars stacked under it. */
export function MiniStrip({ cd, colours, h, band = 12, bar = 9, labels = false }: { cd: CalDay; colours: string[]; h: ItemHandlers; band?: number; bar?: number; labels?: boolean }) {
  const blocks = useBlocks();
  const timed = timedItems(cd.items);
  const l = lanes(timed);
  const prayers = cd.day ? prayerMarks(cd.day, cd.nowMin) : [];
  return (
    <div className="relative my-1.5" style={{ height: band + 6 + l.count * (bar + 2) }}>
      {[3, 6, 9, 12, 15, 18, 21].map((hr) => <i key={hr} aria-hidden="true" className="pointer-events-none absolute inset-y-0 z-[1] border-l border-[color-mix(in_srgb,var(--foreground)_10%,transparent)]" style={{ left: pct(hr * 60) }} />)}
      {cd.day && pieces(cd.day.blocks).map(({ index, block, from, to }) => (
        <div key={`${index}-${from}`} title={`${blocks.label(block.block)} ${formatMinutes(block.startMin)}–${formatMinutes(block.endMin)}`} className="absolute top-0 border-r-[1.5px] border-[var(--surface)]"
          style={{ left: pct(from), width: pct(to - from), height: band, background: colours[index] }} />
      ))}
      {prayers.map((p) => (
        <div key={p.name} title={`${p.label} ${formatMinutes(p.min)}`} className={`absolute z-[3] w-0 border-l-[1.5px] ${p.next ? "border-[var(--accent)]" : "border-[var(--foreground)]"}`} style={{ left: pct(p.min), top: -2, height: band + 4 }}>
          <span aria-hidden="true" className={`absolute -left-1 -top-1 h-1.5 w-1.5 rotate-45 ${p.next ? "bg-[var(--accent)]" : "bg-[var(--foreground)]"}`} />
        </div>
      ))}
      {timed.map((i) => {
        const ref = itemRef(i);
        const w = (i.end_min as number) - (i.start_min as number);
        return (
          <button key={ref} type="button" {...itemAttrs(i, h)} onClick={() => h.onPick(i)} aria-pressed={h.picked === ref} aria-label={`Details: ${labelOf(i)}`}
            className={`absolute z-[2] overflow-hidden whitespace-nowrap bg-[var(--foreground)] px-0.5 text-left text-[10px] text-[var(--background)] ${STATE_CLASS[itemState(i, cd)]} ${h.picked === ref ? "outline outline-2 outline-[var(--accent)]" : ""}`}
            style={{ left: pct(i.start_min as number), width: `max(4px, ${pct(w)})`, top: band + 4 + l.lane.get(ref)!.lane * (bar + 2), height: bar, lineHeight: `${bar}px` }}>
            {labels && w >= 75 && <span data-title="">{i.title}</span>}
          </button>
        );
      })}
      {cd.nowMin !== null && (
        <>
          <div aria-hidden="true" className="pointer-events-none absolute -inset-y-[3px] z-[6] border-l-2 border-[var(--accent)]" style={{ left: pct(cd.nowMin) }} />
          <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 z-[4] bg-[color-mix(in_srgb,var(--surface)_55%,transparent)]" style={{ width: pct(cd.nowMin) }} />
        </>
      )}
      {cd.past && <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-[4] bg-[color-mix(in_srgb,var(--surface)_55%,transparent)]" />}
    </div>
  );
}
