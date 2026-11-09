import type { Lane, MonthKey } from "@/lib/vault-types";

/**
 * The derived week and month rules of the Plan page. Pure: they read fields that already exist on a pipeline item
 * (lane, done, checkpoint, focus) and nothing else, so no API or schema change is needed. The script
 * scripts/plan-rules-check.ts runs this same module against a data export.
 */

export const MONTHS: MonthKey[] = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** The fields of a pipeline item the rules read. `order` breaks ties (the item's line, or its index). */
export interface RuleItem {
  lane: Lane;
  done?: boolean;
  checkpoint: MonthKey | null;
  /** ISO week label such as "2026-W45" when the item was that week's small domino. */
  focus: string | null;
  order?: number;
}

const isOpen = (i: RuleItem) => !i.done && i.lane !== "done";

/** The week the item was carried from: a committed (Now), open item whose small-domino week has passed. Next and Someday items get none. */
export function carriedFrom(item: RuleItem, week: string): string | null {
  return item.lane === "now" && !item.done && item.focus && item.focus < week ? item.focus : null;
}

/** The month an ISO week belongs to: the month of its Thursday. "2026-W49" -> "dec", "2026-W46" -> "nov". */
export function weekMonth(isoWeek: string): MonthKey | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(isoWeek);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dow = jan4.getUTCDay() || 7;                      // Monday = 1 .. Sunday = 7
  const thursday = new Date(Date.UTC(year, 0, 4 - (dow - 1) + (week - 1) * 7 + 3));
  return MONTHS[thursday.getUTCMonth()];
}

/** Months from `current` forward to `cp`, wrapping the year: 0 this month, 1..5 ahead, 6..11 behind. */
export function monthDelta(cp: MonthKey, current: MonthKey): number {
  return (((MONTHS.indexOf(cp) - MONTHS.indexOf(current)) % 12) + 12) % 12;
}

/** Open, with a checkpoint month already behind (6..11 months forward is read as 1..6 months back). */
export function overdue(item: RuleItem, current: MonthKey): boolean {
  if (!isOpen(item) || !item.checkpoint) return false;
  const d = monthDelta(item.checkpoint, current);
  return d >= 6 && d <= 11;
}

const order = (i: RuleItem, idx: number) => i.order ?? idx;

/** The one carried item of a stream: the latest carried week wins, then the lowest order. */
export function carriedPick<T extends RuleItem>(items: T[], week: string): T | null {
  let best: { item: T; focus: string; ord: number } | null = null;
  items.forEach((item, idx) => {
    const focus = carriedFrom(item, week);
    if (!focus) return;
    const ord = order(item, idx);
    if (!best || focus > best.focus || (focus === best.focus && ord < best.ord)) best = { item, focus, ord };
  });
  return best ? (best as { item: T }).item : null;
}

/** True when the item belongs in the Month tab for `current`. */
export function inMonth(item: RuleItem, current: MonthKey, week: string): boolean {
  if (!isOpen(item)) return false;
  return overdue(item, current) || item.checkpoint === current || (!!item.focus && item.focus === week && weekMonth(week) === current);
}

const LANE_RANK: Record<string, number> = { now: 0, next: 1, backlog: 2 };

/** The Month tab: overdue first, then this month's checkpoints, then Now > Next > Someday, then the existing order. */
export function monthTab<T extends RuleItem>(items: T[], current: MonthKey, week: string): T[] {
  const rank = (i: T) => (overdue(i, current) ? 0 : i.checkpoint === current ? 1 : 2);
  return items
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => inMonth(item, current, week))
    .sort((a, b) => rank(a.item) - rank(b.item) || (LANE_RANK[a.item.lane] ?? 3) - (LANE_RANK[b.item.lane] ?? 3) || order(a.item, a.idx) - order(b.item, b.idx))
    .map(({ item }) => item);
}
