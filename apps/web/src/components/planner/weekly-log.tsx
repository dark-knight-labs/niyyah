"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Notice } from "@/components/planner/page-title";
import { colorVar } from "@/lib/streams";
import { vaultApi } from "@/lib/vault-api";
import { WeeklyLogData } from "@/lib/vault-types";
import { doneText, groupByDay } from "@/lib/weekly-log";
import { fmtDay } from "@/lib/week";

/** Weekly log: per stream how many tasks were finished this week, and each day's tasks under the stream they belong to.
 *  A task sits on the day it was finished, or (still open) the day it is for. Captures from the menu-bar app land here. */
export function WeeklyLog({ reloadKey }: { reloadKey?: unknown }) {
  const [week, setWeek] = useState<string | undefined>(undefined);
  const [log, setLog] = useState<WeeklyLogData | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (w?: string) => {
    try {
      setLog(await vaultApi.weeklyLog(w));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => { void load(week); }, [load, week, reloadKey]);

  if (failed) return <div className="p-4"><Notice>The weekly log could not be loaded.</Notice></div>;
  if (!log) return <p className="mono p-4 text-[var(--muted-foreground)]">Loading…</p>;
  const days = groupByDay(log);

  return (
    <div data-testid="weekly-log">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--border)] px-4 py-2.5">
        <button type="button" aria-label="Previous week" onClick={() => setWeek(log.prev_week)} className="grid h-8 w-8 place-items-center border border-[var(--rule)] hover:bg-[var(--muted)]"><ChevronLeft size={14} /></button>
        <p className="mono tabular-nums" aria-live="polite">{log.week} · {fmtDay(log.start, { day: "numeric", month: "short" })} to {fmtDay(log.end, { day: "numeric", month: "short" })}</p>
        <button type="button" aria-label="Next week" onClick={() => setWeek(log.next_week)} className="grid h-8 w-8 place-items-center border border-[var(--rule)] hover:bg-[var(--muted)]"><ChevronRight size={14} /></button>
        {week !== undefined && <button type="button" onClick={() => setWeek(undefined)} className="mono text-[var(--accent)] hover:underline">This week</button>}
      </div>
      {log.streams.length === 0 ? (
        <p className="px-4 py-3 text-sm text-[var(--muted-foreground)]">Nothing logged this week.</p>
      ) : (
        <ul className="flex flex-wrap gap-x-6 gap-y-1 border-b border-[var(--border)] px-4 py-3" aria-label="Finished per stream">
          {log.streams.map((s) => (
            <li key={s.stream ?? "unfiled"} className="flex items-center gap-2 text-sm">
              <span className="h-2 w-2 shrink-0" style={{ background: colorVar(s.color) }} aria-hidden="true" />
              <span className="font-medium">{s.name}</span>
              <span className="mono tabular-nums text-[var(--muted-foreground)]">{doneText(s)}</span>
            </li>
          ))}
        </ul>
      )}
      <ol className="divide-y divide-[var(--border)]">
        {days.map((d) => (
          <li key={d.day} className="grid gap-x-6 gap-y-1 px-4 py-2.5 sm:grid-cols-[7rem_1fr]">
            <p className="mono text-[var(--muted-foreground)]">{fmtDay(d.day, { weekday: "short", day: "numeric", month: "short" })}</p>
            {d.count === 0 ? <p className="text-sm text-[var(--muted-foreground)]">·</p> : (
              <div className="grid gap-2">
                {d.groups.map((g) => (
                  <div key={g.stream.stream ?? "unfiled"}>
                    <p className="mono flex items-center gap-2"><span className="h-2 w-2" style={{ background: colorVar(g.stream.color) }} aria-hidden="true" />{g.stream.name}</p>
                    <ul className="mt-0.5">
                      {g.entries.map((e) => (
                        <li key={e.id} className={`text-sm ${e.done ? "text-[var(--muted-foreground)] line-through" : ""}`}>
                          <span aria-hidden="true" className="mono mr-2">{e.done ? "✓" : "○"}</span>
                          <span className="sr-only">{e.done ? "Finished: " : "Open: "}</span>{e.text}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
