"use client";

import { Checklist } from "@/components/planner/checklist";
import { FIELD, SettingsSection } from "@/components/settings/section";
import { ChecklistLine, GoalIn } from "@/lib/vault-types";

const MAX = 6;

interface Props {
  goals: GoalIn[];
  onChange: (goals: GoalIn[]) => void;
}

const withIds = (lines: ChecklistLine[]): ChecklistLine[] => lines.map((l) => ({ ...l, id: l.id ?? (Math.random().toString(36) + "00000000").slice(2, 10) }));

/** The cards at the top of the Overview: a title, a value, an optional caption, and either lines to tick or a typed progress number. */
export function GoalsSection({ goals, onChange }: Props) {
  const edit = (i: number, patch: Partial<GoalIn>) => onChange(goals.map((g, n) => (n === i ? { ...g, ...patch } : g)));
  return (
    <SettingsSection id="goals" title="Goals" aside={`${goals.length} of ${MAX}`}>
      {goals.length === 0 && <p className="text-sm text-[var(--muted-foreground)]">No goals yet. They show at the top of the Overview.</p>}
      {goals.map((g, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 border-t border-[var(--border)] py-2 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.4fr)_5rem_auto]">
          <input className={FIELD} aria-label="Goal title" placeholder="Title, e.g. Zero debt" maxLength={60} value={g.title} onChange={(e) => edit(i, { title: e.target.value })} />
          <input className={FIELD} aria-label="Goal value" placeholder="Value, e.g. 62% paid" maxLength={80} value={g.value} onChange={(e) => edit(i, { value: e.target.value })} />
          <input className={`${FIELD} col-span-2 sm:col-span-1`} aria-label="Goal caption" placeholder="Caption (optional)" maxLength={120} value={g.caption} onChange={(e) => edit(i, { caption: e.target.value })} />
          <input className={`${FIELD} font-mono`} type="number" min={0} max={100} aria-label="Goal progress" placeholder={g.checklist.length ? "auto" : "0-100"} disabled={g.checklist.length > 0} value={g.progress ?? ""} onChange={(e) => edit(i, { progress: e.target.value === "" ? null : Number(e.target.value) })} />
          <button type="button" onClick={() => onChange(goals.filter((_, n) => n !== i))} className="min-h-9 rounded-lg px-2 text-xs font-semibold text-[var(--destructive)] hover:bg-[var(--muted)]">Remove</button>
          <div className="col-span-full sm:pl-0.5">
            <Checklist label={`${g.title || "Goal"} lines`} items={g.checklist.map((l) => ({ id: l.id ?? "", text: l.text, done: !!l.done }))} placeholder="Add a line to tick off (optional)"
              onToggle={(item, done) => edit(i, { checklist: g.checklist.map((l) => (l.id === item.id ? { ...l, done } : l)) })}
              onChange={(lines) => edit(i, { checklist: withIds(lines), progress: lines.length ? null : g.progress })} />
          </div>
        </div>
      ))}
      <button type="button" disabled={goals.length >= MAX} onClick={() => onChange([...goals, { title: "", value: "", caption: "", progress: null, checklist: [] }])}
        className="mt-2 min-h-9 rounded-lg border border-[var(--border)] px-3 text-xs font-semibold hover:bg-[var(--muted)] disabled:opacity-50">Add goal</button>
    </SettingsSection>
  );
}
