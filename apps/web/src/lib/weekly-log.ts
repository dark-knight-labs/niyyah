import { WeeklyLogData, WeeklyLogEntry, WeeklyLogStream } from "@/lib/vault-types";

/** One day of the log with its entries grouped under the stream they belong to, in the order the week's streams are listed. */
export interface DayGroup { day: string; groups: { stream: WeeklyLogStream; entries: WeeklyLogEntry[] }[]; count: number; }

/** Group each day's entries by stream. A stream the totals do not list (cannot happen with the API's own answer) is kept under its slug. */
export function groupByDay(log: WeeklyLogData): DayGroup[] {
  const order = new Map(log.streams.map((s, i) => [s.stream, i] as const));
  return log.days.map(({ day, entries }) => {
    const by = new Map<string | null, WeeklyLogEntry[]>();
    for (const e of entries) by.set(e.stream, [...(by.get(e.stream) ?? []), e]);
    const groups = [...by.entries()]
      .sort(([a], [b]) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9))
      .map(([slug, list]) => ({ stream: log.streams.find((s) => s.stream === slug) ?? { stream: slug, name: slug ?? "Unfiled", color: "slate", done: 0, total: 0 }, entries: list }));
    return { day, groups, count: entries.length };
  });
}

/** "3 of 5 done" for one stream's week. */
export const doneText = (s: Pick<WeeklyLogStream, "done" | "total">) => `${s.done} of ${s.total} done`;
