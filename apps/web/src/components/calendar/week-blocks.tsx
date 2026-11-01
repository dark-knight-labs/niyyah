"use client";

import { useBlocks } from "@/lib/blocks";
import { allDayItems, bookedIn, bookedMin, CalDay, pieces, timedItems } from "@/lib/calendar";
import { formatDuration } from "@/lib/ring";
import { formatMinutes } from "@/lib/routine";
import { fmtDay } from "@/lib/week";

/** A full bar is this many minutes. */
const MAX_MIN = 8 * 60;

/**
 * Where the hours go: rows are blocks, columns are days. The coloured bar is the block's time that day, the ink part the
 * timed items booked inside it. Then the day's timed and all-day counts and its prayer times.
 */
export function WeekBlocks({ days, colours }: { days: CalDay[]; colours: (iso: string) => string[] }) {
  const blocks = useBlocks();
  const keys = [...new Set(days.flatMap((d) => d.day?.blocks.map((b) => b.block) ?? []))];
  const order = (k: string) => { const i = blocks.list.findIndex((b) => b.key === k); return i < 0 ? 999 : i; };
  keys.sort((a, b) => order(a) - order(b));
  const cellCls = (cd: CalDay) => `border-t border-[var(--border)] p-1.5 align-top text-[11.5px] ${cd.today ? "bg-[var(--accent-light)]" : ""}`;
  const v = "font-mono text-[10.5px] text-[var(--muted-foreground)]";
  return (
    <div className="overflow-x-auto">
      <table className="mt-2 w-full min-w-[44rem] table-fixed border-collapse">
        <caption className="sr-only">Hours per block and day, with the time booked inside each block</caption>
        <thead>
          <tr>
            <th className="w-28" />
            {days.map((cd) => <th key={cd.iso} scope="col" className={`px-1.5 pb-1.5 pt-1 text-left text-[10px] font-bold uppercase tracking-[0.09em] ${cd.today ? "text-[var(--accent)]" : "text-[var(--muted-foreground)]"}`}>{fmtDay(cd.iso, { weekday: "short", day: "numeric" })}</th>)}
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k}>
              <th scope="row" className="border-t border-[var(--border)] p-1.5 text-left align-top text-xs font-bold">
                <span aria-hidden="true" className="mr-1.5 inline-block h-2.5 w-2.5 align-[-1px]" style={{ background: blocks.color(k) }} />{blocks.label(k)}
              </th>
              {days.map((cd) => {
                const mine = cd.day ? pieces(cd.day.blocks).filter((p) => p.block.block === k) : [];
                const total = mine.reduce((n, p) => n + p.to - p.from, 0);
                if (!total) return <td key={cd.iso} className={cellCls(cd)}><span className={v}>·</span></td>;
                const booked = mine.reduce((n, p) => n + bookedIn(cd.items, p.from, p.to), 0);
                return (
                  <td key={cd.iso} className={cellCls(cd)} data-block-cell={`${k}:${cd.iso}`}>
                    <div className="relative mb-0.5 h-[9px] bg-[var(--muted)]">
                      <i className="absolute inset-y-0 left-0" style={{ width: `${Math.min(100, (total / MAX_MIN) * 100)}%`, background: colours(cd.iso)[mine[0].index] }} />
                      {booked > 0 && <i className="absolute inset-y-0 left-0 bg-[var(--foreground)] opacity-85" style={{ width: `${Math.min(100, (booked / MAX_MIN) * 100)}%` }} />}
                    </div>
                    <div className={v}><b className="font-medium text-[var(--foreground)]">{formatDuration(total)}</b>{booked > 0 && ` · ${formatDuration(booked)} booked`}</div>
                  </td>
                );
              })}
            </tr>
          ))}
          <tr>
            <th scope="row" className="border-t border-[var(--border)] p-1.5 text-left text-xs font-bold">Timed</th>
            {days.map((cd) => <td key={cd.iso} className={cellCls(cd)}><div className={v}><b className="font-medium text-[var(--foreground)]">{timedItems(cd.items).length}</b> · {formatDuration(bookedMin(cd.items))}</div></td>)}
          </tr>
          <tr>
            <th scope="row" className="border-t border-[var(--border)] p-1.5 text-left text-xs font-bold">All day</th>
            {days.map((cd) => { const a = allDayItems(cd.items); return <td key={cd.iso} className={cellCls(cd)}><div className={v}><b className="font-medium text-[var(--foreground)]">{a.length}</b> · {a.filter((i) => i.status === "done").length} done</div></td>; })}
          </tr>
          <tr>
            <th scope="row" className="border-t border-[var(--border)] p-1.5 text-left text-xs font-bold">Prayers</th>
            {days.map((cd) => <td key={cd.iso} className={cellCls(cd)}><div className={`${v} break-words`}>{cd.day ? Object.values(cd.day.prayers).map(formatMinutes).join(" ") : "–"}</div></td>)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
