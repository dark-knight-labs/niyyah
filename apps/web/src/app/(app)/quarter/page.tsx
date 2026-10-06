"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { usePlanner } from "@/hooks/use-planner";
import { DominoChain } from "@/components/planner/domino-chain";
import { MonthTrack } from "@/components/planner/month-track";
import { Notice, PageTitle, SectionTitle, Spinner } from "@/components/planner/page-title";
import { QuarterRing } from "@/components/planner/quarter-ring";
import { StatusPill, StreamIcon } from "@/components/planner/stream-chip";
import { MONTH_LABEL, streamMeta } from "@/lib/streams";

export default function QuarterPage() {
  const { loading, owner, quarter, quarterError, pipelines, objectives, error } = usePlanner();

  if (loading) return <Spinner />;
  if (!owner) return <Notice>The quarter plan is private to the vault owner.</Notice>;
  if (!quarter) return <Notice>{quarterError ?? error ?? "Loading the quarter."}</Notice>;

  const year = quarter.quarter.slice(0, 4);
  const q = quarter.quarter.slice(5);
  const months = quarter.streams[0]?.checkpoints.map((c) => MONTH_LABEL[c.month]) ?? [];
  const count = (stream: string, lane: string) => pipelines?.streams.find((s) => s.stream === stream)?.items.filter((i) => i.lane === lane).length ?? 0;

  return (
    <div className="w-full">
      <PageTitle
        eyebrow={`${q} ${year}${months.length ? ` · ${months[0]} – ${months[months.length - 1]}` : ""}`}
        title={quarter.objective || "Set this quarter's Super Objective"}
        sub={quarter.objective_ar ? <span dir="rtl" lang="ar" className="text-xl">{quarter.objective_ar}</span> : undefined}
        visual={
          <div className="flex items-end gap-6 text-[var(--accent)]">
            <DominoChain count={6} height={72} className="hidden sm:block" />
            <QuarterRing week={quarter.week_of_quarter} weeks={quarter.weeks_in_quarter} label={`OF ${quarter.weeks_in_quarter} WEEKS`} />
          </div>
        }
      />

      <SectionTitle title="Big dominoes" aside="one goal per stream · the northstar for the end of the quarter" />
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {quarter.streams.map((s) => {
          const meta = streamMeta(s.stream);
          const week = objectives?.items.find((o) => o.stream === s.stream);
          return (
            <article key={s.stream} className="flex min-w-0 flex-col gap-5 rounded-2xl border border-[var(--border)] bg-[var(--background)] p-5 sm:p-6"
              style={{ borderTop: `3px solid ${meta.color}` }}>
              <header className="flex items-center gap-3">
                <StreamIcon stream={meta} />
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-extrabold uppercase tracking-[0.08em]" style={{ color: meta.color }}>{meta.label}</h3>
                  <p className="truncate text-xs text-[var(--muted-foreground)]">{meta.slot}</p>
                </div>
                <StatusPill status={s.status} />
              </header>
              <p className="text-[15px] font-semibold leading-snug">{s.goal}</p>
              <MonthTrack checkpoints={s.checkpoints} current={quarter.current_month} color={meta.color} />
              <div className="flex items-baseline gap-3 border-t border-[var(--border)] pt-4 text-[13px]">
                <span className="shrink-0 text-[10px] font-extrabold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">Small domino</span>
                <span className={`min-w-0 break-words ${week?.text ? "" : "text-[var(--muted-foreground)]"}`}>
                  {meta.weekly ? week?.text || "Not chosen for this week" : "Passive, no weekly objective"}
                </span>
              </div>
              <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted-foreground)]">
                <span className="tabular-nums">{count(s.stream, "now")} now · {count(s.stream, "next")} next · {count(s.stream, "backlog")} backlog</span>
                <Link href={`/pipelines?stream=${s.stream}`} className="inline-flex items-center gap-1 font-bold text-[var(--accent)] hover:underline">
                  Open pipeline <ArrowRight size={13} aria-hidden="true" />
                </Link>
              </footer>
            </article>
          );
        })}
      </div>
    </div>
  );
}
