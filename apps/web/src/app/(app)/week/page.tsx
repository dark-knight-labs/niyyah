"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { usePlanner } from "@/hooks/use-planner";
import { useNow } from "@/hooks/use-now";
import { Checkbox } from "@/components/routine/checkbox";
import { EditableRow } from "@/components/routine/editable-row";
import { ChainCrumbs } from "@/components/planner/chain-crumbs";
import { Notice, PageTitle, SectionTitle, Spinner } from "@/components/planner/page-title";
import { MonthTag, StreamIcon } from "@/components/planner/stream-chip";
import { dateInTz } from "@/lib/routine";
import { MONTH_LABEL, PLANNER_TZ, focusingQuestion, otStreamFor, toMeta } from "@/lib/streams";
import { vaultApi } from "@/lib/vault-api";
import { PipelineItemData } from "@/lib/vault-types";

const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...opts }).format(new Date(`${iso}T00:00:00Z`));

function weekDays(period: string): string[] {
  const [start] = period.split("/");
  return Array.from({ length: 7 }, (_, i) => new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));
}

export default function WeekPage() {
  const { loading, owner, quarter, pipelines, objectives, streams, error, reload } = usePlanner();
  const [problem, setProblem] = useState<string | null>(null);
  const now = useNow(60_000);
  const today = dateInTz(now, PLANNER_TZ);
  const days = useMemo(() => (objectives ? weekDays(objectives.period) : []), [objectives]);

  async function run(action: () => Promise<unknown>) {
    setProblem(null);
    try {
      await action();
      await reload();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Could not save");
    }
  }

  if (loading) return <Spinner />;
  if (!owner) return <Notice>The weekly plan is private to the vault owner.</Notice>;
  if (!objectives) return <Notice>{error ?? "Loading the week."}</Notice>;

  const itemsOf = (stream: string) => pipelines?.streams.find((s) => s.stream === stream)?.items ?? [];
  const slot = otStreamFor(now, PLANNER_TZ, streams);
  const slotNow = slot ? itemsOf(slot.id).filter((i) => i.lane === "now") : [];
  const done = objectives.items.filter((o) => o.done).length;
  const label = objectives.week.replace(/^\d{4}-/, "");

  function pick(stream: string, item: PipelineItemData) {
    void run(async () => {
      await vaultApi.setObjective(stream, { text: item.text, done: false, checkpoint: item.checkpoint ?? "" });
      if (item.lane !== "now") await vaultApi.movePipelineItem(stream, item, "now");
    });
  }

  return (
    <div className="w-full">
      <PageTitle
        eyebrow={`${label} · ${days.length ? `${fmt(days[0], { weekday: "short", day: "numeric" })} – ${fmt(days[6], { weekday: "short", day: "numeric", month: "short" })}` : objectives.period}`}
        title="The smallest domino for each stream."
        sub={<span className="tabular-nums">{done} of {objectives.items.length} done this week</span>}
      />
      {(problem || error) && <p role="alert" className="mb-4 rounded-xl border border-[var(--destructive)] px-4 py-2 text-xs text-[var(--destructive)]">{problem ?? error}</p>}

      <ol className="mb-10 grid grid-cols-7 gap-1.5 sm:gap-3" aria-label="Days of the week and the stream that owns OT">
        {days.map((d) => {
          const dayOwner = otStreamFor(new Date(`${d}T12:00:00Z`), "UTC", streams);
          const isToday = d === today;
          if (!dayOwner) return null;
          return (
            <li key={d} className="min-w-0 rounded-xl border border-[var(--border)] px-1 py-2.5 text-center sm:py-3"
              style={{ borderTop: `3px solid ${dayOwner.color}`, background: isToday ? "var(--accent-light)" : "var(--surface)", outline: isToday ? "2px solid var(--accent)" : undefined, outlineOffset: 1 }}>
              <span className="block text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)] sm:text-[11px]">{fmt(d, { weekday: "short" })}</span>
              <b className="block text-base tabular-nums sm:text-xl">{fmt(d, { day: "numeric" })}</b>
              <span className="mt-0.5 block truncate text-[10px] font-bold sm:text-xs" style={{ color: dayOwner.color }}>{dayOwner.label === "Alisha Noor" ? "Alisha" : dayOwner.label}</span>
            </li>
          );
        })}
      </ol>

      <div className="grid gap-10 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] xl:items-start xl:gap-14">
        <section aria-label="Weekly objectives">
          <SectionTitle title="This week" aside="one objective per stream, picked from its pipeline" />
          <ul className="grid gap-3">
            {objectives.items.map((item) => {
              const meta = toMeta({ ...item, slot: "", weekly: true, status: "" });
              const goal = quarter?.streams.find((s) => s.stream === item.stream);
              const pool = itemsOf(item.stream).filter((i) => i.lane !== "done");
              return (
                <li key={item.stream} className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4 sm:p-5" style={{ borderLeft: `3px solid ${meta.color}` }}>
                  <div className="flex items-start gap-3">
                    <StreamIcon stream={meta} size={34} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-extrabold uppercase tracking-[0.08em]" style={{ color: meta.color }}>{meta.label}</p>
                      <EditableRow text={item.text} placeholder="Choose the one thing for this week" struck={item.done} maxLength={200}
                        lead={<Checkbox checked={item.done} disabled={!item.text} label={`${meta.label} objective done`}
                          onChange={() => void run(() => vaultApi.setObjective(item.stream, { done: !item.done }))} />}
                        onSave={(text) => run(() => vaultApi.setObjective(item.stream, { text }))} />
                      {item.text && goal ? (
                        <div className="mt-1 pl-0.5"><ChainCrumbs goal={goal} objective={item} color={meta.color} showWeek={false} /></div>
                      ) : (
                        pool.length > 0 && (
                          <label className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--muted-foreground)]">
                            <span>Pick from pipeline</span>
                            <select defaultValue="" aria-label={`Pick ${meta.label} objective from its pipeline`}
                              onChange={(e) => { const it = pool[Number(e.target.value)]; if (it) pick(item.stream, it); }}
                              className="min-h-9 max-w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-[13px] text-[var(--foreground)]">
                              <option value="" disabled>Now, Next and Backlog…</option>
                              {pool.map((it, idx) => <option key={it.line} value={idx}>{it.lane === "now" ? "★ " : ""}{it.text}</option>)}
                            </select>
                          </label>
                        )
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {slot && (
        <aside className="grid gap-6 xl:sticky xl:top-6">
          <section aria-label="Today" className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-5 sm:p-6" style={{ borderLeft: `3px solid ${slot.color}` }}>
            <p className="eyebrow">{fmt(today, { weekday: "long", day: "numeric", month: "short" })} · OT slot</p>
            <div className="mt-2 flex items-center gap-3">
              <StreamIcon stream={slot} size={40} />
              <h2 className="heading-elegant text-3xl" style={{ color: slot.color }}>{slot.label}</h2>
            </div>
            <ul className="mt-4 divide-y divide-[var(--border)]">
              {slotNow.length === 0 && <li className="py-3 text-sm text-[var(--muted-foreground)]">Nothing in Now. Promote an item in the pipeline.</li>}
              {slotNow.map((it) => (
                <li key={it.line} className="flex items-center gap-3 py-1">
                  <Checkbox checked={false} label={`Done: ${it.text}`} onChange={() => void run(() => vaultApi.movePipelineItem(slot.id, it, "done"))} />
                  <span className="min-w-0 flex-1 break-words text-sm">{it.text}</span>
                  {it.checkpoint && <MonthTag label={MONTH_LABEL[it.checkpoint]} color={slot.color} />}
                </li>
              ))}
            </ul>
            <Link href={`/pipelines?stream=${slot.id}`} className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-[var(--accent)] hover:underline">
              Pull the next one from the pipeline <ArrowRight size={13} aria-hidden="true" />
            </Link>
          </section>

          <section aria-label="The focusing question" className="rounded-2xl bg-[var(--accent-light)] p-5 sm:p-6">
            <p className="font-hand text-[26px] leading-[1.15]">{focusingQuestion(slot)}</p>
            <p className="mt-3 text-[11px] text-[var(--muted-foreground)]">The focusing question, from The ONE Thing by Gary Keller with Jay Papasan.</p>
          </section>
        </aside>
        )}
      </div>
    </div>
  );
}
