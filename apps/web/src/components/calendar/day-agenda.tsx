"use client";

import { useBlocks } from "@/lib/blocks";
import { CalDay, inSpan, prayerMarks, timedItems } from "@/lib/calendar";
import { itemRef } from "@/lib/items";
import { formatDuration, inBlock, isPast } from "@/lib/ring";
import { formatMinutes, ResolvedBlock } from "@/lib/routine";
import { AllDayStrip, ItemHandlers, ItemRow, MICRO } from "@/components/calendar/item-bits";

/**
 * The day as text, in order: the All day strip, then each block with its prayers and the timed items that start in it.
 * Timed items in no block close the list under "Unscheduled". Works as the phone view.
 */
export function DayAgenda({ cd, colours, h }: { cd: CalDay; colours: string[]; h: ItemHandlers }) {
  const blocks = useBlocks();
  const timed = timedItems(cd.items);
  const n = new Map(timed.map((i, k) => [itemRef(i), k + 1]));
  const prayers = cd.day ? prayerMarks(cd.day, cd.nowMin) : [];
  const rows = (cd.day?.blocks ?? []).map((b, index) => ({ b, index })).sort((x, y) => x.b.startMin - y.b.startMin);
  const startsIn = (b: ResolvedBlock) => timed.filter((i) => inSpan(i.start_min as number, b.startMin, b.endMin));
  const loose = timed.filter((i) => !(cd.day?.blocks ?? []).some((b) => inSpan(i.start_min as number, b.startMin, b.endMin)));

  return (
    <div>
      <AllDayStrip cd={cd} h={h} />
      <ol className="mt-1" aria-label="Blocks">
        {rows.map(({ b, index }) => {
          const current = cd.nowMin !== null && inBlock(b, cd.nowMin);
          const past = cd.past || (cd.nowMin !== null && isPast(b, cd.nowMin));
          const here = prayers.filter((p) => inSpan(p.min, b.startMin, b.endMin));
          return (
            <li key={`${b.block}-${b.startMin}`} aria-current={current ? "time" : undefined}
              className={`grid grid-cols-[5px_minmax(0,1fr)] gap-x-2.5 border-t border-[var(--border)] py-2 ${current ? "-mx-2 bg-[var(--accent-light)] px-2 shadow-[inset_2px_0_0_var(--accent)]" : ""} ${past ? "opacity-60" : ""}`}>
              <span aria-hidden="true" style={{ background: colours[index] }} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="font-mono text-xs tabular-nums text-[var(--muted-foreground)]">{formatMinutes(b.startMin)}–{formatMinutes(b.endMin)}</span>
                  <b className="font-bold" style={{ color: colours[index] }}>{blocks.label(b.block)}</b>
                  <span className="min-w-0 text-small text-[var(--muted-foreground)]">{b.what}</span>
                  <span className={`ml-auto bg-[var(--muted)] px-1.5 ${MICRO}`}>{formatDuration(b.endMin - b.startMin)}</span>
                </div>
                {here.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {here.map((p) => (
                      <span key={p.name} className={`inline-flex items-center gap-1.5 rounded-full border px-2 text-[11px] font-bold leading-5 ${p.next ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--foreground)]"}`}>
                        <span aria-hidden="true" className={`h-1.5 w-1.5 rotate-45 ${p.next ? "bg-[var(--accent)]" : "bg-[var(--foreground)]"}`} />{p.label}
                        <span className="font-mono text-[10.5px] font-medium text-[var(--muted-foreground)]">{formatMinutes(p.min)}</span>
                      </span>
                    ))}
                  </div>
                )}
                {startsIn(b).map((i) => <ItemRow key={itemRef(i)} item={i} cd={cd} h={h} n={n.get(itemRef(i))} />)}
              </div>
            </li>
          );
        })}
        {loose.length > 0 && (
          <li className="border-t border-[var(--border)] py-2">
            <span className={MICRO}>Unscheduled</span>
            {loose.map((i) => <ItemRow key={itemRef(i)} item={i} cd={cd} h={h} n={n.get(itemRef(i))} />)}
          </li>
        )}
      </ol>
      {!cd.day && <p className="mt-2 text-xs text-[var(--muted-foreground)]">The schedule could not be read for this day.</p>}
    </div>
  );
}
