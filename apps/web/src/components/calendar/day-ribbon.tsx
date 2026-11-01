"use client";

import { useEffect, useRef } from "react";
import { useBlocks } from "@/lib/blocks";
import { CalDay, itemState, lanes, pieces, prayerMarks, STATE_CLASS, timedItems } from "@/lib/calendar";
import { itemRef } from "@/lib/items";
import { formatMinutes } from "@/lib/routine";
import { AllDayStrip, ItemHandlers, itemAttrs, labelOf, Legend } from "@/components/calendar/item-bits";

/** One pixel per minute, after the sticky row labels. */
const OFF = 84;
const ROW = { blocks: 24, prayers: 76, items: 126 };
const LANE = 26;

/** The 24-hour ring unrolled: blocks, prayers and timed items on one axis, overlaps stacked. Scrolls sideways inside its own box. */
export function DayRibbon({ cd, colours, h }: { cd: CalDay; colours: string[]; h: ItemHandlers }) {
  const blocks = useBlocks();
  const box = useRef<HTMLDivElement>(null);
  const timed = timedItems(cd.items);
  const l = lanes(timed);
  const n = new Map(timed.map((i, k) => [itemRef(i), k + 1]));
  const prayers = cd.day ? prayerMarks(cd.day, cd.nowMin) : [];
  const height = ROW.items + l.count * LANE + 4;
  const focus = cd.nowMin ?? timed[0]?.start_min ?? 8 * 60;

  useEffect(() => {
    if (box.current) box.current.scrollLeft = Math.max(0, focus - 300);
  }, [cd.iso, focus]);

  const veil = cd.past ? 1440 : cd.nowMin ?? 0;
  return (
    <div>
      <AllDayStrip cd={cd} h={h} />
      <div ref={box} className="mt-1.5 overflow-x-auto border-t border-[var(--border)]" role="group" aria-label="Day ribbon">
        <div className="relative pb-1.5" style={{ width: OFF + 1440 + 16, height }}>
          {Array.from({ length: 24 }, (_, hr) => (
            <div key={hr} aria-hidden="true" className="absolute top-0 h-[18px] border-l border-[var(--border)] pl-1 font-mono text-[10px] text-[var(--muted-foreground)]" style={{ left: OFF + hr * 60, width: 60 }}>{String(hr).padStart(2, "0")}</div>
          ))}
          {cd.day && pieces(cd.day.blocks).map(({ index, block, from, to }) => {
            const w = to - from;
            return (
              <div key={`${index}-${from}`} title={`${blocks.label(block.block)} ${formatMinutes(block.startMin)}–${formatMinutes(block.endMin)}: ${block.what}`}
                className="absolute h-11 overflow-hidden whitespace-nowrap border-r-2 border-[var(--surface)] px-2 py-1 text-[11.5px] leading-tight text-white [text-shadow:0_1px_1px_rgb(0_0_0/0.28)]"
                style={{ top: ROW.blocks, left: OFF + from, width: w, background: colours[index] }}>
                {w >= 44 && <b className="block font-bold">{blocks.label(block.block)}</b>}
                {w >= 150 && block.what}
              </div>
            );
          })}
          {prayers.map((p, k) => (
            <div key={p.name} aria-hidden="true" className={`absolute w-0 border-l-[1.5px] border-dashed ${p.next ? "border-[var(--accent)]" : "border-[var(--foreground)]"}`} style={{ top: ROW.prayers, height: 40, left: OFF + p.min }}>
              <span className={`absolute -left-[5px] -top-px h-2 w-2 rotate-45 ${p.next ? "bg-[var(--accent)]" : "bg-[var(--foreground)]"}`} />
              <span className={`absolute left-1.5 whitespace-nowrap text-[10.5px] font-bold ${p.next ? "text-[var(--accent)]" : ""}`} style={{ top: k % 2 ? 20 : 2 }}>
                {p.label}<span className="ml-1 font-mono font-medium text-[var(--muted-foreground)]">{formatMinutes(p.min)}</span>
              </span>
            </div>
          ))}
          {timed.map((i) => {
            const ref = itemRef(i);
            const w = (i.end_min as number) - (i.start_min as number);
            const state = itemState(i, cd);
            return (
              <button key={ref} type="button" {...itemAttrs(i, h)} onClick={() => h.onPick(i)} aria-pressed={h.picked === ref} aria-label={`Details: ${labelOf(i)}`}
                className={`absolute z-[6] flex h-[22px] items-center gap-1 overflow-hidden whitespace-nowrap bg-[var(--foreground)] px-1 text-left text-[11px] text-[var(--background)] ${STATE_CLASS[state]} ${h.picked === ref ? "outline outline-2 outline-offset-1 outline-[var(--accent)]" : ""}`}
                style={{ top: ROW.items + l.lane.get(ref)!.lane * LANE, left: OFF + (i.start_min as number), width: Math.max(w, 18), boxShadow: `inset 0 -3px 0 ${h.colourOf(i)}` }}>
                <span className="grid h-[15px] min-w-[15px] place-items-center rounded-full bg-[var(--background)] font-mono text-[9.5px] font-bold text-[var(--foreground)]">{n.get(ref)}</span>
                {w >= 95 && <span data-title="" className="truncate">{i.title}</span>}
              </button>
            );
          })}
          <div aria-hidden="true" className="pointer-events-none absolute top-0 z-[5] bg-[color-mix(in_srgb,var(--surface)_50%,transparent)]" style={{ left: OFF, width: veil, height }} />
          {cd.nowMin !== null && <div aria-hidden="true" className="pointer-events-none absolute top-0 z-[8] w-0 border-l-2 border-[var(--accent)]" style={{ left: OFF + cd.nowMin, height }} />}
          <div className="sticky left-0 z-[9] h-0 w-[78px]" aria-hidden="true">
            {(["Blocks", "Prayers", "Items"] as const).map((name) => (
              <span key={name} className="absolute left-0 w-[78px] bg-[var(--surface)] pr-1.5 text-[10px] font-bold uppercase tracking-[0.09em] text-[var(--muted-foreground)]" style={{ top: ROW[name.toLowerCase() as keyof typeof ROW] }}>{name}</span>
            ))}
          </div>
        </div>
      </div>
      <Legend cd={cd} h={h} />
    </div>
  );
}
