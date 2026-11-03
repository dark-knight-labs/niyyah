"use client";

import { Star } from "lucide-react";
import { useState } from "react";
import { Pick } from "@/components/planner/pick";
import { SmallDomino } from "@/components/planner/small-domino";
import type { Week } from "@/components/routine/week-calendar";
import { pickDomino, setDomino } from "@/lib/plan-bridge";
import { colorVar, toMeta } from "@/lib/streams";
import type { PipelinesData, QuarterData, VaultObjectivesData } from "@/lib/vault-types";

const MICRO = "text-micro font-medium text-[var(--muted-foreground)]";

/** This week's own items of a stream: done / total, each item once however many days it shows on. */
function pieces(week: Week, stream: string): { done: number; total: number } {
  const seen = new Map<number | string, boolean>();
  for (const day of week.days) for (const t of week.items.byDay[day] ?? []) if (t.kind === "task" && t.stream === stream) seen.set(t.id as number, t.done);
  return { done: [...seen.values()].filter(Boolean).length, total: seen.size };
}

/**
 * The week's small dominoes above the calendar, one per active weekly stream: colour rule, star, the objective (click to edit),
 * its tick, and how many of the stream's items this week are done. No objective: a dashed gap with Pick (from the pipeline) and Write.
 * Objectives are only kept for the current week, so any other week shows one quiet line instead.
 */
export function WeekBand({ quarter, objectives, pipelines, week, onChanged }: {
  quarter: QuarterData | null; objectives: VaultObjectivesData | null; pipelines: PipelinesData | null; week: Week; onChanged: () => void;
}) {
  if (!week.isThisWeek) return <p data-week-band-off="" className="mb-2 px-1 text-xs text-[var(--muted-foreground)]">Small dominoes are set for the current week</p>;
  const streams = (quarter?.streams ?? []).filter((s) => s.weekly && s.status !== "archived" && s.status !== "paused");
  if (!streams.length) return null;
  return (
    <section aria-label="Week band" data-week-band="" className="mb-2 grid gap-px border border-[var(--border)] bg-[var(--border)] sm:grid-cols-2 xl:grid-cols-3">
      {streams.map((s) => {
        const o = objectives?.items.find((x) => x.stream === s.stream) ?? null;
        const meta = toMeta(s);
        const pool = (pipelines?.streams.find((p) => p.stream === s.stream)?.items ?? []).filter((i) => i.lane !== "done");
        const count = pieces(week, s.stream);
        const run = async (action: () => Promise<unknown>) => { await action(); onChanged(); };
        return (
          <div key={s.stream} data-band-stream={s.stream} className="flex min-w-0 items-start gap-2 bg-[var(--surface)] py-1.5 pl-2 pr-3" style={{ boxShadow: `inset 3px 0 0 ${colorVar(s.color)}` }}>
            <Star size={13} aria-hidden="true" className="mt-2.5 shrink-0 text-[var(--accent)]" />
            <div className="min-w-0 flex-1">
              <p className={`${MICRO} uppercase tracking-[0.07em]`}>{s.name}</p>
              {o?.text ? (
                <SmallDomino meta={meta} objective={o} pool={pool} run={run} onPick={(item) => void run(() => pickDomino(s.stream, item))} />
              ) : (
                <Gap meta={meta} pool={pool} run={run} onPick={(item) => void run(() => pickDomino(s.stream, item))} />
              )}
            </div>
            <span data-band-count="" title={`${count.done} of ${count.total} items this week done`} className="mt-2.5 shrink-0 font-mono text-xs tabular-nums text-[var(--muted-foreground)]">{count.done}/{count.total}</span>
          </div>
        );
      })}
    </section>
  );
}

/** No small domino yet: Pick one from the pipeline, or Write it. */
function Gap({ meta, pool, run, onPick }: { meta: Parameters<typeof SmallDomino>[0]["meta"]; pool: Parameters<typeof SmallDomino>[0]["pool"]; run: Parameters<typeof SmallDomino>[0]["run"]; onPick: Parameters<typeof SmallDomino>[0]["onPick"] }) {
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  if (writing) {
    return (
      <form className="flex gap-1.5 py-0.5" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void run(() => setDomino(meta.id, { text: text.trim() })).then(() => { setWriting(false); setText(""); }); }}>
        <input autoFocus value={text} maxLength={200} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setWriting(false)} aria-label={`${meta.label} small domino`}
          className="min-h-8 min-w-0 flex-1 border border-[var(--accent)] bg-[var(--background)] px-2 text-small" />
        <button type="submit" disabled={!text.trim()} className="min-h-8 bg-[var(--accent)] px-2.5 text-xs font-bold text-[var(--accent-fg)] disabled:opacity-50">Save</button>
      </form>
    );
  }
  return (
    <div data-band-gap="" className="flex flex-wrap items-center gap-2 border border-dashed border-[var(--rule)] px-2 py-1 text-xs text-[var(--muted-foreground)]">
      <span>no small domino</span>
      {pool.length > 0 && (
        <Pick value="" label={`Pick ${meta.label} small domino from its pipeline`} placeholder="Pick" className="!h-7"
          options={pool.map((it, idx) => ({ value: String(idx), label: `${it.lane === "now" ? "★ " : ""}${it.text}` }))}
          onChange={(v) => { const it = pool[Number(v)]; if (it) onPick(it); }} />
      )}
      <button type="button" onClick={() => setWriting(true)} className="mono h-7 border border-[var(--rule)] px-2.5 text-[var(--foreground)] hover:bg-[var(--muted)]">Write</button>
    </div>
  );
}
