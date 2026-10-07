"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Check, ChevronDown, NotebookPen, Pencil, Star, Trash2 } from "lucide-react";
import { usePlanner } from "@/hooks/use-planner";
import { ChainCrumbs } from "@/components/planner/chain-crumbs";
import { Notice, PageTitle, SectionTitle, Spinner } from "@/components/planner/page-title";
import { Notebook } from "@/components/planner/notebook";
import { MonthTag, StreamIcon } from "@/components/planner/stream-chip";
import { MONTH_LABEL, StreamMeta } from "@/lib/streams";
import { vaultApi } from "@/lib/vault-api";
import { Lane, MonthKey, NotebookKind, PipelineItemData } from "@/lib/vault-types";

const LANES: { id: Lane; label: string; hint: string }[] = [
  { id: "now", label: "Now", hint: "committed this week" },
  { id: "next", label: "Next", hint: "queued" },
  { id: "backlog", label: "Backlog", hint: "someday" },
];

export default function PipelinesPage() {
  const { loading, owner, quarter, pipelines, objectives, notebooks, streams, error, reload } = usePlanner();
  const [picked, setPicked] = useState<string | null>(null);
  const [tab, setTab] = useState<"board" | "notebook">("board");
  const [nbFilter, setNbFilter] = useState<NotebookKind | "all">("all");
  const [problem, setProblem] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
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
  const items = pipelines.streams.find((s) => s.stream === stream)?.items ?? [];
  const objective = objectives?.items.find((o) => o.stream === stream) ?? null;
  const goal = quarter?.streams.find((s) => s.stream === stream);
  const open = (id: string) => pipelines.streams.find((s) => s.stream === id)?.items.filter((i) => i.lane !== "done").length ?? 0;
  const doneItems = items.filter((i) => i.lane === "done").reverse();
  const staleCount = items.filter((i) => i.stale).length;
  const entries = notebooks?.streams.find((s) => s.stream === stream)?.entries ?? [];
  const openBlockers = entries.filter((e) => e.kind === "blocker" && e.open);
  const blocked = (id: string) => notebooks?.streams.find((s) => s.stream === id)?.entries.filter((e) => e.kind === "blocker" && e.open).length ?? 0;

  const lines = draft.split("\n").map((l) => l.trim()).filter(Boolean);
  async function add() {
    if (!lines.length) return;
    await run(async () => {
      await vaultApi.addPipelineItems(stream, lines, "backlog");
      setDraft("");
    });
  }

  return (
    <div className="w-full">
      <PageTitle eyebrow="Backlog feeds the chain" title="Pipelines" sub="Each stream's supply of dominoes. Tag an item with a month to show which checkpoint it pushes." />
      {(problem || error) && <p role="alert" className="mb-4 rounded-xl border border-[var(--destructive)] px-4 py-2 text-xs text-[var(--destructive)]">{problem ?? error}</p>}

      <div role="group" aria-label="Stream" className="-mx-1 mb-6 flex gap-2 overflow-x-auto px-1 pb-2">
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

      <div role="tablist" aria-label="Pipeline or notebook" className="mb-5 flex gap-1 overflow-x-auto border-b border-[var(--border)]">
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
      <div className="grid gap-4 lg:grid-cols-3">
        {LANES.map((lane) => {
          const laneItems = items.filter((i) => i.lane === lane.id);
          const over = lane.id === "now" && laneItems.length > pipelines.now_limit;
          return (
            <section key={lane.id} aria-label={lane.label} className="min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 sm:p-4">
              <h2 className="mb-3 flex items-baseline justify-between px-1 text-xs font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">
                <span>{lane.label} <span className="font-medium normal-case tracking-normal">· {lane.hint}</span></span>
                <span className="tabular-nums" style={over ? { color: "var(--warn)" } : undefined}>
                  {lane.id === "now" ? `${laneItems.length} / ${pipelines.now_limit}` : laneItems.length}
                </span>
              </h2>
              <ul className="grid gap-2">
                {laneItems.length === 0 && <li className="px-1 py-2 text-sm text-[var(--muted-foreground)]">{lane.id === "now" ? "Nothing committed. Promote one from Next." : "Empty."}</li>}
                {laneItems.map((item) => (
                  <ItemCard key={item.line} item={item} meta={meta} week={pipelines.week} busy={busy} staleDays={pipelines.stale_days}
                    onMove={(to) => run(() => vaultApi.movePipelineItem(stream, item, to))}
                    onTag={(m) => run(() => vaultApi.tagPipelineItem(stream, item, m))}
                    onRemove={() => run(() => vaultApi.removePipelineItem(stream, item))}
                    onRename={(text) => run(() => vaultApi.renamePipelineItem(stream, item, text))}
                    onDescribe={(text) => run(() => vaultApi.describePipelineItem(stream, item, text))}
                    onOne={!meta.weekly ? undefined : () => run(() => vaultApi.focusPipelineItem(stream, item))} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {staleCount > 0 && <p className="mt-3 text-xs text-[var(--warn)]">{staleCount} without a checkpoint for {pipelines.stale_days}+ days. If no month needs it, it may not be a domino.</p>}

      <section className="mt-8 max-w-3xl" aria-label="Add to backlog">
        <SectionTitle title="Add to backlog" aside="one item per line · end a line with #oct #nov or #dec" />
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} aria-label="New backlog items"
          placeholder={"Paste a whole list here.\nShip the DNS dashboard #nov"}
          className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5 text-sm placeholder:text-[var(--muted-foreground)]" />
        <button type="button" onClick={() => void add()} disabled={busy || lines.length === 0}
          className="mt-2 min-h-11 rounded-xl bg-[var(--accent)] px-5 text-sm font-bold text-[var(--accent-fg)] disabled:opacity-50">
          Add {lines.length > 1 ? `${lines.length} items` : "to backlog"}
        </button>
      </section>

      {doneItems.length > 0 && (
        <details className="group mt-8">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">
            <ChevronDown size={14} className="transition group-open:rotate-180" aria-hidden="true" /> Done · {doneItems.length}
          </summary>
          <ul className="mt-3 grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
            {doneItems.map((i) => (
              <li key={i.line} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-[var(--muted-foreground)]">
                <Check size={14} className="shrink-0 text-[var(--accent)]" aria-hidden="true" />
                <span className="min-w-0 flex-1 break-words line-through">{i.text}</span>
                <span className="shrink-0 text-[11px] tabular-nums">{i.done_on?.slice(5)}</span>
                <button type="button" aria-label={`Reopen ${i.text}`} className="shrink-0 text-[11px] font-bold text-[var(--accent)]" onClick={() => void run(() => vaultApi.movePipelineItem(stream, i, "next"))}>Reopen</button>
              </li>
            ))}
          </ul>
        </details>
      )}
      </>
      )}
    </div>
  );
}

const MONTH_ORDER = Object.keys(MONTH_LABEL) as MonthKey[];

interface CardProps {
  item: PipelineItemData;
  meta: StreamMeta;
  week: string;
  busy: boolean;
  staleDays: number;
  onMove: (lane: Lane) => void;
  onTag: (month: MonthKey | "") => void;
  onRemove: () => void;
  onOne?: () => void;
  onRename: (text: string) => Promise<unknown>;
  onDescribe: (description: string) => Promise<unknown>;
}

function ItemCard({ item, meta, week, busy, staleDays, onMove, onTag, onRemove, onOne, onRename, onDescribe }: CardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);
  const [noting, setNoting] = useState(false);
  const [notes, setNotes] = useState(item.description);
  const [open, setOpen] = useState(false);
  const isOne = item.focus === week;
  const order: Lane[] = ["now", "next", "backlog"];
  const at = order.indexOf(item.lane);
  const btn = "grid h-9 w-9 place-items-center rounded-lg text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-40";
  return (
    <li className="grid gap-2.5 rounded-xl border bg-[var(--background)] p-3" style={{ borderColor: isOne ? meta.color : "var(--border)", boxShadow: isOne ? `inset 0 0 0 1px ${meta.color}` : undefined }}>
      {editing ? (
        <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); if (draft.trim() && draft.trim() !== item.text) void onRename(draft.trim()).then(() => setEditing(false)); else setEditing(false); }}>
          <input autoFocus value={draft} maxLength={300} aria-label="Edit item" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
            className="min-h-10 min-w-0 flex-1 rounded-lg border border-[var(--accent)] bg-[var(--background)] px-2.5 text-sm" />
          <button type="submit" aria-label="Save" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-[var(--accent)] hover:bg-[var(--muted)]"><Check size={16} /></button>
        </form>
      ) : (
        <p className="break-words text-sm leading-snug">{item.text}</p>
      )}
      {noting ? (
        <form className="grid gap-1.5" onSubmit={(e) => { e.preventDefault(); void onDescribe(notes).then(() => setNoting(false)); }}>
          <textarea autoFocus value={notes} rows={5} maxLength={4000} aria-label="Details" placeholder="Details, context, links…" onChange={(e) => setNotes(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setNoting(false)}
            className="w-full rounded-lg border border-[var(--accent)] bg-[var(--background)] p-2.5 text-sm leading-relaxed" />
          <div className="flex gap-1.5">
            <button type="submit" disabled={busy} className="min-h-9 rounded-lg bg-[var(--accent)] px-3 text-xs font-bold text-[var(--accent-fg)] disabled:opacity-50">Save details</button>
            <button type="button" onClick={() => setNoting(false)} className="min-h-9 rounded-lg px-3 text-xs font-bold text-[var(--muted-foreground)] hover:bg-[var(--muted)]">Cancel</button>
          </div>
        </form>
      ) : item.description ? (
        <button type="button" aria-expanded={open} aria-label="Show details" onClick={() => setOpen(!open)}
          className={`whitespace-pre-wrap break-words text-left text-[13px] leading-relaxed text-[var(--muted-foreground)] ${open ? "" : "line-clamp-2"}`}>
          {item.description}
        </button>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {isOne && <span className="inline-flex items-center gap-1 text-[11px] font-bold" style={{ color: meta.color }}><Star size={12} fill="currentColor" aria-hidden="true" /> This week</span>}
          <label className="relative">
            <span className="sr-only">Checkpoint</span>
            <select value={item.checkpoint ?? ""} disabled={busy} onChange={(e) => onTag(e.target.value as MonthKey | "")}
              className="appearance-none rounded-md px-1.5 py-px text-[11px] font-bold tabular-nums [field-sizing:content]"
              style={item.checkpoint ? { color: meta.color, background: `color-mix(in srgb, ${meta.color} 14%, var(--background))` }
                : item.stale ? { color: "var(--warn)", background: "var(--warn-light)" } : { color: "var(--muted-foreground)", background: "var(--muted)" }}>
              <option value="">{item.stale ? `no checkpoint · ${item.age_days}d` : "no checkpoint"}</option>
              {MONTH_ORDER.map((m) => <option key={m} value={m}>{MONTH_LABEL[m]}</option>)}
            </select>
          </label>
          {item.age_days >= staleDays && item.checkpoint && <MonthTag label={`${item.age_days}d`} muted />}
        </div>
        <div className="-mr-1 flex">
          <button type="button" className={btn} disabled={busy} aria-label={item.description ? "Edit details" : "Add details"} title={item.description ? "Edit details" : "Add details"}
            onClick={() => { setNotes(item.description); setNoting(true); }}>
            <NotebookPen size={14} style={item.description ? { color: meta.color } : undefined} />
          </button>
          <button type="button" className={btn} disabled={busy} aria-label="Edit" title="Edit" onClick={() => { setDraft(item.text); setEditing(true); }}><Pencil size={14} /></button>
          {onOne && !isOne && <button type="button" className={btn} disabled={busy} aria-label="Make this the week's one thing" title="Make this the week's one thing" onClick={onOne}><Star size={15} /></button>}
          {at > 0 && <button type="button" className={btn} disabled={busy} aria-label="Promote" title="Promote" onClick={() => onMove(order[at - 1])}><ArrowUp size={15} /></button>}
          {at < 2 && <button type="button" className={btn} disabled={busy} aria-label="Demote" title="Demote" onClick={() => onMove(order[at + 1])}><ArrowDown size={15} /></button>}
          <button type="button" className={btn} disabled={busy} aria-label="Mark done" title="Done" onClick={() => onMove("done")}><Check size={16} /></button>
          <button type="button" className={`${btn} hover:!text-[var(--destructive)]`} disabled={busy} aria-label="Remove" title="Remove" onClick={onRemove}><Trash2 size={15} /></button>
        </div>
      </div>
    </li>
  );
}
