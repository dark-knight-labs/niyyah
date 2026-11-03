"use client";

import Link from "next/link";
import { useState } from "react";
import { colorVar } from "@/lib/streams";
import { QuarterData, VaultGoal } from "@/lib/vault-types";
import { Checklist } from "@/components/planner/checklist";

const MICRO = "text-micro font-medium text-[var(--muted-foreground)]";

/**
 * Each stream's quarter goal with its progress, the week of the quarter and a link to the stream's plan; Goals set in Settings follow.
 * The week's small dominoes and the stream's items this week are the Week band above the calendar.
 */
export function ThisWeek({ quarter, goals, onTick }: {
  quarter: QuarterData | null; goals: VaultGoal[] | null;
  onTick: (id: string, done: boolean) => Promise<unknown>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const streams = (quarter?.streams ?? []).filter((s) => s.status !== "archived" && s.goal.trim());
  const opened = goals?.find((g) => g.title === open) ?? null;
  const square = (color: string) => <span className="mt-1.5 h-2 w-2 shrink-0" style={{ background: colorVar(color) }} aria-hidden="true" />;

  return (
    <section aria-label="This week" className="border border-[var(--border)] bg-[var(--surface)]">
      <h2 className="mono flex h-[30px] items-center justify-between border-b border-[var(--border)] px-3 text-[var(--foreground)]">
        This week
        {quarter && <span className="font-normal text-[var(--muted-foreground)]">Wk {quarter.week_of_quarter} / {quarter.weeks_in_quarter}</span>}
      </h2>
      <ul className="grid gap-2.5 px-3 py-2.5 text-small">
        {streams.length === 0 && <li className="text-[var(--muted-foreground)]">No streams set for this quarter.</li>}
        {streams.map((s) => {
          const done = s.goal_checklist.filter((l) => l.done).length;
          const pct = s.goal_checklist.length ? Math.round((100 * done) / s.goal_checklist.length) : null;
          return (
            <li key={s.stream}>
              <div className="flex items-start gap-2">
                {square(s.color)}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <Link href={`/plan?stream=${s.stream}`} className="text-micro font-bold uppercase tracking-[0.07em] hover:underline">{s.name}</Link>
                    {pct !== null && <span className="ml-auto font-mono text-xs tabular-nums text-[var(--muted-foreground)]" title={`${done} of ${s.goal_checklist.length} done`}>{pct}%</span>}
                  </div>
                  {s.goal.trim() && <p className="line-clamp-2 break-words" title={s.goal}><span className={MICRO}>Q </span>{s.goal}</p>}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {goals && goals.length > 0 && (
        <div className="border-t border-[var(--border)] px-3 py-2.5 text-small">
          <p className={`${MICRO} mb-1 uppercase tracking-[0.07em]`}>Goals</p>
          <ul className="grid gap-1">
            {goals.map((g) => (
              <li key={g.title}>
                <button type="button" disabled={!g.checklist.length} aria-expanded={open === g.title} onClick={() => setOpen(open === g.title ? null : g.title)}
                  className="flex w-full items-baseline gap-2 text-left disabled:cursor-default">
                  <span className="min-w-0 flex-1 truncate font-semibold">{g.title}</span>
                  <span className="truncate text-xs text-[var(--muted-foreground)]">{g.value}</span>
                  {g.progress !== null && <span className="font-mono text-xs tabular-nums text-[var(--muted-foreground)]">{g.progress}%</span>}
                </button>
              </li>
            ))}
          </ul>
          {opened && <div className="mt-2 border-t border-[var(--border)] pt-2"><Checklist label={`${opened.title} checklist`} items={opened.checklist} onToggle={(item, done) => onTick(item.id, done)} /></div>}
        </div>
      )}
    </section>
  );
}
