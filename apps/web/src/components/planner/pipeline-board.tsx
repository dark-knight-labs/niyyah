"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Check, ChevronDown, NotebookPen, OctagonAlert, Pencil, Star, Trash2 } from "lucide-react";
import { SectionTitle } from "@/components/planner/page-title";
import { MonthTag } from "@/components/planner/stream-chip";
import { MONTH_LABEL, StreamMeta } from "@/lib/streams";
import { parseDraft } from "@/lib/draft";
import { vaultApi } from "@/lib/vault-api";
import { Lane, MonthKey, NotebookEntryData, PipelineItemData, PipelinesData } from "@/lib/vault-types";

const LANES: { id: Lane; label: string; hint: string }[] = [
  { id: "now", label: "Now", hint: "committed this week" },
  { id: "next", label: "Next", hint: "queued" },
  { id: "backlog", label: "Someday", hint: "parked" },
];

interface BoardProps {
  stream: string;
  meta: StreamMeta;
  pipelines: PipelinesData;
  /** The block's notebook blockers, which items can wait on. */
  blockers: NotebookEntryData[];
  busy: boolean;
  run: (action: () => Promise<unknown>) => Promise<unknown>;
  /** One lane under another, for a narrow column; otherwise three lanes side by side on wide screens. */
  stacked?: boolean;
}

/** One block's pipeline: Now, Next and Someday lanes, a box to add items, and the done list. */
export function PipelineBoard({ stream, meta, pipelines, blockers, busy, run, stacked }: BoardProps) {
  const [draft, setDraft] = useState("");
  const items = pipelines.streams.find((s) => s.stream === stream)?.items ?? [];
  const doneItems = items.filter((i) => i.lane === "done").reverse();
  const staleCount = items.filter((i) => i.stale).length;
  const lines = parseDraft(draft);

  async function add() {
    if (!lines.length) return;
    await run(async () => {
      await vaultApi.addPipelineItems(stream, lines.map((l) => l.text), "backlog", lines.map((l) => l.description));
      setDraft("");
    });
  }

  return (
    <>
      <div className={`grid gap-4 ${stacked ? "" : "lg:grid-cols-3"}`}>
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
                  <ItemCard key={item.line} item={item} meta={meta} week={pipelines.week} busy={busy} staleDays={pipelines.stale_days} blockers={blockers}
                    onBlock={(ids) => run(() => vaultApi.blockPipelineItem(stream, item, ids))}
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

      <section className="mt-8 max-w-3xl" aria-label="Add to Someday">
        <SectionTitle title="Add to Someday" aside="one item per line · indent lines under it for a description · end a line with #oct #nov or #dec" />
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} aria-label="New items"
          placeholder={"PRODUCT - ISSUE|POC|MEETING|FEATURE - Title #nov\n  Description on indented lines under the title.\n  Repro, links, context.\n\nPaste a whole list; each unindented line is one item."}
          className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5 text-sm placeholder:text-[var(--muted-foreground)]" />
        <button type="button" onClick={() => void add()} disabled={busy || lines.length === 0}
          className="mt-2 min-h-11 rounded-xl bg-[var(--accent)] px-5 text-sm font-bold text-[var(--accent-fg)] disabled:opacity-50">
          Add {lines.length > 1 ? `${lines.length} items` : "to Someday"}
        </button>
      </section>

      {doneItems.length > 0 && (
        <details className="group mt-8">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">
            <ChevronDown size={14} className="transition group-open:rotate-180" aria-hidden="true" /> Done · {doneItems.length}
          </summary>
          <ul className={`mt-3 grid gap-1.5 ${stacked ? "" : "sm:grid-cols-2 xl:grid-cols-3"}`}>
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
  );
}

const MONTH_ORDER = Object.keys(MONTH_LABEL) as MonthKey[];

interface CardProps {
  item: PipelineItemData;
  meta: StreamMeta;
  week: string;
  busy: boolean;
  staleDays: number;
  /** The block's notebook blockers, which this item can wait on. */
  blockers: NotebookEntryData[];
  onBlock: (ids: string[]) => void;
  onMove: (lane: Lane) => void;
  onTag: (month: MonthKey | "") => void;
  onRemove: () => void;
  onOne?: () => void;
  onRename: (text: string) => Promise<unknown>;
  onDescribe: (description: string) => Promise<unknown>;
}

function ItemCard({ item, meta, week, busy, staleDays, blockers, onBlock, onMove, onTag, onRemove, onOne, onRename, onDescribe }: CardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);
  const [noting, setNoting] = useState(false);
  const [notes, setNotes] = useState(item.description);
  const [open, setOpen] = useState(false);
  const [linking, setLinking] = useState(false);
  const waiting = item.lane === "done" ? [] : item.blocked_by.map((id) => ({ id, found: blockers.find((b) => b.id === id) })).filter((w) => !w.found || w.found.open);
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
      {waiting.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {waiting.map((w) => (
            <span key={w.id} className="inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-px text-[11px] font-bold"
              style={w.found ? { color: "var(--destructive)", background: "color-mix(in srgb, var(--destructive) 12%, var(--background))" } : { color: "var(--muted-foreground)", background: "var(--muted)" }}>
              <OctagonAlert size={11} className="shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-words">{w.found ? w.found.title : "blocker deleted"}</span>
            </span>
          ))}
        </div>
      )}
      {linking && (
        <fieldset className="grid gap-1.5 rounded-lg border border-[var(--border)] p-2.5">
          <legend className="px-1 text-[11px] font-extrabold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">Waiting on</legend>
          {blockers.length === 0 && <p className="text-xs text-[var(--muted-foreground)]">No blockers yet. Add one in the Notebook.</p>}
          {blockers.map((b) => (
            <label key={`${b.line}-${b.hash}`} className="flex items-start gap-2 text-xs">
              <input type="checkbox" disabled={busy || !b.id} className="mt-0.5 accent-[var(--accent)]" checked={!!b.id && item.blocked_by.includes(b.id)}
                onChange={(e) => b.id && onBlock(e.target.checked ? [...item.blocked_by, b.id] : item.blocked_by.filter((i) => i !== b.id))} />
              <span className={`min-w-0 break-words ${b.open ? "" : "text-[var(--muted-foreground)] line-through"}`}>{b.title}{!b.id && " (save any change in the Notebook to link it)"}</span>
            </label>
          ))}
          <button type="button" onClick={() => setLinking(false)} className="justify-self-start text-[11px] font-bold text-[var(--accent)]">Done</button>
        </fieldset>
      )}
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
          {item.lane !== "done" && (blockers.length > 0 || item.blocked_by.length > 0) && (
            <button type="button" className={btn} disabled={busy} aria-label="Waiting on a blocker" title="Waiting on a blocker" aria-expanded={linking} onClick={() => setLinking(!linking)}>
              <OctagonAlert size={14} style={item.blocked_by.length ? { color: "var(--destructive)" } : undefined} />
            </button>
          )}
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
