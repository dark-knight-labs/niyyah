"use client";

import { useState } from "react";
import { OctagonAlert } from "lucide-react";
import { Pick } from "@/components/planner/pick";
import { Checkbox } from "@/components/routine/checkbox";
import { ItemRow, NoteRow, TABS, LANE_FOR, isOpenBlocker, tabOf, waitingOn } from "@/lib/plan-model";
import { MONTH_LABEL, StreamMeta } from "@/lib/streams";
import { vaultApi } from "@/lib/vault-api";
import { Lane, MonthKey, NotebookEntryData, QuarterStreamData } from "@/lib/vault-types";

type Run = (action: () => Promise<unknown>) => Promise<boolean>;

const label = "mono mb-1.5 block text-[var(--muted-foreground)]";
const field = "w-full border border-[var(--rule)] bg-[var(--background)] px-2.5 py-2 text-small leading-relaxed outline-none focus:border-[var(--accent)]";
const btn = "mono inline-flex min-h-9 items-center px-3.5 disabled:opacity-40";
const solid = `${btn} bg-[var(--foreground)] text-[var(--background)] hover:opacity-90`;
const ghost = `${btn} border border-[var(--rule)] hover:bg-[var(--muted)]`;
const danger = `${btn} border border-[var(--destructive)] text-[var(--destructive)] hover:bg-[var(--warn-light)]`;

/** A title that saves when you leave it or press Enter. The key resets the draft when the row changes. */
function TitleField({ value, busy, onSave }: { value: string; busy: boolean; onSave: (text: string) => void }) {
  const [draft, setDraft] = useState(value);
  const save = () => { const t = draft.trim(); if (t && t !== value) onSave(t); else setDraft(value); };
  return (
    <input value={draft} maxLength={300} disabled={busy} aria-label="Title" onChange={(e) => setDraft(e.target.value)} onBlur={save}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setDraft(value); e.currentTarget.blur(); } }}
      className="heading-elegant w-full border-0 border-b border-transparent bg-transparent pb-0.5 text-lg leading-tight outline-none focus:border-[var(--accent)]" />
  );
}

function NotesField({ value, busy, rows, placeholder, onSave }: { value: string; busy: boolean; rows: number; placeholder: string; onSave: (text: string) => void }) {
  const [draft, setDraft] = useState(value);
  return (
    <textarea value={draft} rows={rows} maxLength={8000} disabled={busy} aria-label="Details" placeholder={placeholder} onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onSave(draft); }} className={field} />
  );
}

/** Two clicks to delete, since the click that asks is not the click that does it. */
function DeleteButton({ busy, onDelete }: { busy: boolean; onDelete: () => void }) {
  const [asked, setAsked] = useState(false);
  return (
    <button type="button" disabled={busy} className={danger} onClick={() => (asked ? onDelete() : setAsked(true))} onBlur={() => setAsked(false)}>
      {asked ? "Confirm delete" : "Delete"}
    </button>
  );
}

interface ItemProps {
  row: ItemRow;
  meta: StreamMeta;
  goal: QuarterStreamData | undefined;
  months: MonthKey[];
  blockers: NotebookEntryData[];
  week: string;
  staleDays: number;
  busy: boolean;
  run: Run;
}

/** The detail card of one pipeline item: rename, details, horizon, checkpoint, what it waits on, tags, and the actions. */
export function ItemCard({ row, meta, goal, months, blockers, week, staleDays, busy, run }: ItemProps) {
  const { item } = row;
  const stream = row.stream;
  const [newTag, setNewTag] = useState("");
  const [linking, setLinking] = useState(item.blocked_by.length > 0);
  const waiting = waitingOn(item, blockers);
  const isOne = item.focus === week;
  const tab = tabOf(row);
  const order: Lane[] = ["now", "next", "backlog"];
  const at = order.indexOf(item.lane);
  const cpOptions: { value: string; label: string }[] = [
    { value: "none", label: item.stale ? `No checkpoint · ${item.age_days}d` : "No checkpoint" },
    ...[...new Set<MonthKey>([...months, ...(item.checkpoint ? [item.checkpoint] : [])])].map((m) => ({ value: m, label: MONTH_LABEL[m] })),
  ];
  const tags = item.products ?? [];
  const rewrite = (list: string[]) => run(() => vaultApi.renamePipelineItem(stream, item, [item.text, ...list.map((p) => (/\s/.test(p) ? `[product:: ${p}]` : `#${p}`))].join(" ")));

  return (
    <>
      <p className="mono text-[var(--muted-foreground)]">Item · {meta.label}</p>
      <TitleField key={item.hash} value={item.text} busy={busy} onSave={(t) => void run(() => vaultApi.renamePipelineItem(stream, item, [t, ...tags.map((p) => `#${p}`)].join(" ")))} />
      {waiting.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {waiting.map((w) => (
            <span key={w.id} className={`mono inline-flex max-w-full items-center gap-1.5 px-2 py-1 ${w.found ? "bg-[var(--warn-light)] text-[var(--destructive)]" : "bg-[var(--muted)] text-[var(--muted-foreground)]"}`}>
              <OctagonAlert size={11} aria-hidden="true" className="shrink-0" />{w.found ? w.found.title : "blocker deleted"}
            </span>
          ))}
        </div>
      )}
      <label><span className={label}>Details</span>
        <NotesField key={`${item.hash}-d`} value={item.description} busy={busy} rows={3} placeholder="Details, context, links…" onSave={(t) => void run(() => vaultApi.describePipelineItem(stream, item, t))} />
      </label>
      <div>
        <span className={label}>Horizon</span>
        <div role="group" aria-label="Horizon" className="flex w-max max-w-full border border-[var(--rule)]">
          {TABS.filter((t) => t.id !== "notes").map((t) => (
            <button key={t.id} type="button" disabled={busy} aria-pressed={tab === t.id} onClick={() => void run(() => vaultApi.movePipelineItem(stream, item, LANE_FOR[t.id as Exclude<typeof t.id, "notes">]))}
              className="mono min-h-8 border-r border-[var(--rule)] px-3 text-[var(--muted-foreground)] last:border-r-0 hover:bg-[var(--muted)] aria-pressed:bg-[var(--muted)] aria-pressed:text-[var(--foreground)] aria-pressed:shadow-[inset_0_-2px_0_var(--accent)]">{t.label}</button>
          ))}
        </div>
      </div>
      <div>
        <span className={label}>Checkpoint</span>
        <Pick value={item.checkpoint ?? "none"} options={cpOptions} label="Checkpoint month" disabled={busy} warn={item.stale && !item.checkpoint}
          onChange={(v) => void run(() => vaultApi.tagPipelineItem(stream, item, v === "none" ? "" : (v as MonthKey)))} />
        {item.checkpoint && item.age_days >= staleDays && <span className="mono ml-2 text-[var(--muted-foreground)]">{item.age_days}d old</span>}
      </div>
      {item.lane !== "done" && (
        <details open={linking} onToggle={(e) => setLinking(e.currentTarget.open)} className="border border-[var(--border)] px-2.5 py-2">
          <summary className="mono cursor-pointer text-[var(--muted-foreground)]">Waiting on · {item.blocked_by.length}</summary>
          <div className="mt-2 grid gap-1.5">
            {blockers.length === 0 && <p className="text-xs text-[var(--muted-foreground)]">No blockers yet. Add one with the Blocker kind above.</p>}
            {blockers.map((b) => (
              <div key={`${b.line}-${b.hash}`} className="flex items-start gap-2 text-small">
                <span className="mt-[0.2rem]"><Checkbox disabled={busy || !b.id} label={`Blocked by: ${b.title}`} checked={!!b.id && item.blocked_by.includes(b.id)}
                  onChange={() => b.id && void run(() => vaultApi.blockPipelineItem(stream, item, item.blocked_by.includes(b.id!) ? item.blocked_by.filter((i) => i !== b.id) : [...item.blocked_by, b.id!]))} /></span>
                <span className={`min-w-0 break-words ${b.open ? "" : "text-[var(--muted-foreground)] line-through"}`}>{b.title}{!b.id && " (save any change to it in the notes to link it)"}</span>
              </div>
            ))}
          </div>
        </details>
      )}
      <div>
        <span className={label}>Tags</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.map((t) => (
            <span key={t} className="mono inline-flex items-center border border-[var(--rule)] text-[var(--muted-foreground)]">
              <span className="px-1.5 py-0.5">#{t}</span>
              <button type="button" disabled={busy} aria-label={`Remove tag ${t}`} onClick={() => void rewrite(tags.filter((x) => x !== t))} className="px-1.5 py-0.5 hover:text-[var(--destructive)]">×</button>
            </span>
          ))}
          <input value={newTag} placeholder="+ tag" aria-label="Add a tag" maxLength={30} disabled={busy} onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              const w = newTag.trim().replace(/^#/, "").toLowerCase().replace(/[^\w-]/g, "");
              if (w && !tags.includes(w)) void rewrite([...tags, w]).then(() => setNewTag(""));
            }}
            className="mono w-24 border-0 border-b border-[var(--rule)] bg-transparent py-0.5 outline-none focus:border-[var(--accent)]" />
        </div>
      </div>
      <dl className="grid grid-cols-[6rem_1fr] border-t border-[var(--border)] text-small [&>*]:border-b [&>*]:border-[var(--border)] [&>*]:py-1.5">
        {goal?.goal && <><dt className="mono text-[var(--muted-foreground)]">Goal</dt><dd className="break-words">{goal.goal}</dd></>}
        <dt className="mono text-[var(--muted-foreground)]">Age</dt><dd className="tabular-nums">{item.age_days}d</dd>
        {item.added && <><dt className="mono text-[var(--muted-foreground)]">Added</dt><dd className="tabular-nums">{item.added}</dd></>}
        {item.done_on && <><dt className="mono text-[var(--muted-foreground)]">Done</dt><dd className="tabular-nums">{item.done_on}</dd></>}
      </dl>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} className={solid} onClick={() => void run(() => vaultApi.movePipelineItem(stream, item, item.lane === "done" ? "next" : "done"))}>{item.lane === "done" ? "Reopen" : "Mark done"}</button>
        {at > 0 && <button type="button" disabled={busy} className={ghost} onClick={() => void run(() => vaultApi.movePipelineItem(stream, item, order[at - 1]))}>↑ Promote</button>}
        {at >= 0 && at < 2 && <button type="button" disabled={busy} className={ghost} onClick={() => void run(() => vaultApi.movePipelineItem(stream, item, order[at + 1]))}>↓ Demote</button>}
        {meta.weekly && item.lane !== "done" && !isOne && <button type="button" disabled={busy} className={ghost} onClick={() => void run(() => vaultApi.focusPipelineItem(stream, item))}>Make small domino</button>}
        <DeleteButton busy={busy} onDelete={() => void run(() => vaultApi.removePipelineItem(stream, item))} />
      </div>
    </>
  );
}

interface NoteProps { row: NoteRow; meta: StreamMeta; busy: boolean; run: Run }

/** The detail card of one notebook entry: edit it, clear a blocker, promote an idea or a meeting to Someday, delete it. */
export function NoteCard({ row, meta, busy, run }: NoteProps) {
  const { entry } = row;
  const stream = row.stream;
  const [promoted, setPromoted] = useState(false);
  const blocker = entry.kind === "blocker";
  return (
    <>
      <p className="mono text-[var(--muted-foreground)]">Note · {entry.kind} · {meta.label}{entry.date ? ` · ${entry.date}` : ""}</p>
      <TitleField key={entry.hash} value={entry.title} busy={busy} onSave={(t) => void run(() => vaultApi.editNotebookEntry(stream, entry, t, entry.body))} />
      <label><span className={label}>Notes</span>
        <NotesField key={`${entry.hash}-b`} value={entry.body} busy={busy} rows={6} placeholder="Write it down. Paste a link, a meeting recap, a half-formed idea."
          onSave={(t) => void run(() => vaultApi.editNotebookEntry(stream, entry, entry.title, t))} />
      </label>
      {entry.url && <p className="text-small"><a href={entry.url} target="_blank" rel="noopener noreferrer" className="break-all text-[var(--accent)] underline underline-offset-2">{entry.url}</a></p>}
      {blocker && (
        <label className="flex items-center gap-2.5 text-small">
          <Checkbox checked={!isOpenBlocker(entry)} disabled={busy} label={`Cleared: ${entry.title}`} onChange={() => void run(() => vaultApi.setBlocker(stream, entry, !entry.open))} />
          Cleared
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        {!blocker && (
          <button type="button" disabled={busy || promoted} className={solid}
            onClick={() => void run(() => vaultApi.addPipelineItems(stream, [entry.title], "backlog", [entry.body])).then((ok) => ok && setPromoted(true))}>
            {promoted ? "In Someday" : "Promote to Someday"}
          </button>
        )}
        <DeleteButton busy={busy} onDelete={() => void run(() => vaultApi.removeNotebookEntry(stream, entry))} />
      </div>
    </>
  );
}

