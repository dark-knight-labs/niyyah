"use client";

import { useState } from "react";
import { PanelLeftClose, PanelLeftOpen, Pencil, Plus } from "lucide-react";
import { usePlanner } from "@/hooks/use-planner";
import { useNow } from "@/hooks/use-now";
import { MonthTrack } from "@/components/planner/month-track";
import { Notebook } from "@/components/planner/notebook";
import { Notice, Spinner } from "@/components/planner/page-title";
import { PipelineBoard } from "@/components/planner/pipeline-board";
import { PlanHeader } from "@/components/planner/plan-header";
import { SmallDomino } from "@/components/planner/small-domino";
import { StatusPill, StreamIcon } from "@/components/planner/stream-chip";
import { StreamEditor } from "@/components/planner/stream-editor";
import { dateInTz } from "@/lib/routine";
import { PLANNER_TZ } from "@/lib/streams";
import { vaultApi } from "@/lib/vault-api";
import { StreamChange } from "@/lib/vault-types";

const RAIL_KEY = "niyyah-plan-rail";

/** Plan: the Super Objective, the week, and each block's goal, small domino, pipeline and notebook in one place. */
export default function PlanPage() {
  const { loading, owner, quarter, quarterError, pipelines, objectives, notebooks, streams, error, reload } = usePlanner();
  // The page renders a spinner until the plan loads, so reading the browser here cannot cause a hydration mismatch.
  const [picked, setPicked] = useState<string | null>(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("stream")));
  const [collapsed, setCollapsed] = useState(() => {
    try { return typeof window !== "undefined" && localStorage.getItem(RAIL_KEY) === "1"; } catch { return false; }
  });
  const [editing, setEditing] = useState<string | null>(null); // a stream id, "new", or null
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useNow(60_000);

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setProblem(null);
    setBusy(true);
    try {
      await action();
      await reload();
      return true;
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Could not save");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function pick(id: string) {
    setPicked(id);
    setEditing(null);
    window.history.replaceState(null, "", `?stream=${id}`);
  }

  function toggleRail() {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(RAIL_KEY, next ? "1" : "0"); } catch { /* the rail still works for this visit */ }
  }

  if (loading) return <Spinner />;
  if (!owner) return <Notice>The plan is private to the vault owner.</Notice>;
  if (!quarter || !pipelines) return <Notice>{quarterError ?? error ?? "Loading the plan."}</Notice>;

  const meta = streams.find((s) => s.id === picked) ?? streams[0];
  const goal = meta ? quarter.streams.find((s) => s.stream === meta.id) : undefined;
  const items = meta ? pipelines.streams.find((s) => s.stream === meta.id)?.items ?? [] : [];
  const objective = meta ? objectives?.items.find((o) => o.stream === meta.id) ?? null : null;
  const entries = meta ? notebooks?.streams.find((s) => s.stream === meta.id)?.entries ?? [] : [];
  const blockers = entries.filter((e) => e.kind === "blocker");
  const openBlockers = blockers.filter((e) => e.open);
  const openCount = (id: string) => pipelines.streams.find((s) => s.stream === id)?.items.filter((i) => i.lane !== "done").length ?? 0;
  const blockedCount = (id: string) => notebooks?.streams.find((s) => s.stream === id)?.entries.filter((e) => e.kind === "blocker" && e.open).length ?? 0;

  async function save(id: string, change: StreamChange & { name: string }, isNew: boolean) {
    const ok = await run(() => (isNew ? vaultApi.addStream(id, change) : vaultApi.updateStream(id, change)));
    if (ok) { setEditing(null); if (isNew) pick(id); }
  }

  return (
    <div className="w-full">
      <PlanHeader quarter={quarter} objectives={objectives} streams={streams} today={dateInTz(now, PLANNER_TZ)} busy={busy}
        onSaveObjective={(text) => run(() => vaultApi.setSuperObjective(text, quarter.objective_ar))} />
      {(problem || error) && <p role="alert" className="mb-4 rounded-xl border border-[var(--destructive)] px-4 py-2 text-xs text-[var(--destructive)]">{problem ?? error}</p>}

      <div className={`grid gap-6 lg:items-start ${collapsed ? "lg:grid-cols-[3.25rem_minmax(0,1fr)]" : "lg:grid-cols-[13rem_minmax(0,1fr)]"}`}>
        <nav aria-label="Blocks" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] lg:mx-0 lg:grid lg:gap-0.5 lg:overflow-visible lg:p-0 [&::-webkit-scrollbar]:hidden">
          <button type="button" onClick={toggleRail} aria-expanded={!collapsed} aria-label={collapsed ? "Expand the block list" : "Collapse the block list"}
            className="hidden min-h-10 items-center gap-2 rounded-lg px-2.5 text-[11px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)] hover:bg-[var(--muted)] lg:flex">
            {collapsed ? <PanelLeftOpen size={16} aria-hidden="true" /> : <><PanelLeftClose size={16} aria-hidden="true" /> Blocks</>}
          </button>
          {streams.map((s) => {
            const on = s.id === meta?.id;
            const blocked = blockedCount(s.id);
            return (
              <button key={s.id} type="button" onClick={() => pick(s.id)} aria-current={on ? "true" : undefined} title={s.label}
                className={`flex min-h-11 shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-left text-sm font-semibold transition hover:bg-[var(--muted)] ${collapsed ? "lg:justify-center lg:px-0" : ""}`}
                style={on ? { background: `color-mix(in srgb, ${s.color} 12%, var(--background))` } : undefined}>
                <s.icon size={16} style={{ color: s.color }} aria-hidden="true" className="shrink-0" />
                <span className={collapsed ? "lg:sr-only" : "min-w-0 flex-1 truncate"}>{s.label}</span>
                {!collapsed && (
                  <span className="shrink-0 text-[11px] font-medium tabular-nums text-[var(--muted-foreground)]">
                    {blocked > 0 && <span className="mr-1.5 font-bold text-[var(--destructive)]">{blocked} blocked</span>}{openCount(s.id)}
                  </span>
                )}
              </button>
            );
          })}
          <button type="button" onClick={() => setEditing("new")} aria-label="Add a block" title="Add a block"
            className={`flex min-h-11 shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-sm font-semibold text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--accent)] ${collapsed ? "lg:justify-center lg:px-0" : ""}`}>
            <Plus size={16} aria-hidden="true" className="shrink-0" />
            <span className={collapsed ? "lg:sr-only" : ""}>Add a block</span>
          </button>
        </nav>

        <div className="grid min-w-0 gap-6">
          {editing === "new" && <StreamEditor quarter={quarter} busy={busy} onCancel={() => setEditing(null)} onSave={(c, id) => save(id, c, true)} />}
          {!meta ? (
            editing !== "new" && <Notice>No blocks yet. Use “Add a block”.</Notice>
          ) : editing === meta.id && goal ? (
            <StreamEditor quarter={quarter} stream={goal} busy={busy} onCancel={() => setEditing(null)} onSave={(c, id) => save(id, c, false)} />
          ) : (
            <>
              <header className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] pb-4">
                <StreamIcon stream={meta} size={40} />
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-extrabold uppercase tracking-[0.08em]" style={{ color: meta.color }}>{meta.label}</h2>
                  <p className="truncate text-xs text-[var(--muted-foreground)]">{meta.slot || "No slot set"}</p>
                </div>
                <StatusPill status={meta.status} />
                {goal && (
                  <button type="button" aria-label={`Edit ${meta.label}`} title="Edit the block" onClick={() => setEditing(meta.id)}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"><Pencil size={15} /></button>
                )}
              </header>

              <section aria-label="Goal and small domino" className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:gap-10">
                <div className="grid gap-4">
                  <p className={`text-[15px] font-semibold leading-snug ${goal?.goal ? "" : "text-[var(--muted-foreground)]"}`}>{goal?.goal || "No goal yet. Edit the block to set one."}</p>
                  {goal && <MonthTrack checkpoints={goal.checkpoints} current={quarter.current_month} color={meta.color} />}
                </div>
                <div>
                  <p className="mb-1 text-[10px] font-extrabold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">Small domino · this week</p>
                  <SmallDomino meta={meta} objective={objective} pool={items.filter((i) => i.lane !== "done")} run={run}
                    onPick={(item) => void run(() => vaultApi.focusPipelineItem(meta.id, item))} />
                </div>
              </section>

              {openBlockers.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-[var(--destructive)] px-3.5 py-2.5 text-sm">
                  <b className="text-[var(--destructive)]">{openBlockers.length} open blocker{openBlockers.length > 1 ? "s" : ""}</b>
                  <span className="min-w-0 break-words text-[var(--muted-foreground)]">{openBlockers.map((b) => b.title).join(" · ")}</span>
                </div>
              )}

              <div className="grid gap-8 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] xl:items-start">
                <section aria-label="Pipeline" className="min-w-0">
                  <h2 className="mb-3 text-xs font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">Pipeline</h2>
                  <PipelineBoard key={meta.id} stream={meta.id} meta={meta} pipelines={pipelines} blockers={blockers} busy={busy} run={run} stacked />
                </section>
                <section aria-label="Notebook" className="min-w-0">
                  <h2 className="mb-3 text-xs font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">Notebook <span className="font-medium normal-case tracking-normal tabular-nums">· {entries.length}</span></h2>
                  <Notebook key={meta.id} meta={meta} entries={entries} busy={busy} run={run} compact />
                </section>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
