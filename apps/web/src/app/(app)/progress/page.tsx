"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { HabitWeeks } from "@/components/progress/habit-weeks";
import { DayDock } from "@/components/progress/day-dock";
import { StripChart } from "@/components/progress/strip-chart";
import { useNow } from "@/hooks/use-now";
import { useBlocks } from "@/lib/blocks";
import { DayMap, GOOD_DAY_PCT, RANGES, Range, dayStreak, lastDays, logged, monthsBack, stats } from "@/lib/progress";
import { dateInTz } from "@/lib/routine";
import { PLANNER_TZ } from "@/lib/streams";
import { vaultApi } from "@/lib/vault-api";
import { resolveModeColor } from "@/lib/vault-constants";
import type { VaultDayData } from "@/lib/vault-types";

const RANGE_KEY = "niyyah-progress-range";
const YEAR = 365;

/** Progress: every logged day on one time axis (stars per block, mode), with a range picker and the picked day's detail. */
export default function ProgressPage() {
  const blocks = useBlocks();
  const today = dateInTz(useNow(3_600_000), PLANNER_TZ);
  const [map, setMap] = useState<DayMap>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<Range>(30);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(RANGE_KEY));
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (RANGES.some(([r]) => r === saved)) setRange(saved as Range);
    } catch { /* default range */ }
  }, []);

  const load = useCallback(async () => {
    setError(null);
    const results = await Promise.allSettled(monthsBack(today, 12).map((m) => vaultApi.month(m)));
    const next: DayMap = new Map();
    let failed = 0;
    for (const r of results) {
      if (r.status === "fulfilled") r.value.days.forEach((d: VaultDayData) => next.set(d.date, d));
      else failed++;
    }
    setMap(next);
    if (failed) setError(`Could not load ${failed} of ${results.length} months. The API may be unreachable.`);
    setLoading(false);
  }, [today]);
  useEffect(() => { void load(); }, [load]);

  const year = useMemo(() => lastDays(today, YEAR), [today]);
  const dates = useMemo(() => year.slice(-range), [year, range]);
  const selected = picked && dates.includes(picked) ? picked : today;
  const s = useMemo(() => stats(map, dates), [map, dates]);
  const streak = useMemo(() => dayStreak(map, year), [map, year]);
  const modes = useMemo(() => {
    const c: Record<string, number> = {};
    logged(map, dates).forEach((d) => { c[d.mode] = (c[d.mode] ?? 0) + 1; });
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [map, dates]);
  const chartBlocks = blocks.list
    .filter((b) => b.counts_for_stars && (!b.archived || dates.some((d) => map.get(d)?.blocks[b.key] !== undefined)))
    .map((b) => ({ key: b.key, label: b.label, color: blocks.color(b.key) }));
  const todayDay = map.get(today);
  const idx = dates.indexOf(selected);

  function pickRange(r: Range) {
    setRange(r);
    try { localStorage.setItem(RANGE_KEY, String(r)); } catch { /* still applies for this visit */ }
  }

  if (loading) return <div className="flex h-64 items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" /></div>;

  const stat = (name: string, value: string, extra?: string) => (
    <span className="font-mono text-xs font-medium text-[var(--muted-foreground)]">{name} <b className="font-medium text-[var(--foreground)]">{value}</b>{extra}</span>
  );

  return (
    <div className="w-full">
      {error && <p role="alert" className="mb-3 rounded-xl border border-[var(--destructive)] bg-[var(--surface)] px-4 py-2 text-xs text-[var(--destructive)]">{error}</p>}
      <header className="mb-3.5 flex flex-wrap items-end justify-between gap-x-5 gap-y-2">
        <div>
          <p className="flex items-center gap-2 text-micro font-bold uppercase tracking-[0.09em] text-[var(--muted-foreground)]">
            <span className="pulse-dot h-[7px] w-[7px] rounded-none" style={{ background: todayDay ? resolveModeColor(todayDay.mode) : "var(--accent)" }} aria-hidden="true" />
            {todayDay ? `Today ${todayDay.total}/${todayDay.possible} · ${todayDay.pct}%` : "Today not logged yet"}
          </p>
          <h1 className="mt-0.5 font-serif text-[1.75rem] font-medium leading-tight">Progress</h1>
          <p className="text-sm text-[var(--muted-foreground)]">Every logged day: blocks, stars and modes. Pick a range, then a day for the detail.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Range">
          {RANGES.map(([r, label]) => (
            <button key={r} type="button" onClick={() => pickRange(r)} aria-pressed={range === r}
              className="min-h-8 rounded-lg border border-[var(--border)] px-3 text-xs font-semibold text-[var(--muted-foreground)] aria-pressed:border-[var(--foreground)] aria-pressed:bg-[var(--foreground)] aria-pressed:text-[var(--background)]">{label}</button>
          ))}
        </div>
      </header>

      <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1.5 border-y border-[var(--border)] py-2">
        {stat("consistency", `${s.consistency}%`)}
        {stat("avg completion", `${s.pct}%`)}
        {stat("day streak", `${streak.cur}d`, ` (best ${streak.best}d)`)}
        {stat("stars", String(s.stars))}
        {stat("logged", `${s.n}/${dates.length}`)}
      </div>

      <StripChart map={map} dates={dates} blocks={chartBlocks} selected={selected} onSelect={setPicked} />

      {modes.length > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-micro font-medium text-[var(--muted-foreground)]">
          <span className="font-sans font-bold uppercase tracking-[0.09em]">Modes</span>
          {modes.map(([m, c]) => <span key={m} className="inline-flex items-center gap-1.5"><i className="h-1.5 w-1.5 rounded-none" style={{ background: resolveModeColor(m) }} aria-hidden="true" />{m} <b className="font-medium text-[var(--foreground)]">{c}</b></span>)}
        </p>
      )}

      <DayDock date={selected} day={map.get(selected)} isToday={selected === today}
        canPrev={idx > 0} canNext={idx >= 0 && idx < dates.length - 1}
        onStep={(by) => setPicked(dates[Math.max(0, Math.min(dates.length - 1, idx + by))])} onToday={() => setPicked(null)} />
      <HabitWeeks />
      <p className="mt-3 text-xs text-[var(--muted-foreground)]">A good day is {GOOD_DAY_PCT}% or more of the possible stars. Consistency is the share of logged days that were good.</p>
    </div>
  );
}
