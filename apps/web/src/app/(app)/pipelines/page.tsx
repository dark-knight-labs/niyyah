"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Check, ChevronDown, Star, Trash2 } from "lucide-react";
import { usePlanner } from "@/hooks/use-planner";
import { ChainCrumbs } from "@/components/planner/chain-crumbs";
import { Notice, PageTitle, SectionTitle, Spinner } from "@/components/planner/page-title";
import { MonthTag, StreamIcon } from "@/components/planner/stream-chip";
import { GOAL_STREAMS, MONTH_LABEL, StreamMeta, streamMeta } from "@/lib/streams";
import { vaultApi } from "@/lib/vault-api";
import { Lane, MonthKey, PipelineItemData, VaultObjective } from "@/lib/vault-types";

const LANES: { id: Lane; label: string; hint: string }[] = [
  { id: "now", label: "Now", hint: "committed this week" },
  { id: "next", label: "Next", hint: "queued" },
  { id: "backlog", label: "Backlog", hint: "someday" },
];

export default function PipelinesPage() {
  const { loading, owner, quarter, pipelines, objectives, error, reload } = usePlanner();
  const [stream, setStream] = useState("kahf");
  const [problem, setProblem] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("stream");
    if (wanted && GOAL_STREAMS.some((s) => s.id === wanted)) setStream(wanted);
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

  const meta = streamMeta(stream);
  const items = pipelines.streams.find((s) => s.stream === stream)?.items ?? [];
  const objective = objectives?.items.find((o) => o.stream === stream) ?? null;
  const goal = quarter?.streams.find((s) => s.stream === stream);
  const open = (id: string) => pipelines.streams.find((s) => s.stream === id)?.items.filter((i) => i.lane !== "done").length ?? 0;
  const doneItems = items.filter((i) => i.lane === "done").reverse();
  const staleCount = items.filter((i) => i.stale).length;

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
        {GOAL_STREAMS.map((s) => (
          <button key={s.id} type="button" aria-pressed={s.id === stream} onClick={() => setStream(s.id)}
            className="flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm font-bold transition active:scale-[0.97]"
            style={s.id === stream ? { borderColor: s.color, background: `color-mix(in srgb, ${s.color} 11%, var(--background))` } : { borderColor: "var(--border)" }}>
            <s.icon size={15} style={{ color: s.color }} aria-hidden="true" />
            {s.label}
            <span className="font-medium tabular-nums text-[var(--muted-foreground)]">{open(s.id)}</span>
          </button>
        ))}
      </div>

      <div className="mb-6 flex items-center gap-3">
        <StreamIcon stream={meta} size={40} />
        <ChainCrumbs goal={goal} objective={objective} color={meta.color} />
      </div>

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
                  <ItemCard key={item.line} item={item} meta={meta} objective={objective} busy={busy} staleDays={pipelines.stale_days}
                    onMove={(to) => run(() => vaultApi.movePipelineItem(stream, item, to))}
                    onTag={(m) => run(() => vaultApi.tagPipelineItem(stream, item, m))}
                    onRemove={() => run(() => vaultApi.removePipelineItem(stream, item))}
                    onOne={meta.id === "finance" ? undefined : () => run(async () => {
                      await vaultApi.setObjective(stream, { text: item.text, done: false, checkpoint: item.checkpoint ?? "" });
                      if (item.lane !== "now") await vaultApi.movePipelineItem(stream, item, "now");
                    })} />
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
    </div>
  );
}

const MONTH_ORDER = Object.keys(MONTH_LABEL) as MonthKey[];

interface CardProps {
  item: PipelineItemData;
  meta: StreamMeta;
  objective: VaultObjective | null;
  busy: boolean;
  staleDays: number;
  onMove: (lane: Lane) => void;
  onTag: (month: MonthKey | "") => void;
  onRemove: () => void;
  onOne?: () => void;
}

function ItemCard({ item, meta, objective, busy, staleDays, onMove, onTag, onRemove, onOne }: CardProps) {
  const isOne = !!objective?.text && objective.text === item.text;
  const order: Lane[] = ["now", "next", "backlog"];
  const at = order.indexOf(item.lane);
  const btn = "grid h-9 w-9 place-items-center rounded-lg text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-40";
  return (
    <li className="grid gap-2.5 rounded-xl border bg-[var(--background)] p-3" style={{ borderColor: isOne ? meta.color : "var(--border)", boxShadow: isOne ? `inset 0 0 0 1px ${meta.color}` : undefined }}>
      <p className="break-words text-sm leading-snug">{item.text}</p>
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
          {onOne && item.lane !== "backlog" && !isOne && <button type="button" className={btn} disabled={busy} aria-label="Make this the week's one thing" title="Make this the week's one thing" onClick={onOne}><Star size={15} /></button>}
          {at > 0 && <button type="button" className={btn} disabled={busy} aria-label="Promote" title="Promote" onClick={() => onMove(order[at - 1])}><ArrowUp size={15} /></button>}
          {at < 2 && <button type="button" className={btn} disabled={busy} aria-label="Demote" title="Demote" onClick={() => onMove(order[at + 1])}><ArrowDown size={15} /></button>}
          <button type="button" className={btn} disabled={busy} aria-label="Mark done" title="Done" onClick={() => onMove("done")}><Check size={16} /></button>
          <button type="button" className={`${btn} hover:!text-[var(--destructive)]`} disabled={busy} aria-label="Remove" title="Remove" onClick={onRemove}><Trash2 size={15} /></button>
        </div>
      </div>
    </li>
  );
}
