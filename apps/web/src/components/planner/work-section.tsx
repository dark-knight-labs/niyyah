"use client";

import { useEffect, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Checklist } from "@/components/planner/checklist";
import { MonthTrack } from "@/components/planner/month-track";
import { SmallDomino } from "@/components/planner/small-domino";
import { StatusPill } from "@/components/planner/stream-chip";
import { ItemCard, NoteCard } from "@/components/planner/work-card";
import { Row, TABS, View, inScope, inTab, isOpenBlocker, tagTally, waitingOn } from "@/lib/plan-model";
import { MONTH_LABEL, StreamMeta } from "@/lib/streams";
import { vaultApi } from "@/lib/vault-api";
import { NotebooksData, NotebookKind, PipelinesData, QuarterData, VaultObjectivesData } from "@/lib/vault-types";

type Run = (action: () => Promise<unknown>) => Promise<boolean>;

/** A 30px mono strip that titles one cell of a sheet. */
function Strip({ title, aside }: { title: string; aside?: string }) {
  return (
    <h3 className="mono flex h-[30px] items-center justify-between border-b border-[var(--border)] px-3 text-[var(--foreground)]">
      {title}{aside && <span className="font-normal text-[var(--muted-foreground)]">{aside}</span>}
    </h3>
  );
}

const chip = "mono min-h-6 border border-[var(--rule)] px-2 text-[var(--muted-foreground)] hover:bg-[var(--muted)] aria-pressed:border-[var(--foreground)] aria-pressed:bg-[var(--foreground)] aria-pressed:text-[var(--background)]";

interface Props {
  streams: StreamMeta[];
  quarter: QuarterData;
  pipelines: PipelinesData;
  notebooks: NotebooksData | null;
  objectives: VaultObjectivesData | null;
  rows: Row[];
  view: View;
  setView: (patch: Partial<View>) => void;
  sel: string | null;
  setSel: (key: string | null) => void;
  /** The block the page is narrowed to (also in the URL), or null for All. */
  picked: string | null;
  onPickStream: (id: string | null) => void;
  /** The stream editor, when it is open. */
  editor: React.ReactNode;
  onEdit: (id: string) => void;
  onAddStream: () => void;
  busy: boolean;
  run: Run;
  message: string;
}

/** The work list: tabs, a block filter, a Gmail-dense list of items and notes, and a side card for the selected row. */
export function WorkSection({ streams, quarter, pipelines, notebooks, objectives, rows, view, setView, sel, setSel, picked, onPickStream, editor, onEdit, onAddStream, busy, run, message }: Props) {
  const [idx, setIdx] = useState(0);
  const scoped = rows.filter((r) => inScope(r, view));
  const shown = scoped.filter((r) => inTab(r, view.tab, view.kind));
  const active = shown.find((r) => r.key === sel) ?? shown[Math.min(idx, shown.length - 1)] ?? null;
  const meta = (id: string) => streams.find((s) => s.id === id);
  const entriesOf = (id: string) => notebooks?.streams.find((n) => n.stream === id)?.entries ?? [];
  const blockedIn = (id: string) => entriesOf(id).filter(isOpenBlocker).length;
  const openIn = (id: string | null) => rows.filter((r) => r.type === "item" && r.item.lane !== "done" && (!id || r.stream === id)).length;
  const select = (r: Row, i: number) => { setSel(r.key); setIdx(i); };
  const picks = picked ? meta(picked) : undefined;
  const goal = picks ? quarter.streams.find((s) => s.stream === picks.id) : undefined;
  const scopeRows = rows.filter((r) => !view.stream || r.stream === view.stream);
  const tags = tagTally(scopeRows);
  const openBlockers = (picked ? entriesOf(picked) : streams.flatMap((s) => entriesOf(s.id))).filter(isOpenBlocker);
  const stale = scoped.filter((r) => r.type === "item" && r.item.stale && r.item.lane !== "done").length;
  const links = scoped.filter((r) => r.type === "note" && r.entry.url) as Extract<Row, { type: "note" }>[];
  const weekly = streams.filter((s) => s.weekly && (!picked || s.id === picked));

  function toggle(r: Row) {
    if (r.type === "item") return run(() => vaultApi.movePipelineItem(r.stream, r.item, r.item.lane === "done" ? "next" : "done"));
    if (r.entry.kind === "blocker") return run(() => vaultApi.setBlocker(r.stream, r.entry, !r.entry.open));
    return run(() => vaultApi.addPipelineItems(r.stream, [r.entry.title], "backlog", [r.entry.body]));
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (!t || e.metaKey || e.ctrlKey || e.altKey) return;
      if (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.closest("[role=menu]")) return;
      if (e.key === "/") { e.preventDefault(); document.getElementById("plan-capture")?.focus(); return; }
      const i = active ? shown.findIndex((r) => r.key === active.key) : -1;
      if (e.key === "j" && i < shown.length - 1) { setSel(shown[i + 1].key); setIdx(i + 1); }
      else if (e.key === "k" && i > 0) { setSel(shown[i - 1].key); setIdx(i - 1); }
      else if (e.key === "x" && active) void toggle(active);
      else if (e.key === "s" && active?.type === "item" && meta(active.stream)?.weekly) void run(() => vaultApi.focusPipelineItem(active.stream, active.item));
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const count = (tab: View["tab"]) => scoped.filter((r) => inTab(r, tab, view.kind)).length;
  const nowLimit = pipelines.now_limit;
  const nowOver = (picked ? [picked] : streams.map((s) => s.id)).some((id) => scoped.filter((r) => r.stream === id && inTab(r, "now")).length > nowLimit);

  return (
    <>
      <div className="flex flex-wrap justify-between border-b border-[var(--border)]">
        <div role="tablist" aria-label="Horizon" className="flex max-w-full overflow-x-auto">
          {TABS.map((t) => {
            const n = count(t.id);
            return (
              <button key={t.id} type="button" role="tab" aria-selected={view.tab === t.id} onClick={() => setView({ tab: t.id })}
                className="mono flex min-h-10 items-center gap-2 border-r border-[var(--border)] px-4 text-[var(--muted-foreground)] hover:bg-[var(--muted)] aria-selected:bg-[var(--muted)] aria-selected:text-[var(--foreground)] aria-selected:shadow-[inset_0_-2px_0_var(--accent)]">
                {t.label}
                <span className="font-normal tabular-nums" style={t.id === "now" && nowOver ? { color: "var(--warn)" } : undefined}>{t.id === "now" && picked ? `${n}/${nowLimit}` : n}</span>
              </button>
            );
          })}
        </div>
        <div role="group" aria-label="Block" className="flex max-w-full flex-wrap border-l border-[var(--border)]">
          <button type="button" aria-pressed={!picked} onClick={() => onPickStream(null)}
            className="mono flex min-h-10 items-center gap-2 border-r border-[var(--border)] px-4 text-[var(--muted-foreground)] hover:bg-[var(--muted)] aria-pressed:bg-[var(--muted)] aria-pressed:text-[var(--foreground)] aria-pressed:shadow-[inset_0_-2px_0_var(--accent)]">
            All <span className="font-normal tabular-nums">{openIn(null)}</span>
          </button>
          {streams.map((s) => (
            <button key={s.id} type="button" aria-pressed={picked === s.id} onClick={() => onPickStream(picked === s.id ? null : s.id)} title={s.label}
              className="mono flex min-h-10 items-center gap-2 border-r border-[var(--border)] px-4 text-[var(--muted-foreground)] hover:bg-[var(--muted)] aria-pressed:bg-[var(--muted)] aria-pressed:text-[var(--foreground)] aria-pressed:shadow-[inset_0_-2px_0_var(--accent)]">
              <span className="h-2 w-2 shrink-0" style={{ background: s.color }} aria-hidden="true" />{s.label}
              {blockedIn(s.id) > 0 && <span className="text-[var(--destructive)]">{blockedIn(s.id)} blocked</span>}
              <span className="font-normal tabular-nums">{openIn(s.id)}</span>
            </button>
          ))}
          <button type="button" onClick={onAddStream} aria-label="Add a block" className="mono flex min-h-10 items-center gap-1.5 px-4 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--accent)]">
            <Plus size={13} aria-hidden="true" />Block
          </button>
        </div>
      </div>

      {picks && !editor && (
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--border)] px-4 py-2.5">
          <span className="h-2.5 w-2.5 shrink-0" style={{ background: picks.color }} aria-hidden="true" />
          <h2 className="text-[0.9375rem] font-medium">{picks.label}</h2>
          <span className="min-w-0 truncate text-xs text-[var(--muted-foreground)]">{picks.slot || "No slot set"}</span>
          <StatusPill status={picks.status} />
          <span className="flex-1" />
          {goal && (
            <button type="button" aria-label={`Edit ${picks.label}`} title="Edit the block" onClick={() => onEdit(picks.id)}
              className="mono inline-flex h-7 items-center gap-1.5 border border-[var(--rule)] px-2.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"><Pencil size={12} aria-hidden="true" />Edit</button>
          )}
        </header>
      )}
      {editor && <div className="border-b border-[var(--border)] p-4">{editor}</div>}

      {picks && goal && !editor ? (
        <section aria-label="Goal, months and small domino" className="grid border-b border-[var(--border)] bg-[var(--surface)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <Strip title="Quarter goal" />
            <div className="px-3 py-2">
              <Checklist label={`${picks.label} quarter goal`} items={goal.goal_checklist} busy={busy} placeholder="Add a line to the goal"
                onToggle={(item, done) => run(() => vaultApi.tickStreamItem(picks.id, "goal", item.id, done))}
                onChange={(lines) => run(() => vaultApi.updateStream(picks.id, { goal_checklist: lines }))} />
            </div>
          </div>
          <div className="min-w-0 border-t border-[var(--border)] lg:border-l lg:border-t-0">
            <Strip title="Months" aside={`${MONTH_LABEL[quarter.current_month]} is now`} />
            <div className="px-3 py-2">
              <MonthTrack months={quarter.months} checkpoints={goal.checkpoints} current={quarter.current_month} color={picks.color} busy={busy}
                onToggle={(month, item, done) => run(() => vaultApi.tickStreamItem(picks.id, month, item.id, done))}
                onChange={(month, lines) => run(() => vaultApi.updateStream(picks.id, { month_checklists: { [month]: lines } }))} />
            </div>
          </div>
          <div className="min-w-0 border-t border-[var(--border)] lg:border-l lg:border-t-0">
            <Strip title="Small domino" aside="This week" />
            <div className="px-3 py-2">
              <SmallDomino meta={picks} objective={objectives?.items.find((o) => o.stream === picks.id) ?? null}
                pool={rows.flatMap((r) => (r.type === "item" && r.stream === picks.id && r.item.lane !== "done" ? [r.item] : []))} run={run}
                onPick={(item) => void run(() => vaultApi.focusPipelineItem(picks.id, item))} />
            </div>
          </div>
        </section>
      ) : !picks && weekly.length > 0 && (
        <div className="border-b border-[var(--border)]">
          {weekly.map((s) => (
            <div key={s.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 border-b border-[var(--border)] px-4 py-2 last:border-b-0">
              <span className="mono flex min-h-9 w-[13rem] shrink-0 items-center gap-2 text-[var(--muted-foreground)]"><span className="h-2 w-2" style={{ background: s.color }} aria-hidden="true" />Small domino · {s.label}</span>
              <div className="min-w-0 flex-1 basis-64">
                <SmallDomino meta={s} objective={objectives?.items.find((o) => o.stream === s.id) ?? null}
                  pool={rows.flatMap((r) => (r.type === "item" && r.stream === s.id && r.item.lane !== "done" ? [r.item] : []))} run={run}
                  onPick={(item) => void run(() => vaultApi.focusPipelineItem(s.id, item))} />
              </div>
            </div>
          ))}
        </div>
      )}

      {openBlockers.length > 0 && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-[var(--border)] border-l-2 border-l-[var(--destructive)] bg-[var(--warn-light)] px-4 py-2.5 text-sm">
          <b className="font-semibold text-[var(--destructive)]">{openBlockers.length} open blocker{openBlockers.length > 1 ? "s" : ""}</b>
          <span className="min-w-0 break-words text-[var(--muted-foreground)]">{openBlockers.map((b) => b.title).join(" · ")}</span>
        </div>
      )}

      {(tags.length > 0 || view.tab === "notes") && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-[var(--border)] px-4 py-2">
          {view.tab === "notes" && (
            <div role="group" aria-label="Kind" className="flex flex-wrap items-center gap-1.5">
              <span className="mono mr-1 text-[var(--muted-foreground)]">Kind</span>
              {(["all", "idea", "meeting", "blocker"] as (NotebookKind | "all")[]).map((k) => (
                <button key={k} type="button" aria-pressed={view.kind === k} onClick={() => setView({ kind: k })} className={chip}>
                  {k} {scopeRows.filter((r) => r.type === "note" && (k === "all" || r.entry.kind === k)).length}
                </button>
              ))}
            </div>
          )}
          {tags.length > 0 && (
            <div role="group" aria-label="Tags" className="flex flex-wrap items-center gap-1.5">
              <span className="mono mr-1 text-[var(--muted-foreground)]">Tags</span>
              {tags.map(([t, n]) => (
                <button key={t} type="button" aria-pressed={view.tag === t} onClick={() => setView({ tag: view.tag === t ? null : t })} className={chip}>#{t} {n}</button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid lg:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="min-w-0">
          <div role="listbox" aria-label="Work items">
            {shown.length === 0 && (
              <p className="px-4 py-8 text-sm text-[var(--muted-foreground)]">
                {view.tab === "notes" ? "No notes here. Write one in the box above." : view.tab === "now" ? "Nothing committed. Promote one from Next." : `Nothing in ${view.tab} for this filter.`}
              </p>
            )}
            {shown.map((r, i) => {
              const m = meta(r.stream);
              const here = active?.key === r.key;
              const done = r.type === "item" && r.item.lane === "done";
              const blocked = r.type === "item" && waitingOn(r.item, entriesOf(r.stream)).some((w) => w.found);
              const one = r.type === "item" && r.item.focus === pipelines.week;
              const clearedBlocker = r.type === "note" && r.entry.kind === "blocker" && !r.entry.open;
              const title = r.type === "item" ? r.item.text : r.entry.title;
              const snippet = r.type === "item" ? r.item.description : r.entry.body;
              return (
                <div key={r.key} role="option" aria-selected={here} tabIndex={-1} onClick={() => select(r, i)}
                  className={`grid min-h-10 cursor-default grid-cols-[2.5rem_2rem_minmax(0,1fr)_3.5rem] items-center border-b border-[var(--border)] md:grid-cols-[2.5rem_2rem_9.5rem_minmax(0,1fr)_auto_3.5rem] ${here ? "bg-[var(--muted)] shadow-[inset_2px_0_0_var(--accent)]" : "hover:bg-[var(--surface)]"}`}>
                  <button type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); void toggle(r); }}
                    aria-label={r.type === "note" ? (r.entry.kind === "blocker" ? (r.entry.open ? "Mark cleared" : "Reopen blocker") : "Promote to Someday") : done ? "Reopen" : "Mark done"}
                    className="grid h-10 w-10 place-items-center">
                    <span className={`grid h-3.5 w-3.5 place-items-center border text-[11px] leading-none ${done || clearedBlocker ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]" : "border-[var(--rule)] bg-[var(--surface)] text-[var(--muted-foreground)]"}`}>
                      {r.type === "note" && r.entry.kind !== "blocker" ? "→" : done || clearedBlocker ? "✓" : ""}
                    </span>
                  </button>
                  {r.type === "item" && m?.weekly ? (
                    <button type="button" disabled={busy} aria-pressed={one} aria-label={one ? "This week's small domino" : "Make this the small domino"}
                      onClick={(e) => { e.stopPropagation(); if (!one) void run(() => vaultApi.focusPipelineItem(r.stream, r.item)); }}
                      className={`h-10 w-8 text-[0.9375rem] ${one ? "text-[var(--warn)]" : "text-[var(--muted-foreground)] opacity-60 hover:text-[var(--warn)] hover:opacity-100"}`}>{one ? "★" : "☆"}</button>
                  ) : <span />}
                  <span className="mono hidden items-center gap-2 pr-2 text-[var(--muted-foreground)] md:flex"><span className="h-2 w-2 shrink-0" style={{ background: m?.color }} aria-hidden="true" /><span className="truncate">{m?.label}</span></span>
                  <div className={`min-w-0 truncate pr-3 ${done || clearedBlocker ? "text-[var(--muted-foreground)] line-through" : ""}`}>
                    <b className={`font-semibold ${blocked ? "text-[var(--destructive)]" : ""}`}>{title}</b>
                    {snippet && <span className="text-[var(--muted-foreground)]"> — {snippet.split("\n")[0]}</span>}
                  </div>
                  <div className="hidden items-center gap-1.5 pr-3 md:flex">
                    {r.type === "note" && <span className={`mono border px-1.5 py-0.5 ${r.entry.kind === "blocker" && r.entry.open ? "border-[var(--destructive)] bg-[var(--warn-light)] text-[var(--destructive)]" : "border-[var(--rule)] text-[var(--muted-foreground)]"}`}>{r.entry.kind}</span>}
                    {blocked && <span className="mono border border-[var(--destructive)] bg-[var(--warn-light)] px-1.5 py-0.5 text-[var(--destructive)]">Blocked</span>}
                    {r.type === "item" && !done && !r.item.checkpoint && r.item.stale && <span className="mono border border-[var(--warn)] bg-[var(--warn-light)] px-1.5 py-0.5 text-[var(--warn)]">No checkpoint · {r.item.age_days}d</span>}
                    {r.type === "item" && r.item.checkpoint && <span className="mono border border-[var(--rule)] px-1.5 py-0.5">{MONTH_LABEL[r.item.checkpoint]}</span>}
                    {one && <span className="mono border border-[var(--accent)] px-1.5 py-0.5 text-[var(--accent)]">Small domino</span>}
                    {r.type === "item" && (r.item.products ?? []).map((t) => (
                      <button key={t} type="button" onClick={(e) => { e.stopPropagation(); setView({ tag: view.tag === t ? null : t }); }} className="mono text-[var(--muted-foreground)] hover:text-[var(--accent)]">#{t}</button>
                    ))}
                  </div>
                  <span className="mono pr-4 text-right tabular-nums text-[var(--muted-foreground)]">{done && r.type === "item" && r.item.done_on ? r.item.done_on.slice(5) : r.type === "item" ? (r.item.age_days ? `${r.item.age_days}d` : "today") : r.entry.date?.slice(5) ?? ""}</span>
                </div>
              );
            })}
          </div>
          {(stale > 0 || view.tab === "notes") && (
            <div className="grid gap-2 border-b border-[var(--border)] px-4 py-3 text-small">
              {stale > 0 && view.tab !== "notes" && <p className="text-[var(--warn)]">{stale} without a checkpoint for {pipelines.stale_days}+ days. If no month needs it, it may not be a domino.</p>}
              {view.tab === "notes" && (
                <>
                  <p className="mono text-[var(--muted-foreground)]">Links</p>
                  {links.length === 0 && <p className="text-[var(--muted-foreground)]">Links from your notes appear here.</p>}
                  {links.map((l) => <a key={l.key} href={l.entry.url ?? "#"} target="_blank" rel="noopener noreferrer" className="break-all text-[var(--accent)] underline underline-offset-2">{l.entry.title}</a>)}
                </>
              )}
            </div>
          )}
          <p className="mono flex flex-wrap gap-x-5 gap-y-1 px-4 py-2.5 text-[var(--muted-foreground)]">
            <span>J K move</span><span>X done</span><span>S small domino</span><span>/ capture</span>
            {message && <span className="text-[var(--accent)]" role="status">{message}</span>}
          </p>
        </div>

        <aside aria-live="polite" className="grid content-start gap-4 border-t border-[var(--border)] bg-[var(--surface)] p-4 lg:border-l lg:border-t-0">
          {!active && <p className="text-small text-[var(--muted-foreground)]">Select a row. J and K move, X marks it done.</p>}
          {active?.type === "item" && meta(active.stream) && (
            <ItemCard key={active.key} row={active} meta={meta(active.stream)!} goal={quarter.streams.find((g) => g.stream === active.stream)} months={quarter.months}
              blockers={entriesOf(active.stream).filter((e) => e.kind === "blocker")} week={pipelines.week} staleDays={pipelines.stale_days} busy={busy} run={run} />
          )}
          {active?.type === "note" && meta(active.stream) && <NoteCard key={active.key} row={active} meta={meta(active.stream)!} busy={busy} run={run} />}
        </aside>
      </div>
    </>
  );
}
