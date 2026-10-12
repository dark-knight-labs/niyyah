"use client";

import { useEffect, useState } from "react";
import { STAGE_LABEL } from "@/lib/habit";
import { useBlocks } from "@/lib/blocks";
import { vaultApi } from "@/lib/vault-api";
import { HabitsData } from "@/lib/vault-types";

/** One row per habit: its last 12 weeks, a box per week with the days checked, green when the week reached the gate. */
export function HabitWeeks() {
  const blocks = useBlocks();
  const [data, setData] = useState<HabitsData | null>(null);
  useEffect(() => { vaultApi.habits().then(setData).catch(() => setData(null)); }, []);
  const habits = data?.habits.filter((h) => h.stage !== "retired") ?? [];
  if (habits.length === 0) return null;
  return (
    <section aria-label="Habits" className="mt-6 border border-[var(--border)] bg-[var(--surface)]">
      <h2 className="mono flex h-11 items-center justify-between border-b border-[var(--border)] px-4 text-[var(--muted-foreground)]">
        <span>Habits · last 12 weeks</span><span className="hidden text-xs font-normal normal-case tracking-normal sm:inline">Days checked per week. Green reached the gate.</span>
      </h2>
      {habits.map((h) => (
        <div key={h.id} className="grid items-center gap-x-4 gap-y-1.5 border-b border-[var(--border)] px-4 py-2.5 last:border-b-0 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_5.5rem]">
          <span className="flex min-w-0 items-center gap-2 text-small font-medium">
            <span className="h-2 w-2 shrink-0" style={{ background: blocks.color(h.block) }} aria-hidden="true" />
            <span className="truncate">{h.name}</span>
          </span>
          <div className="grid grid-cols-12 gap-[3px]" role="list" aria-label={`${h.name}, last 12 weeks`}>
            {h.weeks.map((w) => (
              <div key={w.start} role="listitem" title={`Week of ${w.start}: ${w.count} of ${h.per_week}`}
                className={`mono grid h-6 place-items-center border tabular-nums ${w.current ? "border-dashed" : ""} ${w.pct >= h.gate_pct ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]" : w.count === 0 ? "border-[var(--rule)] text-[var(--muted-foreground)]" : "border-[var(--warn)] bg-[var(--warn-light)] text-[var(--warn)]"}`}>{w.count}</div>
            ))}
          </div>
          <span className="mono text-right text-[var(--muted-foreground)]">{STAGE_LABEL[h.stage]}</span>
        </div>
      ))}
    </section>
  );
}
