import type { VaultDayData } from "@/lib/vault-types";

export const RANGES = [[7, "7d"], [30, "30d"], [90, "90d"], [365, "1y"]] as const;
export type Range = (typeof RANGES)[number][0];
/** A day counts as a good day at or above this share of its possible stars. */
export const GOOD_DAY_PCT = 70;
/** Past 90 days a column is a week, so the chart stays readable. */
export const WEEKLY_AFTER = 90;

const DAY_MS = 86_400_000;
const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);

export function addDays(d: string, n: number): string {
  return new Date(utc(d) + n * DAY_MS).toISOString().slice(0, 10);
}

/** "Fri 9 Oct", with the year when asked. */
export function fmtDate(d: string, year = false): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}) })
    .format(new Date(utc(d))).replace(",", "");
}

/** The `n` dates ending at `end`, oldest first. */
export function lastDays(end: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDays(end, i - (n - 1)));
}

/** "YYYY-MM" for the `back` months before the month of `end`, oldest first, including that month. */
export function monthsBack(end: string, back: number): string[] {
  const [y, m] = end.split("-").map(Number);
  return Array.from({ length: back + 1 }, (_, i) => {
    const t = new Date(Date.UTC(y, m - 1 - (back - i), 1));
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

export interface Column { dates: string[]; label: string; end: string }

/** One column per day up to 90 days, one per week beyond. */
export function columns(dates: string[]): Column[] {
  if (dates.length <= WEEKLY_AFTER) return dates.map((d) => ({ dates: [d], label: fmtDate(d), end: d }));
  const out: Column[] = [];
  for (let i = 0; i < dates.length; i += 7) {
    const g = dates.slice(i, i + 7);
    out.push({ dates: g, label: `Week of ${fmtDate(g[0])}`, end: g[g.length - 1] });
  }
  return out;
}

export type DayMap = Map<string, VaultDayData>;
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

export function logged(map: DayMap, dates: string[]): VaultDayData[] {
  return dates.map((d) => map.get(d)).filter((d): d is VaultDayData => !!d);
}

export function stats(map: DayMap, dates: string[]) {
  const l = logged(map, dates);
  return {
    n: l.length,
    consistency: l.length ? Math.round((100 * l.filter((d) => d.pct >= GOOD_DAY_PCT).length) / l.length) : 0,
    pct: Math.round(mean(l.map((d) => d.pct))),
    stars: l.reduce((s, d) => s + d.total, 0),
  };
}

/** Days in a row at the good-day level, ending today (an unlogged today does not break it), and the best run in `dates`. */
export function dayStreak(map: DayMap, dates: string[]) {
  const good = (d: string) => (map.get(d)?.pct ?? -1) >= GOOD_DAY_PCT;
  let best = 0, run = 0;
  for (const d of dates) { run = good(d) ? run + 1 : 0; best = Math.max(best, run); }
  let cur = 0;
  for (let i = dates.length - 1; i >= 0; i--) {
    if (good(dates[i])) cur++;
    else if (i === dates.length - 1 && !map.has(dates[i])) continue;
    else break;
  }
  return { cur, best };
}

/** Average stars (0-3) of one block over a column's logged days; null when none of them voted. */
export function blockAvg(map: DayMap, col: Column, block: string): number | null {
  const v = col.dates.map((d) => map.get(d)?.blocks[block]).filter((x): x is number => typeof x === "number");
  return v.length ? mean(v) : null;
}

/** Average total and possible stars over a column's logged days; null when none were logged. */
export function colTotals(map: DayMap, col: Column): { total: number; possible: number; pct: number } | null {
  const l = logged(map, col.dates);
  if (!l.length) return null;
  return { total: mean(l.map((d) => d.total)), possible: mean(l.map((d) => d.possible)), pct: mean(l.map((d) => d.pct)) };
}
