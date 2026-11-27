"use client";

import { ChevronLeft, ChevronRight, Copy, Pencil } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { usePref } from "@/hooks/use-pref";
import { colorVar } from "@/lib/streams";
import { vaultApi } from "@/lib/vault-api";
import { PipelineStreamData, QuarterStreamData, VaultTaskData } from "@/lib/vault-types";
import { addDays, fmtDay, sundayOf, weekDays } from "@/lib/week";
import { dayMarkdown, ReportItem, reportMarkdown, weeklyByDay, weeklyReport } from "@/lib/weekly-report";

const BTN = "inline-flex min-h-8 items-center whitespace-nowrap border border-[var(--border)] px-2.5 text-xs font-semibold text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-40";

function rangeLabel(days: string[]): string {
  const [a, b] = [days[0], days[6]];
  const month = (d: string) => fmtDay(d, { month: "short" });
  const day = (d: string) => fmtDay(d, { day: "numeric" });
  return month(a) === month(b) ? `${day(a)}–${day(b)} ${month(b)} ${fmtDay(b, { year: "numeric" })}` : `${day(a)} ${month(a)} – ${day(b)} ${month(b)} ${fmtDay(b, { year: "numeric" })}`;
}

const VIEWS = ["block", "day"] as const;

/** Tags are written as #word, so a calendar task whose tag has a space cannot be re-typed here without changing it. */
const editable = (i: ReportItem) => !!i.ref && (i.ref.kind === "plan" || i.tags.every((t) => !/\s/.test(t)));
const editText = (i: ReportItem) => (i.ref?.kind === "task" ? `${i.text}${i.tags.map((t) => ` #${t}`).join("")}` : i.text);

interface Edits { busy: boolean; save: (i: ReportItem, text: string) => void; toggle: (i: ReportItem) => void }

function Item({ item, done, edits, showDay = true }: { item: ReportItem; done: boolean; edits?: Edits; showDay?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const can = !!edits && editable(item);
  function commit() {
    const next = text.trim();
    setEditing(false);
    if (next && next !== editText(item)) edits?.save(item, next);
  }
  return (
    <li className="flex items-baseline gap-2 text-small" data-report-item>
      {can && item.ref ? (
        <button type="button" disabled={edits.busy} onClick={() => edits.toggle(item)} aria-label={`${done ? "Reopen" : "Done"}: ${item.text}`} title={done ? "Reopen" : "Mark done"}
          className={`mt-1 h-2.5 w-2.5 shrink-0 self-start border border-[var(--muted-foreground)] hover:border-[var(--foreground)] ${done ? "bg-[var(--accent)]" : ""}`} />
      ) : (
        <span aria-hidden="true" className={`mt-1 h-2 w-2 shrink-0 self-start border border-[var(--muted-foreground)] ${done ? "bg-[var(--accent)]" : ""}`} />
      )}
      {editing ? (
        <input autoFocus value={text} maxLength={500} aria-label={`Edit: ${item.text}`} onChange={(e) => setText(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") { e.stopPropagation(); setEditing(false); } }}
          className="min-h-7 min-w-0 flex-1 border border-[var(--rule)] bg-[var(--background)] px-1.5 text-small outline-none focus:border-[var(--accent)]" />
      ) : (
        <span className={`min-w-0 flex-1 break-words ${done ? "" : "text-[var(--muted-foreground)]"}`}>
          {item.text}{item.tags.map((t) => <span key={t} className="mono ml-1.5 text-[var(--muted-foreground)]">#{t}</span>)}
        </span>
      )}
      {can && !editing && (
        <button type="button" disabled={edits.busy} onClick={() => { setText(editText(item)); setEditing(true); }} aria-label={`Edit: ${item.text}`} title="Edit text and #tags"
          className="shrink-0 self-start p-0.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><Pencil size={12} aria-hidden="true" /></button>
      )}
      <span className="mono shrink-0 text-[var(--muted-foreground)]">{item.source === "plan" ? "plan · " : ""}{showDay && item.day ? fmtDay(item.day, { weekday: "short" }) : ""}</span>
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
  const [view, setView] = usePref("niy-report-view", "block", VIEWS);
  const [rev, setRev] = useState(0); // bumped after an edit so the week is read again
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const days = useMemo(() => weekDays(`${start}/${addDays(start, 6)}`), [start]);

  useEffect(() => {
    vaultApi.quarter().then((q) => setStreams(q.streams)).catch(() => setStreams([]));
    vaultApi.pipelines().then((p) => setPipelines(p.streams)).catch(() => setPipelines([]));
  }, [rev]);
  useEffect(() => {
    let live = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTasks(null);
    Promise.all(days.map(async (d) => [d, await vaultApi.tasks(d).catch(() => [] as VaultTaskData[])] as const)).then((all) => { if (live) setTasks(Object.fromEntries(all)); });
    return () => { live = false; };
  }, [days, rev]);

  const report = useMemo(() => (tasks ? weeklyReport(days, tasks, streams, pipelines) : []), [days, tasks, streams, pipelines]);
  const byDay = useMemo(() => weeklyByDay(report), [report]);
  const label = rangeLabel(days);
  const done = report.reduce((n, g) => n + g.done.length, 0);
  const open = report.reduce((n, g) => n + g.open.length, 0);

  useHotkeys({ "[": () => setStart(addDays(start, -7)), "]": () => setStart(addDays(start, 7)), t: () => setStart(thisWeek) });

  /** An edit from the By-day view: write it, then read the week again. */
  async function edit(action: () => Promise<unknown>) {
    setBusy(true);
    setProblem(null);
    try { await action(); setRev((n) => n + 1); } catch (err) { setProblem(err instanceof Error ? err.message : "Could not save"); } finally { setBusy(false); }
  }
  const edits: Edits = {
    busy,
    save: (i, text) => void edit(() => (i.ref?.kind === "task" ? vaultApi.editTask(i.ref.task, text) : i.ref?.kind === "plan" ? vaultApi.renamePipelineItem(i.ref.stream, i.ref.item, text) : Promise.resolve())),
    // A Plan item in this report is done, so its tick reopens it (back to Next); a task flips between done and open.
    toggle: (i) => void edit(() => (i.ref?.kind === "task" ? vaultApi.setTask(i.ref.task, !i.ref.task.done) : i.ref?.kind === "plan" ? vaultApi.movePipelineItem(i.ref.stream, i.ref.item, "next") : Promise.resolve())),
  };

  async function copy() {
    const md = view === "day" ? dayMarkdown(label, byDay) : reportMarkdown(label, report);
    try { await navigator.clipboard.writeText(md); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked: nothing to confirm */ }
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
        <span className="inline-flex" role="group" aria-label="Group by">
          {VIEWS.map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={`${BTN} ${v === "day" ? "border-l-0" : ""} aria-pressed:bg-[var(--foreground)] aria-pressed:text-[var(--background)]`}>{v === "day" ? "By day" : "By block"}</button>
          ))}
        </span>
        <button type="button" onClick={() => void copy()} disabled={!report.length} className={`${BTN} gap-1.5`}><Copy size={13} aria-hidden="true" />{copied ? "Copied" : "Copy"}</button>
      </h2>
      {problem && <p role="alert" className="border-b border-[var(--destructive)] px-4 py-2 text-xs text-[var(--destructive)]">{problem}</p>}
      {tasks && report.length === 0 && <p className="px-4 py-3 text-small text-[var(--muted-foreground)]">Nothing logged this week.</p>}
      {view === "day" && byDay.map((d) => (
        <div key={d.day} data-report-day={d.day} className="border-b border-[var(--border)] px-4 py-3 last:border-b-0">
          <h3 className="mono mb-2 font-medium text-[var(--foreground)]">{fmtDay(d.day, { weekday: "long", day: "numeric", month: "short" })}</h3>
          {d.blocks.map((b) => (
            <div key={b.id ?? "none"} data-report-block={b.id ?? "none"} className="mb-2 grid gap-x-6 gap-y-1 last:mb-0 md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
              <p className="flex items-center gap-2 text-small font-semibold"><span className="h-2 w-2 shrink-0" style={{ background: colorVar(b.color) }} aria-hidden="true" /><span className="truncate">{b.name}</span></p>
              <div className="grid gap-1.5">
                {b.products.map((p) => (
                  <div key={p.product ?? "none"} data-report-product={p.product ?? "none"}>
                    {p.product && <p className="mono text-[var(--muted-foreground)]">#{p.product}</p>}
                    <ul className="grid gap-1">{p.items.map((i, n) => <Item key={n} item={i} done={!!i.done} edits={edits} showDay={false} />)}</ul>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
      {view === "block" && report.map((g) => (
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
