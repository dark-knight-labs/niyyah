"use client";

import { useBlocks } from "@/lib/blocks";
import { fmtDate } from "@/lib/progress";
import { resolveModeColor } from "@/lib/vault-constants";
import type { VaultDayData } from "@/lib/vault-types";

const STARS = 3;

function Pips({ value, color }: { value: number; color: string }) {
  return (
    <span className="flex gap-[3px]" aria-hidden="true">
      {Array.from({ length: STARS }, (_, i) => <i key={i} className="block h-3 w-3 rounded-none border" style={i < value ? { background: color, borderColor: color } : { borderColor: "var(--border)" }} />)}
    </span>
  );
}

/** The picked day: stars per block, mode, small domino and log, with previous / next / today. */
export function DayDock({ date, day, isToday, onStep, onToday, canPrev, canNext }: { date: string; day: VaultDayData | undefined; isToday: boolean; onStep: (by: number) => void; onToday: () => void; canPrev: boolean; canNext: boolean }) {
  const blocks = useBlocks();
  const nav = (
    <div className="mt-2 flex gap-1.5">
      <button type="button" disabled={!canPrev} onClick={() => onStep(-1)} className="min-h-9 rounded-lg border border-[var(--border)] px-3 text-xs font-semibold disabled:opacity-40">← Prev</button>
      <button type="button" disabled={!canNext} onClick={() => onStep(1)} className="min-h-9 rounded-lg border border-[var(--border)] px-3 text-xs font-semibold disabled:opacity-40">Next →</button>
      <button type="button" disabled={isToday} onClick={onToday} className="min-h-9 rounded-lg border border-[var(--border)] px-3 text-xs font-semibold disabled:opacity-40">Today</button>
    </div>
  );
  const eyebrow = <p className="text-micro font-bold uppercase tracking-[0.09em] text-[var(--muted-foreground)]">{isToday ? "Today · live" : "Day"}</p>;
  const title = <h3 className="mt-0.5 font-serif text-xl font-medium leading-tight">{fmtDate(date, true)}</h3>;

  if (!day) {
    return <div className="mt-4 border-t border-[var(--border)] pt-3.5" aria-live="polite">{eyebrow}{title}<p className="mt-1 text-sm text-[var(--muted-foreground)]">Not logged. Nothing synced for this day.</p>{nav}</div>;
  }
  const list = blocks.forDay(day.blocks);
  const half = Math.ceil(list.length / 2);
  const row = (key: string, label: string, color: string) => (
    <div key={key} className="flex min-h-[34px] items-center gap-2 border-t border-[var(--border)] text-sm first:border-t-0">
      <i className="h-2 w-2 rounded-none" style={{ background: color }} aria-hidden="true" />
      <span className="flex-1 font-medium">{label}</span>
      <Pips value={day.blocks[key] ?? 0} color={color} />
      <span className="w-3 text-right font-mono text-xs text-[var(--muted-foreground)]">{day.blocks[key] ?? 0}</span>
    </div>
  );
  const kv = (name: string, text: string | null, empty: string) => (
    <div className="border-t border-[var(--border)] py-2 text-sm"><p className="mb-0.5 text-micro font-bold uppercase tracking-[0.09em] text-[var(--muted-foreground)]">{name}</p>{text ? <p className="whitespace-pre-wrap">{text}</p> : <p className="text-[var(--muted-foreground)]">{empty}</p>}</div>
  );
  return (
    <div className="mt-4 grid gap-x-7 gap-y-2 border-t border-[var(--border)] pt-3.5 md:grid-cols-[minmax(12rem,16rem)_minmax(0,1fr)_minmax(0,1fr)]" aria-live="polite">
      <div>
        {eyebrow}{title}
        <div className="mt-2 flex items-baseline gap-2">
          <span className="font-serif text-3xl font-medium leading-none tabular-nums">{day.total}<small className="ml-0.5 font-mono text-xs text-[var(--muted-foreground)]">/{day.possible}</small></span>
          <span className="font-mono text-sm">{day.pct}%</span>
        </div>
        <span className="mt-1.5 inline-flex items-center gap-1.5 rounded bg-[var(--muted)] px-1.5 py-0.5 text-micro font-semibold uppercase tracking-[0.05em] text-[var(--muted-foreground)]">
          <i className="h-1.5 w-1.5 rounded-none" style={{ background: resolveModeColor(day.mode) }} aria-hidden="true" />{day.mode} mode
        </span>
        {nav}
      </div>
      <div>{list.slice(0, half).map((b) => row(b.key, b.label, blocks.color(b.key)))}{kv("Small domino", day.focus, "None set.")}</div>
      <div>{list.slice(half).map((b) => row(b.key, b.label, blocks.color(b.key)))}{kv("Log", day.log, "No entry.")}</div>
    </div>
  );
}
