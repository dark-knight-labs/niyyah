"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { PageTitle } from "@/components/planner/page-title";
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
                className="ml-2 inline-grid h-7 w-7 place-items-center align-middle text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"><Pencil size={14} /></button>
            </>
          )
        }
        sub={quarter.objective_ar ? <span dir="rtl" lang="ar" className="text-base">{quarter.objective_ar}</span> : undefined}
        visual={
          <div className="grid gap-1.5 justify-items-end">
            <p className="mono text-[var(--muted-foreground)]">Week <b className="font-medium tabular-nums text-[var(--foreground)]">{quarter.week_of_quarter}</b> of {quarter.weeks_in_quarter}</p>
            <div className="flex h-[22px] w-full min-w-[14rem] items-end gap-[3px] text-[var(--accent)] sm:w-[14.5rem]" role="img" aria-label={`Week ${quarter.week_of_quarter} of ${quarter.weeks_in_quarter}`}>
              {Array.from({ length: quarter.weeks_in_quarter }, (_, i) => (
                <span key={i} className="flex-1 bg-current" style={{ height: i + 1 === quarter.week_of_quarter ? 18 : 7, opacity: i + 1 === quarter.week_of_quarter ? 1 : i + 1 < quarter.week_of_quarter ? 0.55 : 0.16 }} />
              ))}
            </div>
          </div>
        }
      />
      {days.length > 0 && schedule && (
        <ol className="mb-4 grid grid-cols-7 border border-[var(--border)] bg-[var(--surface)]" aria-label="Days of the week and the block that owns OT">
          {days.map((d) => {
            const ownerId = slotOwnerFor(schedule, new Date(`${d}T12:00:00Z`));
            const owner = streams.find((s) => s.id === ownerId);
            const isToday = d === today;
            return (
              <li key={d} className={`flex min-w-0 items-center gap-2 border-l border-[var(--border)] px-2.5 py-1.5 first:border-l-0 ${isToday ? "bg-[var(--accent-light)] shadow-[inset_0_-2px_0_var(--accent)]" : ""}`}>
                <span className="mono text-[var(--muted-foreground)]">{fmtDay(d, { weekday: "short" })}</span>
                <b className="text-small font-medium tabular-nums">{fmtDay(d, { day: "numeric" })}</b>
                <span className="ml-auto flex min-w-0 items-center gap-1.5 text-xs text-[var(--muted-foreground)] max-sm:hidden">
                  <span className="h-2 w-2 shrink-0" style={{ background: owner?.color ?? "var(--rule)" }} aria-hidden="true" />
                  <span className="truncate">{owner ? owner.label.split(" ")[0] : "·"}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
