"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { DominoChain } from "@/components/planner/domino-chain";
import { PageTitle } from "@/components/planner/page-title";
import { QuarterRing } from "@/components/planner/quarter-ring";
import { VaultScheduleData, slotOwnerFor } from "@/lib/routine";
import { MONTH_LABEL, StreamMeta } from "@/lib/streams";
import { fmtDay, weekDays } from "@/lib/week";
import { QuarterData, VaultObjectivesData } from "@/lib/vault-types";

interface Props {
  quarter: QuarterData;
  objectives: VaultObjectivesData | null;
  streams: StreamMeta[];
  /** Decides which stream owns the slot on each day; without it the week strip is left out. */
  schedule: VaultScheduleData | null;
  /** Today as "YYYY-MM-DD" in the planner's timezone. */
  today: string;
  busy: boolean;
  onSaveObjective: (text: string) => Promise<boolean>;
}

/** The quarter's Super Objective with its ring, and the week's seven days showing which block owns OT. */
export function PlanHeader({ quarter, objectives, streams, schedule, today, busy, onSaveObjective }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const year = quarter.quarter.slice(0, 4);
  const q = quarter.quarter.slice(5);
  const months = quarter.months.map((m) => MONTH_LABEL[m]);
  const days = objectives ? weekDays(objectives.period) : [];

  return (
    <>
      <PageTitle
        eyebrow={`${q} ${year} · ${months[0]} – ${months[months.length - 1]}`}
        title={
          editing ? (
            <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) void onSaveObjective(draft.trim()).then((ok) => ok && setEditing(false)); }}>
              <input autoFocus value={draft} maxLength={300} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
                aria-label="Super Objective" className="min-w-0 flex-1 basis-80 rounded-xl border border-[var(--accent)] bg-[var(--background)] px-3 py-2 text-xl" />
              <button type="submit" disabled={busy || !draft.trim()} className="min-h-11 rounded-xl bg-[var(--accent)] px-5 text-sm font-bold text-[var(--accent-fg)] disabled:opacity-50">Save</button>
              <button type="button" onClick={() => setEditing(false)} className="min-h-11 rounded-xl border border-[var(--border)] px-4 text-sm font-semibold">Cancel</button>
            </form>
          ) : (
            <>
              {quarter.objective || "Set this quarter's Super Objective"}
              <button type="button" aria-label="Edit the Super Objective" title="Edit" onClick={() => { setDraft(quarter.objective); setEditing(true); }}
                className="ml-2 inline-grid h-9 w-9 place-items-center rounded-lg align-middle text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"><Pencil size={16} /></button>
            </>
          )
        }
        sub={quarter.objective_ar ? <span dir="rtl" lang="ar" className="text-xl">{quarter.objective_ar}</span> : undefined}
        visual={
          <div className="flex items-end gap-6 text-[var(--accent)]">
            <DominoChain count={6} height={72} className="hidden sm:block" />
            <QuarterRing week={quarter.week_of_quarter} weeks={quarter.weeks_in_quarter} label={`OF ${quarter.weeks_in_quarter} WEEKS`} />
          </div>
        }
      />
      {days.length > 0 && schedule && (
        <ol className="-mt-2 mb-8 grid max-w-xl grid-cols-7 gap-1.5 sm:gap-2" aria-label="Days of the week and the block that owns OT">
          {days.map((d) => {
            const ownerId = slotOwnerFor(schedule, new Date(`${d}T12:00:00Z`));
            const owner = streams.find((s) => s.id === ownerId);
            const isToday = d === today;
            if (!owner) return null;
            return (
              <li key={d} className="min-w-0 rounded-xl border border-[var(--border)] px-1 py-2 text-center"
                style={{ borderTop: `3px solid ${owner.color}`, background: isToday ? "var(--accent-light)" : "var(--surface)", outline: isToday ? "2px solid var(--accent)" : undefined, outlineOffset: -1 }}>
                <span className="block text-[0.625rem] font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">{fmtDay(d, { weekday: "short" })}</span>
                <b className="block text-[0.875rem] tabular-nums">{fmtDay(d, { day: "numeric" })}</b>
                <span className="block truncate text-[0.625rem] font-bold" style={{ color: owner.color }}>{owner.label === "Alisha Noor" ? "Alisha" : owner.label}</span>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
