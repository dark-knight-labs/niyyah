"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Pencil, Plus } from "lucide-react";
import { usePlanner } from "@/hooks/use-planner";
import { useNow } from "@/hooks/use-now";
import { Checklist } from "@/components/planner/checklist";
import { MonthTrack } from "@/components/planner/month-track";
import { Notebook } from "@/components/planner/notebook";
import { Notice, Spinner } from "@/components/planner/page-title";
import { PipelineBoard } from "@/components/planner/pipeline-board";
import { PlanHeader } from "@/components/planner/plan-header";
import { SmallDomino } from "@/components/planner/small-domino";
import { StatusPill } from "@/components/planner/stream-chip";
import { StreamEditor } from "@/components/planner/stream-editor";
import { dateInTz } from "@/lib/routine";
import { MONTH_LABEL, PLANNER_TZ } from "@/lib/streams";
import { vaultApi } from "@/lib/vault-api";
import { StreamChange } from "@/lib/vault-types";

// v2: the stream list opens by default; an earlier collapsed choice is not carried over.
/** A 30px mono strip that titles one cell of the stream sheet. */
function Strip({ title, aside }: { title: string; aside?: string }) {
  return (
    <h3 className="mono flex h-[30px] items-center justify-between border-b border-[var(--border)] px-3 text-[var(--foreground)]">
      {title}{aside && <span className="font-normal text-[var(--muted-foreground)]">{aside}</span>}
    </h3>
  );
}

const RAIL_KEY = "niyyah-plan-rail-v2";

/** Plan: the Super Objective, the week, and each stream's goal, small domino, pipeline and notebook in one place. */
export default function PlanPage() {
  const { loading, owner, quarter, quarterError, pipelines, objectives, notebooks, schedule, streams, error, reload } = usePlanner();
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
      <PlanHeader quarter={quarter} objectives={objectives} streams={streams} schedule={schedule} today={dateInTz(now, PLANNER_TZ)} busy={busy}
        onSaveObjective={(text) => run(() => vaultApi.setSuperObjective(text, quarter.objective_ar))} />
      {(problem || error) && <p role="alert" className="mb-4 rounded-xl border border-[var(--destructive)] px-4 py-2 text-xs text-[var(--destructive)]">{problem ?? error}</p>}

      <div className={`grid gap-4 ${collapsed ? "lg:grid-cols-[3.25rem_minmax(0,1fr)]" : "lg:grid-cols-[12rem_minmax(0,1fr)]"}`}>
        <div className="relative min-w-0">
        <nav aria-label="Streams" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] lg:mx-0 lg:grid lg:gap-0.5 lg:overflow-visible lg:p-0 [&::-webkit-scrollbar]:hidden">
          <div className={`hidden min-h-8 items-center ${collapsed ? "justify-center" : "justify-between px-2.5"} lg:flex`}>
            {!collapsed && <p className="mono text-[var(--muted-foreground)]">Streams</p>}
            <button type="button" onClick={toggleRail} aria-expanded={!collapsed} aria-label={collapsed ? "Expand the stream list" : "Collapse the stream list"}
              title={collapsed ? "Expand the stream list" : "Collapse the stream list"}
              className="grid h-6 w-6 place-items-center text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
              {collapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronLeft size={14} aria-hidden="true" />}
            </button>
          </div>
          {streams.map((s) => {
            const on = s.id === meta?.id;
            const blocked = blockedCount(s.id);
            return (
              <button key={s.id} type="button" onClick={() => pick(s.id)} aria-current={on ? "true" : undefined} title={s.label}
                className={`flex min-h-8 shrink-0 items-center gap-2.5 border-l-2 border-transparent px-2.5 text-left text-small font-medium transition hover:bg-[var(--muted)] aria-[current=true]:border-[var(--accent)] aria-[current=true]:bg-[var(--muted)] ${collapsed ? "lg:justify-center lg:px-0" : ""}`}
                >
                <span className="h-2 w-2 shrink-0" style={{ background: s.color }} aria-hidden="true" />
                <span className={collapsed ? "lg:sr-only" : "min-w-0 flex-1 truncate"}>{s.label}</span>
                {!collapsed && (
                  <span className="shrink-0 text-micro font-medium tabular-nums text-[var(--muted-foreground)]">
                    {blocked > 0 && <span className="mr-1.5 font-bold text-[var(--destructive)]">{blocked} blocked</span>}{openCount(s.id)}
                  </span>
                )}
              </button>
            );
          })}
          <button type="button" onClick={() => setEditing("new")} aria-label="Add a stream" title="Add a stream"
            className={`flex min-h-8 shrink-0 items-center gap-2.5 px-2.5 text-small font-medium text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--accent)] ${collapsed ? "lg:justify-center lg:px-0" : ""}`}>
            <Plus size={16} aria-hidden="true" className="shrink-0" />
            <span className={collapsed ? "lg:sr-only" : ""}>Add a stream</span>
          </button>
        </nav>
        </div>

        <div className="grid min-w-0 gap-4">
          {editing === "new" && <StreamEditor quarter={quarter} busy={busy} onCancel={() => setEditing(null)} onSave={(c, id) => save(id, c, true)} />}
          {!meta ? (
            editing !== "new" && <Notice>No streams yet. Use “Add a stream”.</Notice>
          ) : editing === meta.id && goal ? (
            <StreamEditor quarter={quarter} stream={goal} busy={busy} onCancel={() => setEditing(null)} onSave={(c, id) => save(id, c, false)} />
          ) : (
            <>
              <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="h-2.5 w-2.5 shrink-0" style={{ background: meta.color }} aria-hidden="true" />
                <h2 className="text-[0.9375rem] font-medium">{meta.label}</h2>
                <span className="min-w-0 truncate text-xs text-[var(--muted-foreground)]">{meta.slot || "No slot set"}</span>
                <StatusPill status={meta.status} />
                <span className="flex-1" />
                {openBlockers.length > 0 && <span className="mono text-[var(--destructive)]" title={openBlockers.map((b) => b.title).join(" · ")}>{openBlockers.length} open blocker{openBlockers.length > 1 ? "s" : ""}</span>}
                {goal && (
                  <button type="button" aria-label={`Edit ${meta.label}`} title="Edit the stream" onClick={() => setEditing(meta.id)}
                    className="mono inline-flex h-7 items-center gap-1.5 border border-[var(--rule)] px-2.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"><Pencil size={12} aria-hidden="true" />Edit</button>
                )}
              </header>

              <section aria-label="Goal, months and small domino" className="grid border border-[var(--border)] bg-[var(--surface)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1fr)]">
                <div className="min-w-0">
                  <Strip title="Quarter goal" />
                  <div className="px-3 py-2">
                    {goal && (
                      <Checklist label={`${meta.label} quarter goal`} items={goal.goal_checklist} busy={busy} placeholder="Add a line to the goal"
                        onToggle={(item, done) => run(() => vaultApi.tickStreamItem(meta.id, "goal", item.id, done))}
                        onChange={(lines) => run(() => vaultApi.updateStream(meta.id, { goal_checklist: lines }))} />
                    )}
                  </div>
                </div>
                <div className="min-w-0 border-t border-[var(--border)] lg:border-l lg:border-t-0">
                  <Strip title="Months" aside={`${MONTH_LABEL[quarter.current_month]} is now`} />
                  <div className="px-3 py-2">
                    {goal && (
                      <MonthTrack months={quarter.months} checkpoints={goal.checkpoints} current={quarter.current_month} color={meta.color} busy={busy}
                        onToggle={(month, item, done) => run(() => vaultApi.tickStreamItem(meta.id, month, item.id, done))}
                        onChange={(month, lines) => run(() => vaultApi.updateStream(meta.id, { month_checklists: { [month]: lines } }))} />
                    )}
                  </div>
                </div>
                <div className="min-w-0 border-t border-[var(--border)] lg:border-l lg:border-t-0">
                  <Strip title="Small domino" aside="This week" />
                  <div className="px-3 py-2">
                    <SmallDomino meta={meta} objective={objective} pool={items.filter((i) => i.lane !== "done")} run={run}
                      onPick={(item) => void run(() => vaultApi.focusPipelineItem(meta.id, item))} />
                  </div>
                </div>
              </section>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:items-start">
                <section aria-label="Pipeline" className="min-w-0 border border-[var(--border)] bg-[var(--surface)] p-3">
                  <PipelineBoard key={meta.id} stream={meta.id} meta={meta} pipelines={pipelines} blockers={blockers} busy={busy} run={run} stacked />
                </section>
                <section aria-label="Notebook" className="min-w-0 border border-[var(--border)] bg-[var(--surface)] p-3">
                  <h2 className="mono mb-2 flex h-[30px] items-center justify-between border-b border-[var(--border)] text-[var(--foreground)]">Notebook <span className="font-normal text-[var(--muted-foreground)]">{entries.length}</span></h2>
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
