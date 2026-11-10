"use client";

import Link from "next/link";
import { useState } from "react";
import { OctagonAlert } from "lucide-react";
import { Checkbox } from "@/components/routine/checkbox";
import { ItemRow, NoteRow, TABS, LANE_FOR, isOpenBlocker, tabOf, waitingOn } from "@/lib/plan-model";
import { GoalRef, monthText, quarterText } from "@/lib/plan-v2";
import { habitLoss, plainTags, taskProducts } from "@/lib/plan-v3";
import { useBlocks } from "@/lib/blocks";
import { StreamMeta } from "@/lib/streams";
import { vaultApi } from "@/lib/vault-api";
import { Lane, NotebookEntryData, ProductData } from "@/lib/vault-types";

type Run = (action: () => Promise<unknown>) => Promise<boolean>;

export const label = "mono mb-1.5 block text-[var(--muted-foreground)]";
const field = "w-full border border-[var(--rule)] bg-[var(--background)] px-2.5 py-2 text-small leading-relaxed outline-none focus:border-[var(--accent)]";
const btn = "mono inline-flex min-h-9 items-center px-3.5 disabled:opacity-40";
const solid = `${btn} bg-[var(--foreground)] text-[var(--background)] hover:opacity-90`;
const ghost = `${btn} border border-[var(--rule)] hover:bg-[var(--muted)]`;
const chipBtn = "mono min-h-8 border border-[var(--rule)] px-2.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] aria-pressed:border-[var(--foreground)] aria-pressed:bg-[var(--foreground)] aria-pressed:text-[var(--background)] disabled:opacity-40";
const danger = `${btn} border border-[var(--destructive)] text-[var(--destructive)] hover:bg-[var(--warn-light)]`;

/** A title that saves when you leave it or press Enter. The key resets the draft when the row changes. */
export function TitleField({ value, busy, onSave }: { value: string; busy: boolean; onSave: (text: string) => void }) {
  const [draft, setDraft] = useState(value);
  const save = () => { const t = draft.trim(); if (t && t !== value) onSave(t); else setDraft(value); };
  return (
    <input value={draft} maxLength={300} disabled={busy} aria-label="Title" onChange={(e) => setDraft(e.target.value)} onBlur={save}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setDraft(value); e.currentTarget.blur(); } }}
      className="heading-elegant w-full border-0 border-b border-transparent bg-transparent pb-0.5 text-lg leading-tight outline-none focus:border-[var(--accent)]" />
  );
}

export function NotesField({ value, busy, rows, placeholder, onSave }: { value: string; busy: boolean; rows: number; placeholder: string; onSave: (text: string) => void }) {
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
  /** The "YYYY-MM" months of the current quarter, for the Label picker. */
  months: string[];
  /** The goals the item can be nested under: this quarter's, plus the ended one it is nested under now. */
  goals: GoalRef[];
  blockers: NotebookEntryData[];
  week: string;
  busy: boolean;
  run: Run;
  /** The block's products (Plan v3): chips on the card toggle the matching tags. */
  products?: ProductData[];
  /** Turn the task into a habit (it is deleted); the Plan then opens the habit. Leave out where there is no habit board. */
  onMakeHabit?: (item: ItemRow["item"]) => Promise<void>;
}

/** The detail card of one pipeline item: rename, details, status, goal, label, what it waits on, tags, and the actions. */
export function ItemCard({ row, meta, months, goals, blockers, week, busy, run, products = [], onMakeHabit }: ItemProps) {
  const { item } = row;
  const stream = row.stream;
  const [newTag, setNewTag] = useState("");
  const [linking, setLinking] = useState(item.blocked_by.length > 0);
  const waiting = waitingOn(item, blockers);
  const isOne = item.focus === week;
  const tab = tabOf(row);
  const order: Lane[] = ["now", "next", "backlog"];
  const at = order.indexOf(item.lane);
  const [habitAsk, setHabitAsk] = useState(false);
  const dayBlocks = useBlocks();
  const landing = dayBlocks.list.find((b) => !b.archived)?.label;
  const lost = habitLoss(item);
  const tags = item.products ?? [];
  const mine = taskProducts(tags, products);
  const plain = plainTags(tags, products);
  const rewrite = (list: string[]) => run(() => vaultApi.renamePipelineItem(stream, item, [item.text, ...list.map((p) => (/\s/.test(p) ? `[product:: ${p}]` : `#${p}`))].join(" ")));

  return (
    <>
      <p className="mono text-[var(--muted-foreground)]">Item · {meta.label}</p>
      <TitleField key={item.hash} value={item.text} busy={busy} onSave={(t) => void run(() => vaultApi.renamePipelineItem(stream, item, [t, ...tags.map((p) => `#${p}`)].join(" ")))} />
      {waiting.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {waiting.map((w) => (
            <span key={w.id} className={`mono inline-flex min-w-0 max-w-full items-center gap-1.5 [overflow-wrap:anywhere] px-2 py-1 ${w.found ? "bg-[var(--warn-light)] text-[var(--destructive)]" : "bg-[var(--muted)] text-[var(--muted-foreground)]"}`}>
              <OctagonAlert size={11} aria-hidden="true" className="shrink-0" />{w.found ? w.found.title : "blocker deleted"}
            </span>
          ))}
        </div>
      )}
      <label><span className={label}>Details</span>
        <NotesField key={`${item.hash}-d`} value={item.description} busy={busy} rows={3} placeholder="Details, context, links…" onSave={(t) => void run(() => vaultApi.describePipelineItem(stream, item, t))} />
      </label>
      <div>
        <span className={label}>Status</span>
        <div role="group" aria-label="Status" className="flex w-max max-w-full border border-[var(--rule)]">
          {TABS.filter((t) => t.id !== "notes").map((t) => (
            <button key={t.id} type="button" disabled={busy} aria-pressed={tab === t.id} onClick={() => void run(() => vaultApi.movePipelineItem(stream, item, LANE_FOR[t.id as Exclude<typeof t.id, "notes">]))}
              className="mono min-h-8 border-r border-[var(--rule)] px-3 text-[var(--muted-foreground)] last:border-r-0 hover:bg-[var(--muted)] aria-pressed:bg-[var(--muted)] aria-pressed:text-[var(--foreground)] aria-pressed:shadow-[inset_0_-2px_0_var(--accent)]">{t.label}</button>
          ))}
        </div>
      </div>
      <div>
        <span className={label}>Goal</span>
        <div role="group" aria-label="Goal" className="flex flex-wrap gap-1.5">
          {goals.map((g) => (
            <button key={g.id} type="button" disabled={busy} aria-pressed={item.goal_ref === g.id} title={g.text} onClick={() => void run(() => vaultApi.setPipelineGoal(stream, item, g.id))}
              className={`${chipBtn} min-w-0 max-w-full truncate ${g.ended ? "text-[var(--warn)]" : ""}`}>{quarterText(g.quarter)} · {g.text}{g.ended ? " · ended" : ""}</button>
          ))}
          <button type="button" disabled={busy} aria-pressed={!item.goal_ref || !goals.some((g) => g.id === item.goal_ref)} onClick={() => void run(() => vaultApi.setPipelineGoal(stream, item, null))} className={chipBtn}>Not nested</button>
        </div>
        {goals.every((g) => g.ended) && <p className="mt-1 text-xs text-[var(--muted-foreground)]">No goal for this quarter yet. Add one in the block column.</p>}
      </div>
      <div>
        <span className={label}>Label</span>
        <div role="group" aria-label="Label" className="flex flex-wrap items-center gap-1.5">
          {[...new Set([...months, ...(item.label_month ? [item.label_month] : [])])].map((m) => (
            <button key={m} type="button" disabled={busy} aria-pressed={item.label_month === m} onClick={() => void run(() => vaultApi.setPipelineLabel(stream, item, { month: m }))} className={chipBtn}>{monthText(m)}</button>
          ))}
          <button type="button" disabled={busy} aria-pressed={!item.label_month && !item.label_date} onClick={() => void run(() => vaultApi.setPipelineLabel(stream, item, {}))} className={chipBtn}>None</button>
          <label className="mono flex min-w-0 max-w-full items-center gap-1.5 text-[var(--muted-foreground)]">or date
            <input type="date" aria-label="Label date" disabled={busy} defaultValue={item.label_date ?? ""} key={item.label_date ?? "no-date"}
              onBlur={(e) => { if (e.target.value !== (item.label_date ?? "")) void run(() => vaultApi.setPipelineLabel(stream, item, e.target.value ? { day: e.target.value } : {})); }}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
              className="h-8 min-w-0 border border-[var(--rule)] bg-[var(--background)] px-1.5 text-small" />
          </label>
        </div>
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
      {products.length > 0 && (
        <div>
          <span className={label}>Product</span>
          <div role="group" aria-label="Product" className="flex flex-wrap gap-1.5">
            {products.map((p) => (
              <button key={p.id} type="button" disabled={busy} aria-pressed={mine.includes(p.slug)} data-product-chip={p.slug}
                onClick={() => void run(() => vaultApi.setPipelineProducts(stream, item, mine.includes(p.slug) ? mine.filter((x) => x !== p.slug) : [...mine, p.slug]))}
                className={`${chipBtn} min-w-0 max-w-full [overflow-wrap:anywhere]`}>{p.name}</button>
            ))}
          </div>
        </div>
      )}
      <div>
        <span className={label}>Tags</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {plain.map((t) => (
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
        <dt className="mono text-[var(--muted-foreground)]">Age</dt><dd className="tabular-nums">{item.age_days}d</dd>
        {item.added && <><dt className="mono text-[var(--muted-foreground)]">Added</dt><dd className="tabular-nums">{item.added}</dd></>}
        {item.done_on && <><dt className="mono text-[var(--muted-foreground)]">Done</dt><dd className="tabular-nums">{item.done_on}</dd></>}
      </dl>
      <div className="flex min-w-0 flex-wrap gap-2">
        <button type="button" disabled={busy} className={solid} onClick={() => void run(() => vaultApi.movePipelineItem(stream, item, item.lane === "done" ? "next" : "done"))}>{item.lane === "done" ? "Reopen" : "Mark done"}</button>
        {at > 0 && <button type="button" disabled={busy} className={ghost} onClick={() => void run(() => vaultApi.movePipelineItem(stream, item, order[at - 1]))}>↑ Promote</button>}
        {at >= 0 && at < 2 && <button type="button" disabled={busy} className={ghost} onClick={() => void run(() => vaultApi.movePipelineItem(stream, item, order[at + 1]))}>↓ Demote</button>}
        {meta.weekly && item.lane !== "done" && !isOne && <button type="button" disabled={busy} className={ghost} onClick={() => void run(() => vaultApi.focusPipelineItem(stream, item))}>Make small domino</button>}
        <Link href={`/map?board=life&node=task:${item.line}`} className={ghost}>Show on map</Link>
        {onMakeHabit && item.lane !== "done" && (habitAsk ? (
          <span role="alertdialog" aria-label="Make it a habit?" className="flex flex-wrap items-center gap-2 border border-[var(--rule)] px-2.5 py-1 text-xs">
            This becomes a habit, 3 a week{landing ? ` in ${landing} on the Habits board` : ""}, and the task is deleted.{lost.length > 0 ? ` Not kept: ${lost.join(", ")}.` : ""}
            <button type="button" disabled={busy} className="mono text-[var(--accent)] hover:underline" onClick={() => void onMakeHabit(item)}>Make habit</button>
            <button type="button" className="mono text-[var(--muted-foreground)] hover:underline" onClick={() => setHabitAsk(false)}>Cancel</button>
          </span>
        ) : <button type="button" disabled={busy} className={ghost} onClick={() => setHabitAsk(true)}>↻ Make it a habit</button>)}
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

