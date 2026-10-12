"use client";

import { useEffect, useState } from "react";
import { usePlanner } from "@/hooks/use-planner";
import { useNow } from "@/hooks/use-now";
import { HabitBoard } from "@/components/planner/habit-board";
import { CaptureBar } from "@/components/planner/capture-bar";
import { Notice, Spinner } from "@/components/planner/page-title";
import { PlanHeader } from "@/components/planner/plan-header";
import { PlanMap } from "@/components/planner/plan-map";
import { StreamEditor } from "@/components/planner/stream-editor";
import { WorkSection } from "@/components/planner/work-section";
import { Row, Tab, View, buildRows, tabOf } from "@/lib/plan-model";
import { dateInTz } from "@/lib/routine";
import { PLANNER_TZ } from "@/lib/streams";
import { vaultApi } from "@/lib/vault-api";
import { HabitsData, StreamChange } from "@/lib/vault-types";

/** A numbered mono strip that titles a section of the sheet. */
function Strip({ n, title, aside }: { n: string; title: string; aside?: string }) {
  return (
    <h2 className="mono flex h-11 items-center justify-between gap-4 border-b border-[var(--border)] px-4 text-[var(--muted-foreground)]">
      <span>{n} / {title}</span>
      {aside && <span className="hidden text-xs font-normal normal-case tracking-normal sm:inline">{aside}</span>}
    </h2>
  );
}

/** Plan: the Super Objective and the week, a map of every block against every horizon, and one work list with a side card. */
export default function PlanPage() {
  const { loading, owner, quarter, quarterError, pipelines, objectives, notebooks, schedule, streams, error, reload } = usePlanner();
  // The page renders a spinner until the plan loads, so reading the browser here cannot cause a hydration mismatch.
  const [picked, setPicked] = useState<string | null>(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("stream")));
  const [view, setViewState] = useState<Omit<View, "stream">>({ tab: "now", tag: null, kind: "all" });
  const [sel, setSel] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // a stream id, "new", or null
  const [problem, setProblem] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [habits, setHabits] = useState<HabitsData | null>(null);
  const [habitPick, setHabitPick] = useState<number | null>(null);
  const now = useNow(60_000);

  useEffect(() => {
    if (owner) vaultApi.habits().then(setHabits).catch(() => setHabits(null));
  }, [owner]);

  /** Habit writes answer with the whole habit list, so the board needs no reload. */
  async function runHabits(action: () => Promise<HabitsData>): Promise<boolean> {
    setProblem(null);
    setMessage("");
    setBusy(true);
    try {
      setHabits(await action());
      return true;
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Could not save");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setProblem(null);
    setMessage("");
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

  function pick(id: string | null) {
    setPicked(id);
    setEditing(null);
    setViewState((v) => ({ ...v, tag: null }));
    window.history.replaceState(null, "", id ? `?stream=${id}` : window.location.pathname);
  }

  if (loading) return <Spinner />;
  if (!owner) return <Notice>The plan is private to the vault owner.</Notice>;
  if (!quarter || !pipelines) return <Notice>{quarterError ?? error ?? "Loading the plan."}</Notice>;

  const stream = streams.find((s) => s.id === picked) ? picked : null;
  const rows = buildRows(pipelines, notebooks);
  const merged: View = { ...view, stream };
  const goal = stream ? quarter.streams.find((s) => s.stream === stream) : undefined;

  async function save(id: string, change: StreamChange & { name: string }, isNew: boolean) {
    const ok = await run(() => (isNew ? vaultApi.addStream(id, change) : vaultApi.updateStream(id, change)));
    if (ok) { setEditing(null); if (isNew) pick(id); }
  }

  function open(row: Row, tab: Tab) {
    setPicked(null);
    setViewState({ tab, tag: null, kind: "all" });
    setSel(row.key);
    window.history.replaceState(null, "", window.location.pathname);
    document.getElementById("plan-work")?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  const editor = editing === "new"
    ? <StreamEditor quarter={quarter} busy={busy} onCancel={() => setEditing(null)} onSave={(c, id) => save(id, c, true)} />
    : editing && editing === stream && goal
      ? <StreamEditor quarter={quarter} stream={goal} busy={busy} onCancel={() => setEditing(null)} onSave={(c, id) => save(id, c, false)} />
      : null;

  return (
    <div className="w-full">
      <PlanHeader quarter={quarter} objectives={objectives} streams={streams} schedule={schedule} today={dateInTz(now, PLANNER_TZ)} busy={busy}
        onSaveObjective={(text) => run(() => vaultApi.setSuperObjective(text, quarter.objective_ar))} />
      {(problem || error) && <p role="alert" className="mb-4 border border-[var(--destructive)] px-4 py-2 text-xs text-[var(--destructive)]">{problem ?? error}</p>}

      <CaptureBar streams={streams} stream={stream} busy={busy} run={run}
        onHabit={async (h) => {
          let added = 0;
          const ok = await runHabits(async () => { const d = await vaultApi.addHabit(h); added = d.habits.length; return d; });
          if (ok) { setMessage("Habit added"); setHabitPick(null); document.getElementById("plan-habits")?.scrollIntoView({ block: "start", behavior: "smooth" }); }
          return ok && added > 0;
        }}
        onAdded={(tab, count) => { setViewState((v) => ({ ...v, tab, tag: null, kind: "all" })); setMessage(count > 1 ? `${count} items added` : "Added"); }} />

      {streams.length === 0 ? (
        <>
          <Notice>No blocks yet. Add one to start planning.</Notice>
          <div className="mt-4">
            <StreamEditor quarter={quarter} busy={busy} onCancel={() => undefined} onSave={(c, id) => save(id, c, true)} />
          </div>
        </>
      ) : (
        <>
          <section aria-label="Map" className="mb-4 border border-[var(--border)] bg-[var(--surface)]">
            <Strip n="01" title="Map" aside="Every block against every horizon. Click an item to open it below." />
            <PlanMap streams={streams} quarter={quarter} notebooks={notebooks} rows={rows} picked={stream} selected={sel} week={pipelines.week}
              onOpen={(r, tab) => open(r, tab)} onPickStream={pick}
              onTag={(s, t) => { setPicked(s); setEditing(null); setViewState((v) => ({ ...v, tab: "now", tag: t })); window.history.replaceState(null, "", `?stream=${s}`); document.getElementById("plan-work")?.scrollIntoView({ block: "start", behavior: "smooth" }); }} />
          </section>

          <section id="plan-work" aria-label="Work" className="border border-[var(--border)] bg-[var(--surface)]">
            <Strip n="02" title="Work" aside={`${rows.filter((r) => r.type === "item" && tabOf(r) !== "done").length} open items${rows.some((r) => r.type === "note" && r.entry.open) ? ` · ${rows.filter((r) => r.type === "note" && r.entry.open).length} blocked` : ""}`} />
            <WorkSection streams={streams} quarter={quarter} pipelines={pipelines} notebooks={notebooks} objectives={objectives} rows={rows}
              view={merged} setView={(patch) => setViewState((v) => ({ ...v, ...patch }))} sel={sel} setSel={setSel}
              picked={stream} onPickStream={pick} editor={editor} onEdit={setEditing} onAddStream={() => setEditing("new")}
              busy={busy} run={run} message={message} />
          </section>
        </>
      )}

      {habits && (
        <section id="plan-habits" aria-label="Habits" className="mt-4 border border-[var(--border)] bg-[var(--surface)]">
          <Strip n="03" title="Habits" aside={`${habits.habits.filter((h) => h.stage === "installing").length} installing · ${habits.habits.filter((h) => h.stage === "rails").length} on rails`} />
          <HabitBoard data={habits} streams={streams} busy={busy} runHabits={runHabits} picked={habitPick} onPick={setHabitPick} />
        </section>
      )}
    </div>
  );
}
