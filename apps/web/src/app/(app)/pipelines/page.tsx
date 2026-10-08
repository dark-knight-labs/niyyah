"use client";

import { useEffect, useState } from "react";
import { usePlanner } from "@/hooks/use-planner";
import { ChainCrumbs } from "@/components/planner/chain-crumbs";
import { Notice, PageTitle, Spinner } from "@/components/planner/page-title";
import { Notebook } from "@/components/planner/notebook";
import { PipelineBoard } from "@/components/planner/pipeline-board";
import { StreamIcon } from "@/components/planner/stream-chip";
import { NotebookKind } from "@/lib/vault-types";

export default function PipelinesPage() {
  const { loading, owner, quarter, pipelines, objectives, notebooks, streams, error, reload } = usePlanner();
  const [picked, setPicked] = useState<string | null>(null);
  const [tab, setTab] = useState<"board" | "notebook">("board");
  const [nbFilter, setNbFilter] = useState<NotebookKind | "all">("all");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    setPicked(query.get("stream"));
    if (query.get("tab") === "notebook") setTab("notebook");
  }, []);

  async function run(action: () => Promise<unknown>) {
    setProblem(null);
    setBusy(true);
    try {
      await action();
      await reload();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner />;
  if (!owner) return <Notice>Pipelines are private to the vault owner.</Notice>;
  if (!pipelines) return <Notice>{error ?? "Loading the pipelines."}</Notice>;

  const meta = streams.find((s) => s.id === picked) ?? streams[0];
  if (!meta) return <Notice>No blocks yet. Add one on the Quarter page.</Notice>;
  const stream = meta.id;
  const objective = objectives?.items.find((o) => o.stream === stream) ?? null;
  const goal = quarter?.streams.find((s) => s.stream === stream);
  const open = (id: string) => pipelines.streams.find((s) => s.stream === id)?.items.filter((i) => i.lane !== "done").length ?? 0;
  const entries = notebooks?.streams.find((s) => s.stream === stream)?.entries ?? [];
  const blockers = entries.filter((e) => e.kind === "blocker");
  const openBlockers = blockers.filter((e) => e.open);
  const blocked = (id: string) => notebooks?.streams.find((s) => s.stream === id)?.entries.filter((e) => e.kind === "blocker" && e.open).length ?? 0;

  return (
    <div className="w-full">
      <PageTitle eyebrow="Backlog feeds the chain" title="Pipelines" sub="Each stream's supply of dominoes. Tag an item with a month to show which checkpoint it pushes." />
      {(problem || error) && <p role="alert" className="mb-4 rounded-xl border border-[var(--destructive)] px-4 py-2 text-xs text-[var(--destructive)]">{problem ?? error}</p>}

      <div role="group" aria-label="Stream" className="-mx-1 mb-6 flex gap-2 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {streams.map((s) => (
          <button key={s.id} type="button" aria-pressed={s.id === stream} onClick={() => setPicked(s.id)}
            className="flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm font-bold transition active:scale-[0.97]"
            style={s.id === stream ? { borderColor: s.color, background: `color-mix(in srgb, ${s.color} 11%, var(--background))` } : { borderColor: "var(--border)" }}>
            <s.icon size={15} style={{ color: s.color }} aria-hidden="true" />
            {s.label}
            <span className="font-medium tabular-nums text-[var(--muted-foreground)]">{open(s.id)}</span>
            {blocked(s.id) > 0 && <span className="text-xs font-bold text-[var(--destructive)]">{blocked(s.id)} blocked</span>}
          </button>
        ))}
      </div>

      <div className="mb-6 flex items-center gap-3">
        <StreamIcon stream={meta} size={40} />
        <ChainCrumbs goal={goal} objective={objective} color={meta.color} />
      </div>

      <div role="tablist" aria-label="Pipeline or notebook" className="mb-5 flex gap-1 border-b border-[var(--border)]">
        {([["board", "Pipeline", null], ["notebook", "Notebook", entries.length]] as const).map(([id, label, n]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className="-mb-px min-h-11 shrink-0 border-b-2 border-transparent px-3.5 text-sm font-bold text-[var(--muted-foreground)] aria-selected:border-[var(--accent)] aria-selected:text-[var(--foreground)]">
            {label}{n !== null && <span className="ml-1.5 font-medium tabular-nums">{n}</span>}
          </button>
        ))}
      </div>

      {tab === "notebook" ? (
        <Notebook key={`${stream}-${nbFilter}`} meta={meta} entries={entries} busy={busy} run={run} initialFilter={nbFilter} />
      ) : (
      <>
      {openBlockers.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-[var(--destructive)] px-3.5 py-2.5 text-sm">
          <b className="text-[var(--destructive)]">{openBlockers.length} open blocker{openBlockers.length > 1 ? "s" : ""}</b>
          <span className="min-w-0 break-words text-[var(--muted-foreground)]">{openBlockers.map((b) => b.title).join(" · ")}</span>
          <button type="button" onClick={() => { setNbFilter("blocker"); setTab("notebook"); }} className="font-bold text-[var(--destructive)] underline underline-offset-2">Open notebook</button>
        </div>
      )}
      <PipelineBoard stream={stream} meta={meta} pipelines={pipelines} blockers={blockers} busy={busy} run={run} />
      </>
      )}
    </div>
  );
}
