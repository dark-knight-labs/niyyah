"use client";

import Link from "next/link";
import { useState } from "react";
import { vaultApi } from "@/lib/vault-api";
import { colorVar } from "@/lib/streams";
import { QuarterData, VaultGoal, VaultObjectivesData } from "@/lib/vault-types";
import { fmtDay } from "@/lib/week";
import { Checklist } from "@/components/planner/checklist";
import { EditableRow } from "@/components/routine/editable-row";
import type { Week } from "@/components/routine/week-calendar";

const MICRO = "text-micro font-medium text-[var(--muted-foreground)]";

/**
 * Each stream, nested: the quarter goal with its progress, under it the week's goal (click to edit),
 * under that the tasks put on this week's calendar for the stream. Goals set in Settings follow.
 */
export function ThisWeek({ quarter, objectives, week, goals, onChanged, onTick }: {
  quarter: QuarterData | null; objectives: VaultObjectivesData | null; week: Week; goals: VaultGoal[] | null;
  onChanged: () => void; onTick: (id: string, done: boolean) => Promise<unknown>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const weekly = new Map((objectives?.items ?? []).map((o) => [o.stream, o]));
  const streams = (quarter?.streams ?? []).filter((s) => s.status !== "archived" && (s.goal.trim() || weekly.has(s.stream)));
  const tasksOf = (stream: string) => week.days.flatMap((day) => (week.data[day]?.tasks ?? []).filter((t) => t.stream === stream).map((t) => ({ day, task: t })));
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
          const o = weekly.get(s.stream);
          const done = s.goal_checklist.filter((l) => l.done).length;
          const pct = s.goal_checklist.length ? Math.round((100 * done) / s.goal_checklist.length) : null;
          const tasks = tasksOf(s.stream);
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
                  {o && (
                    <div className="mt-0.5 pl-3">
                      <EditableRow compact text={o.text} struck={o.done} maxLength={300} placeholder="Set this week's goal"
                        lead={<span className={`${MICRO} self-center`}>W</span>}
                        onSave={async (text) => { await vaultApi.setObjective(o.stream, { text }); onChanged(); }} />
                    </div>
                  )}
                  {tasks.length > 0 && (
                    <ul className="mt-0.5 grid gap-px pl-6">
                      {tasks.map(({ day, task }) => (
                        <li key={task.line} className="flex items-start gap-1.5 text-xs">
                          <button type="button" aria-pressed={task.done} aria-label={`${task.done ? "Not done" : "Done"}: ${task.text}`}
                            onClick={() => void vaultApi.setTask(task, !task.done).then(() => { week.reloadTasks(); onChanged(); })}
                            className="grid h-4 w-4 shrink-0 place-items-center"><span className={`h-2.5 w-2.5 border border-[var(--muted-foreground)] ${task.done ? "bg-[var(--accent)]" : ""}`} /></button>
                          <span className="w-7 shrink-0 font-mono tabular-nums text-[var(--muted-foreground)]">{fmtDay(day, { weekday: "short" })}</span>
                          <span className={`min-w-0 break-words ${task.done ? "text-[var(--muted-foreground)] line-through" : ""}`}>{task.text}</span>
                        </li>
                      ))}
                    </ul>
                  )}
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
