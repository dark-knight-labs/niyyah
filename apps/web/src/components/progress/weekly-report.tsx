"use client";

import { ChevronLeft, ChevronRight, Copy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { colorVar } from "@/lib/streams";
import { vaultApi } from "@/lib/vault-api";
import { PipelineStreamData, QuarterStreamData, VaultTaskData } from "@/lib/vault-types";
import { addDays, fmtDay, sundayOf, weekDays } from "@/lib/week";
import { ReportItem, reportMarkdown, weeklyReport } from "@/lib/weekly-report";

const BTN = "inline-flex min-h-8 items-center whitespace-nowrap border border-[var(--border)] px-2.5 text-xs font-semibold text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-40";

function rangeLabel(days: string[]): string {
  const [a, b] = [days[0], days[6]];
  const month = (d: string) => fmtDay(d, { month: "short" });
  const day = (d: string) => fmtDay(d, { day: "numeric" });
  return month(a) === month(b) ? `${day(a)}–${day(b)} ${month(b)} ${fmtDay(b, { year: "numeric" })}` : `${day(a)} ${month(a)} – ${day(b)} ${month(b)} ${fmtDay(b, { year: "numeric" })}`;
}

function Item({ item, done }: { item: ReportItem; done: boolean }) {
  return (
    <li className="flex items-baseline gap-2 text-small">
      <span aria-hidden="true" className={`mt-1 h-2 w-2 shrink-0 self-start border border-[var(--muted-foreground)] ${done ? "bg-[var(--accent)]" : ""}`} />
      <span className={`min-w-0 flex-1 break-words ${done ? "" : "text-[var(--muted-foreground)]"}`}>
        {item.text}{item.tags.map((t) => <span key={t} className="mono ml-1.5 text-[var(--muted-foreground)]">#{t}</span>)}
      </span>
      <span className="mono shrink-0 text-[var(--muted-foreground)]">{item.source === "plan" ? "plan · " : ""}{item.day ? fmtDay(item.day, { weekday: "short" }) : ""}</span>
    </li>
  );
}

/** One week of work per stream: what got done (calendar tasks ticked, Plan items finished), what stayed open, and the tags it touched. */
export function WeeklyReport({ today }: { today: string }) {
  const thisWeek = sundayOf(today);
  const [start, setStart] = useState(thisWeek);
  const [tasks, setTasks] = useState<Record<string, VaultTaskData[]> | null>(null);
  const [streams, setStreams] = useState<QuarterStreamData[]>([]);
  const [pipelines, setPipelines] = useState<PipelineStreamData[]>([]);
  const [copied, setCopied] = useState(false);
  const days = useMemo(() => weekDays(`${start}/${addDays(start, 6)}`), [start]);

  useEffect(() => {
    vaultApi.quarter().then((q) => setStreams(q.streams)).catch(() => setStreams([]));
    vaultApi.pipelines().then((p) => setPipelines(p.streams)).catch(() => setPipelines([]));
  }, []);
  useEffect(() => {
    let live = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTasks(null);
    Promise.all(days.map(async (d) => [d, await vaultApi.tasks(d).catch(() => [] as VaultTaskData[])] as const)).then((all) => { if (live) setTasks(Object.fromEntries(all)); });
    return () => { live = false; };
  }, [days]);

  const report = useMemo(() => (tasks ? weeklyReport(days, tasks, streams, pipelines) : []), [days, tasks, streams, pipelines]);
  const label = rangeLabel(days);
  const done = report.reduce((n, g) => n + g.done.length, 0);
  const open = report.reduce((n, g) => n + g.open.length, 0);

  useHotkeys({ "[": () => setStart(addDays(start, -7)), "]": () => setStart(addDays(start, 7)), t: () => setStart(thisWeek) });

  async function copy() {
    try { await navigator.clipboard.writeText(reportMarkdown(label, report)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked: nothing to confirm */ }
  }

  return (
    <section aria-label="Weekly report" className="mb-6 border border-[var(--border)] bg-[var(--surface)]">
      <h2 className="mono flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--border)] px-4 py-1.5 text-[var(--foreground)]">
        <span>Weekly report</span>
        <span className="font-normal text-[var(--muted-foreground)]">{tasks ? `${done} done · ${open} open` : "Loading…"}</span>
        <span className="flex-1" />
        <span className="inline-flex" role="group" aria-label="Week">
          <button type="button" onClick={() => setStart(addDays(start, -7))} aria-label="Previous week" title="Previous week ([)" className={`${BTN} px-1.5`}><ChevronLeft size={15} aria-hidden="true" /></button>
          <button type="button" onClick={() => setStart(thisWeek)} disabled={start === thisWeek} title="Back to this week (t)" className={`${BTN} border-x-0 font-mono font-normal tabular-nums ${start === thisWeek ? "!text-[var(--foreground)] !opacity-100" : ""}`}>{label}</button>
          <button type="button" onClick={() => setStart(addDays(start, 7))} aria-label="Next week" title="Next week (])" className={`${BTN} px-1.5`}><ChevronRight size={15} aria-hidden="true" /></button>
        </span>
        <button type="button" onClick={() => void copy()} disabled={!report.length} className={`${BTN} gap-1.5`}><Copy size={13} aria-hidden="true" />{copied ? "Copied" : "Copy"}</button>
      </h2>
      {tasks && report.length === 0 && <p className="px-4 py-3 text-small text-[var(--muted-foreground)]">Nothing logged this week.</p>}
      {report.map((g) => (
        <div key={g.id ?? "none"} className="grid gap-x-6 gap-y-1.5 border-b border-[var(--border)] px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-small font-semibold"><span className="h-2 w-2 shrink-0" style={{ background: colorVar(g.color) }} aria-hidden="true" /><span className="truncate">{g.name}</span></p>
            <p className="mono mt-1 text-[var(--muted-foreground)]"><b className="font-medium text-[var(--foreground)]">{g.done.length}</b> done · {g.open.length} open</p>
            {g.tags.length > 0 && <p className="mono mt-1 flex flex-wrap gap-x-2 text-[var(--muted-foreground)]">{g.tags.slice(0, 6).map(([t, n]) => <span key={t}>#{t} {n}</span>)}</p>}
          </div>
          <ul className="grid gap-1">
            {g.done.map((i, n) => <Item key={`d${n}`} item={i} done />)}
            {g.open.map((i, n) => <Item key={`o${n}`} item={i} done={false} />)}
          </ul>
        </div>
      ))}
    </section>
  );
}
