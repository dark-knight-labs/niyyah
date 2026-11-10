"use client";

import { gateShare, weekChecks, weekLabel } from "@/lib/plan-v3";
import { GoalRef, quarterText } from "@/lib/plan-v2";
import { vaultApi } from "@/lib/vault-api";
import { HabitData, HabitFields, HabitsData } from "@/lib/vault-types";

export type RunHabits = (action: () => Promise<HabitsData>) => Promise<boolean>;

const link = "mono text-[var(--accent)] hover:underline";
const chipBtn = "mono min-h-8 border border-[var(--rule)] px-2.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] aria-pressed:border-[var(--foreground)] aria-pressed:bg-[var(--foreground)] aria-pressed:text-[var(--background)] disabled:opacity-40";
const label = "mono mb-1.5 block text-[var(--muted-foreground)]";
const ghost = "mono inline-flex min-h-9 items-center border border-[var(--rule)] px-3.5 hover:bg-[var(--muted)] disabled:opacity-40";

/** A habit under its goal in the block cell: ↻ name · n/wk · wk x/gate, and a mini bar of the gate. */
export function HabitLine({ habit: h, picked, dim, warn, onPick, onRelink }: {
  habit: HabitData; picked: boolean; dim: boolean; warn?: boolean; onPick: () => void; onRelink?: () => void;
}) {
  const wk = weekLabel(h);
  return (
    <div data-habit={h.id} className={`flex min-h-6 flex-wrap items-center gap-x-1.5 py-0.5 pl-5 ${dim ? "opacity-30" : ""} ${picked ? "bg-[var(--muted)] shadow-[inset_2px_0_0_var(--accent)]" : ""}`}>
      <span className="text-[var(--muted-foreground)]" aria-hidden="true">↻</span>
      <button type="button" onClick={onPick} className="min-w-0 flex-1 truncate text-left text-small hover:text-[var(--accent)]">{h.name}</button>
      <span className="mono shrink-0 text-[var(--muted-foreground)]">{h.per_week}/wk{wk ? ` · ${wk}` : ""}</span>
      {h.stage === "installing" && (
        <span className="block h-1 w-10 shrink-0 bg-[var(--border)]" aria-hidden="true"><span className="block h-full bg-[var(--accent)]" style={{ width: `${gateShare(h)}%` }} /></span>
      )}
      {warn && onRelink && <button type="button" onClick={onRelink} className={`${link} shrink-0`} aria-label={`Re-link habit: ${h.name}`}>re-link</button>}
    </div>
  );
}

/** This week's ticks of a block's habits, at the top of its Now cell: dots (one per day a week), the count, and +1 for today. */
export function WeekTicks({ habits, today, dim, busy, runHabits, onPick }: {
  habits: HabitData[]; today: string; dim: (h: HabitData) => boolean; busy: boolean; runHabits: RunHabits; onPick: (id: number) => void;
}) {
  if (habits.length === 0) return null;
  return (
    <div className="mb-1.5 border-b border-[var(--border)] pb-1" aria-label="Habits this week">
      {habits.map((h) => {
        const n = weekChecks(h, today);
        const checkedToday = h.today !== null;
        return (
          <div key={h.id} data-habit-week={h.id} className={`flex min-h-6 items-center gap-1.5 ${dim(h) ? "opacity-30" : ""}`}>
            <span className="text-[var(--muted-foreground)]" aria-hidden="true">↻</span>
            <button type="button" onClick={() => onPick(h.id)} className="min-w-0 flex-1 truncate text-left text-small hover:text-[var(--accent)]">{h.name}</button>
            <span className="flex shrink-0 gap-[3px]" aria-hidden="true">
              {Array.from({ length: h.per_week }, (_, k) => <i key={k} className={`block h-1.5 w-1.5 rounded-full ${k < n ? "bg-[var(--accent)]" : "border border-[var(--rule)]"}`} />)}
            </span>
            <span className="mono shrink-0 tabular-nums text-[var(--muted-foreground)]" data-habit-count>{n}/{h.per_week}</span>
            <button type="button" disabled={busy} className={`${link} shrink-0`} aria-label={checkedToday ? `Undo today: ${h.name}` : `Tick today: ${h.name}`}
              onClick={() => void runHabits(() => vaultApi.checkHabit(h.id, today, checkedToday ? null : "done"))}>{checkedToday ? "✓" : "+1"}</button>
          </div>
        );
      })}
    </div>
  );
}

/** The habit side card opened from the Plan: cadence, stage and week, and the goal it serves. */
export function PlanHabitCard({ habit: h, goals, busy, runHabits, onClose }: {
  habit: HabitData;
  /** Goals of the habit's block: this quarter's and later ones, plus the ended one it is linked to now. */
  goals: GoalRef[];
  busy: boolean; runHabits: RunHabits; onClose: () => void;
}) {
  const save = (fields: HabitFields) => runHabits(() => vaultApi.updateHabit(h.id, fields));
  const linked = goals.find((g) => g.id === h.goal_ref);
  return (
    <>
      <p className="mono text-[var(--muted-foreground)]">Habit · {h.plan_block ?? h.stream ?? "no block"}</p>
      <h3 className="heading-elegant text-lg leading-tight">↻ {h.name}</h3>
      <div>
        <span className={label}>Cadence</span>
        <div role="group" aria-label="Cadence" className="flex flex-wrap gap-1.5">
          {[3, 4, 5, 7].map((n) => <button key={n} type="button" disabled={busy} aria-pressed={h.per_week === n} onClick={() => void save({ per_week: n })} className={chipBtn}>{n}/wk</button>)}
        </div>
      </div>
      <p className="text-small"><span className="mono mr-2 text-[var(--muted-foreground)]">Stage</span>
        {h.stage}{h.stage === "installing" ? ` · week ${Math.min(h.gate_run, h.gate_weeks)} of ${h.gate_weeks}` : ""}{h.anchor ? ` · ${h.anchor}` : ""}</p>
      <div>
        <span className={label}>Goal</span>
        <div role="group" aria-label="Habit goal" className="flex flex-wrap gap-1.5">
          {goals.map((g) => (
            <button key={g.id} type="button" disabled={busy} aria-pressed={h.goal_ref === g.id} title={g.text}
              onClick={() => void save({ goal_ref: g.id })} className={`${chipBtn} min-w-0 max-w-full truncate ${g.ended ? "text-[var(--warn)]" : ""}`}>
              {quarterText(g.quarter)} · {g.text}{g.ended ? " · ended" : ""}
            </button>
          ))}
          <button type="button" disabled={busy} aria-pressed={!h.goal_ref} onClick={() => void save({ clear_goal: true })} className={chipBtn}>No goal</button>
        </div>
        {linked?.ended && <p className="mt-1 text-xs text-[var(--warn)]">Its goal ended with {quarterText(linked.quarter)}. Pick a goal of this quarter or a later one.</p>}
        {h.goal_ref && !linked && <p className="mt-1 text-xs text-[var(--warn)]">Its goal was removed. Pick another.</p>}
        {goals.every((g) => g.ended) && <p className="mt-1 text-xs text-[var(--muted-foreground)]">No goal for this quarter yet. Add one in the block column.</p>}
      </div>
      <div className="flex flex-wrap gap-2"><button type="button" className={ghost} onClick={onClose}>Close</button></div>
    </>
  );
}

