"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Pencil, Plus } from "lucide-react";
import { usePlanner } from "@/hooks/use-planner";
import { DominoChain } from "@/components/planner/domino-chain";
import { MonthTrack } from "@/components/planner/month-track";
import { Notice, PageTitle, SectionTitle, Spinner } from "@/components/planner/page-title";
import { QuarterRing } from "@/components/planner/quarter-ring";
import { StatusPill, StreamIcon } from "@/components/planner/stream-chip";
import { StreamEditor } from "@/components/planner/stream-editor";
import { MONTH_LABEL, toMeta } from "@/lib/streams";
import { vaultApi } from "@/lib/vault-api";
import { StreamChange } from "@/lib/vault-types";

export default function QuarterPage() {
  const { loading, owner, quarter, quarterError, pipelines, objectives, error, reload } = usePlanner();
  const [editing, setEditing] = useState<string | null>(null); // a stream id, "new", or null
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [draft, setDraft] = useState("");

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

  if (loading) return <Spinner />;
  if (!owner) return <Notice>The quarter plan is private to the vault owner.</Notice>;
  if (!quarter) return <Notice>{quarterError ?? error ?? "Loading the quarter."}</Notice>;

  const year = quarter.quarter.slice(0, 4);
  const q = quarter.quarter.slice(5);
  const months = quarter.months.map((m) => MONTH_LABEL[m]);
  const count = (stream: string, lane: string) => pipelines?.streams.find((s) => s.stream === stream)?.items.filter((i) => i.lane === lane).length ?? 0;
  const live = quarter.streams.filter((s) => s.status !== "archived");
  const archived = quarter.streams.filter((s) => s.status === "archived");

  async function save(id: string, change: StreamChange & { name: string }, isNew: boolean) {
    const ok = await run(() => (isNew ? vaultApi.addStream(id, change) : vaultApi.updateStream(id, change)));
    if (ok) setEditing(null);
  }

  return (
    <div className="w-full">
      <PageTitle
        eyebrow={`${q} ${year} · ${months[0]} – ${months[months.length - 1]}`}
        title={
          editingTitle ? (
            <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) void run(() => vaultApi.setSuperObjective(draft.trim(), quarter.objective_ar)).then((ok) => ok && setEditingTitle(false)); }}>
              <input autoFocus value={draft} maxLength={300} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setEditingTitle(false)}
                aria-label="Super Objective" className="min-w-0 flex-1 basis-80 rounded-xl border border-[var(--accent)] bg-[var(--background)] px-3 py-2 text-xl" />
              <button type="submit" disabled={busy || !draft.trim()} className="min-h-11 rounded-xl bg-[var(--accent)] px-5 text-sm font-bold text-[var(--accent-fg)] disabled:opacity-50">Save</button>
              <button type="button" onClick={() => setEditingTitle(false)} className="min-h-11 rounded-xl border border-[var(--border)] px-4 text-sm font-semibold">Cancel</button>
            </form>
          ) : (
            <>
              {quarter.objective || "Set this quarter's Super Objective"}
              <button type="button" aria-label="Edit the Super Objective" title="Edit" onClick={() => { setDraft(quarter.objective); setEditingTitle(true); }}
                className="ml-2 inline-grid h-9 w-9 place-items-center rounded-lg align-middle text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"><Pencil size={16} /></button>
            </>
          )
        }
        sub={quarter.objective_ar ? <span dir="rtl" lang="ar" className="text-xl">{quarter.objective_ar}</span> : undefined}
        visual={
          <div className="flex items-end gap-6 text-[var(--accent)]">
            <DominoChain count={6} height={72} className="hidden sm:block" />
            <QuarterRing week={quarter.week_of_quarter} weeks={quarter.weeks_in_quarter} label={`OF ${quarter.weeks_in_quarter} WEEKS`} />
          </div>
        }
      />
      {(problem || error) && <p role="alert" className="mb-4 rounded-xl border border-[var(--destructive)] px-4 py-2 text-xs text-[var(--destructive)]">{problem ?? error}</p>}

      <SectionTitle title="Big dominoes" aside="one goal per block · the northstar for the end of the quarter" />
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3 min-[2000px]:grid-cols-4">
        {live.map((s) => {
          if (editing === s.stream) {
            return (
              <div key={s.stream} className="md:col-span-2 2xl:col-span-3 min-[2000px]:col-span-4">
                <StreamEditor quarter={quarter} stream={s} busy={busy} onCancel={() => setEditing(null)} onSave={(c, id) => save(id, c, false)} />
              </div>
            );
          }
          const meta = toMeta(s);
          const week = objectives?.items.find((o) => o.stream === s.stream);
          return (
            <article key={s.stream} className="flex min-w-0 flex-col gap-5 rounded-2xl border border-[var(--border)] bg-[var(--background)] p-5 sm:p-6"
              style={{ borderTop: `3px solid ${meta.color}` }}>
              <header className="flex items-center gap-3">
                <StreamIcon stream={meta} />
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-extrabold uppercase tracking-[0.08em]" style={{ color: meta.color }}>{meta.label}</h3>
                  <p className="truncate text-xs text-[var(--muted-foreground)]">{meta.slot || "No slot set"}</p>
                </div>
                <StatusPill status={s.status} />
                <button type="button" aria-label={`Edit ${meta.label}`} title="Edit" onClick={() => setEditing(s.stream)}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
                  <Pencil size={15} />
                </button>
              </header>
              <p className={`text-[15px] font-semibold leading-snug ${s.goal ? "" : "text-[var(--muted-foreground)]"}`}>{s.goal || "No goal yet. Edit to set one."}</p>
              <MonthTrack checkpoints={s.checkpoints} current={quarter.current_month} color={meta.color} />
              <div className="flex items-baseline gap-3 border-t border-[var(--border)] pt-4 text-[13px]">
                <span className="shrink-0 text-[10px] font-extrabold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">Small domino</span>
                <span className={`min-w-0 break-words ${week?.text ? "" : "text-[var(--muted-foreground)]"}`}>
                  {meta.weekly ? week?.text || "Not chosen for this week" : "No weekly objective"}
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

        {editing === "new" ? (
          <div className="md:col-span-2 2xl:col-span-3 min-[2000px]:col-span-4">
            <StreamEditor quarter={quarter} busy={busy} onCancel={() => setEditing(null)} onSave={(c, id) => save(id, c, true)} />
          </div>
        ) : (
          <button type="button" onClick={() => setEditing("new")}
            className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[var(--border)] p-6 text-sm font-bold text-[var(--muted-foreground)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]">
            <Plus size={22} aria-hidden="true" />
            Add a block
            <span className="text-xs font-medium">Finance, Errands, a second business…</span>
          </button>
        )}
      </div>

      {archived.length > 0 && (
        <section className="mt-8" aria-label="Archived blocks">
          <SectionTitle title="Archived" aside="hidden from the planner; their notes stay in the vault" />
          <ul className="flex flex-wrap gap-2">
            {archived.map((s) => (
              <li key={s.stream} className="flex items-center gap-2 rounded-full border border-[var(--border)] py-1 pl-3.5 pr-1.5 text-sm">
                <span>{s.name}</span>
                <button type="button" disabled={busy} className="rounded-full bg-[var(--muted)] px-3 py-1 text-xs font-bold text-[var(--accent)]"
                  onClick={() => void run(() => vaultApi.updateStream(s.stream, { status: "committed" }))}>Restore</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
