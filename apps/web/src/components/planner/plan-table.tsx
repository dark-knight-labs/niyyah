"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Checkbox } from "@/components/routine/checkbox";
import { ItemCard, NoteCard } from "@/components/planner/work-card";
import { isOpenBlocker, waitingOn } from "@/lib/plan-model";
import {
  CAPS, GoalRef, GoalGroup, LabelFilter, capped, columnOf, goalIndex, groupByGoal, isLate, labelOf, matchesLabel, monthText, monthsOfQuarter,
  nestedCount, quarterText, sinceWeek, weekText,
} from "@/lib/plan-v2";
import { StreamMeta } from "@/lib/streams";
import { vaultApi } from "@/lib/vault-api";
import { NotebookEntryData, NotebooksData, PipelineItemData, PipelinesData, QuarterData } from "@/lib/vault-types";

type Run = (action: () => Promise<unknown>) => Promise<boolean>;
type Column = "now" | "next" | "someday";

const COLUMNS: { id: Column; label: string; hint: (week: string) => string }[] = [
  { id: "now", label: "Now", hint: (w) => `this week · ${weekText(w)}` },
  { id: "next", label: "Next", hint: () => "prioritized" },
  { id: "someday", label: "Someday", hint: () => "ideas, notes, links" },
];

const chip = "mono min-h-6 border border-[var(--rule)] px-2 text-[var(--muted-foreground)] hover:bg-[var(--muted)] aria-pressed:border-[var(--foreground)] aria-pressed:bg-[var(--foreground)] aria-pressed:text-[var(--background)]";
const link = "mono text-[var(--accent)] hover:underline";

interface Props {
  streams: StreamMeta[];
  quarter: QuarterData;
  pipelines: PipelinesData;
  notebooks: NotebooksData | null;
  /** Today as YYYY-MM-DD in the planner's timezone. */
  today: string;
  /** The block the page is narrowed to (also steers the capture bar), or null for All. */
  block: string | null;
  onBlock: (id: string | null) => void;
  /** The stream editor, when it is open. */
  editor: React.ReactNode;
  onEdit: (id: string) => void;
  onAddBlock: () => void;
  busy: boolean;
  run: Run;
  message: string;
}

/** What is selected: a task (by its line) or a notebook entry (by its key). */
type Sel = { kind: "item"; stream: string; line: number } | { kind: "note"; stream: string; key: string } | null;

/** The Plan: one table, a row per block (with its quarter goals) against Now, Next and Someday; Done is its own view. */
export function PlanTable({ streams, quarter, pipelines, notebooks, today, block, onBlock, editor, onEdit, onAddBlock, busy, run, message }: Props) {
  const [view, setView] = useState<"plan" | "done">("plan");
  const [label, setLabel] = useState<LabelFilter>("all");
  const [focus, setFocus] = useState<string | null>(null);
  const [sel, setSel] = useState<Sel>(null);
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const months = monthsOfQuarter(quarter.quarter);
  const thisMonth = today.slice(0, 7);
  const week = pipelines.week;
  const itemsOf = (id: string): PipelineItemData[] => pipelines.streams.find((s) => s.stream === id)?.items ?? [];
  const notesOf = (id: string): NotebookEntryData[] => notebooks?.streams.find((n) => n.stream === id)?.entries ?? [];
  const goalsOf = (id: string): GoalRef[] =>
    goalIndex(quarter.streams.find((s) => s.stream === id)?.goal_checklist ?? [], quarter.quarter, pipelines.streams.find((s) => s.stream === id)?.ended_goals);
  const visible = streams.filter((s) => !block || s.id === block);
  const all = pipelines.streams.flatMap((s) => (!block || s.stream === block ? s.items : []));
  const doneItems = all.filter((i) => columnOf(i) === null);
  const lateN = all.filter((i) => isLate(i, today)).length;

  function setDone(stream: string, item: PipelineItemData) {
    return run(() => vaultApi.movePipelineItem(stream, item, columnOf(item) === null ? "next" : "done"));
  }

  function itemLine(stream: StreamMeta, item: PipelineItemData, col: Column, rank: number | null) {
    const lab = labelOf(item);
    const late = isLate(item, today);
    const since = sinceWeek(item, week);
    const blocked = waitingOn(item, notesOf(stream.id)).some((w) => w.found);
    const dim = focus && item.goal_ref !== focus;
    const picked = sel?.kind === "item" && sel.stream === stream.id && sel.line === item.line;
    return (
      <div key={item.line} data-task={item.line} data-check-row className={`flex min-h-7 items-center gap-1.5 border-t border-[var(--border)] first:border-t-0 ${dim ? "opacity-30" : ""} ${picked ? "bg-[var(--muted)] shadow-[inset_2px_0_0_var(--accent)]" : ""}`}>
        {rank !== null && <span className="mono w-3 shrink-0 text-right text-[var(--muted-foreground)]">{rank + 1}</span>}
        <Checkbox checked={false} disabled={busy} label={`Done: ${item.text}`} onChange={() => void setDone(stream.id, item)} />
        <button type="button" onClick={() => setSel({ kind: "item", stream: stream.id, line: item.line })} className={`min-w-0 flex-1 py-0.5 text-left text-small leading-snug hover:text-[var(--accent)] ${blocked ? "text-[var(--destructive)]" : ""}`}>
          {item.focus === week && <span className="mr-1 text-[var(--warn)]" aria-label="Small domino">★</span>}{item.text}
        </button>
        {lab && (
          <span data-label={lab.value} className={`mono shrink-0 border px-1 ${late ? "border-[var(--destructive)] bg-[var(--warn-light)] text-[var(--destructive)]" : "border-[var(--rule)] text-[var(--muted-foreground)]"}`}>{lab.text}</span>
        )}
        {late && (
          <button type="button" disabled={busy} className={`${link} shrink-0`} aria-label={`Move to ${monthText(thisMonth)}: ${item.text}`}
            onClick={() => void run(() => vaultApi.setPipelineLabel(stream.id, item, { month: thisMonth }))}>→ {monthText(thisMonth)}</button>
        )}
        {col === "now" && since && <span className="mono shrink-0 text-[var(--muted-foreground)]">since {since}</span>}
        {col === "next" && (
          <span className="shrink-0 whitespace-nowrap">
            <button type="button" disabled={busy} aria-label={`Move up: ${item.text}`} onClick={() => void run(() => vaultApi.reorderPipelineItem(stream.id, item, "up"))} className="mono px-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)]">↑</button>
            <button type="button" disabled={busy} aria-label={`Move down: ${item.text}`} onClick={() => void run(() => vaultApi.reorderPipelineItem(stream.id, item, "down"))} className="mono px-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)]">↓</button>
          </span>
        )}
      </div>
    );
  }

  function noteLine(stream: StreamMeta, e: NotebookEntryData) {
    const key = e.id ?? `${e.line}:${e.hash}`;
    const picked = sel?.kind === "note" && sel.stream === stream.id && sel.key === key;
    return (
      <div key={`n-${key}`} className={`flex min-h-7 items-center gap-1.5 border-t border-[var(--border)] ${picked ? "bg-[var(--muted)] shadow-[inset_2px_0_0_var(--accent)]" : ""}`}>
        <span className={`mono shrink-0 border px-1 ${isOpenBlocker(e) ? "border-[var(--destructive)] text-[var(--destructive)]" : "border-[var(--rule)] text-[var(--muted-foreground)]"}`}>{e.kind}</span>
        <button type="button" onClick={() => setSel({ kind: "note", stream: stream.id, key })} className="min-w-0 flex-1 py-0.5 text-left text-small leading-snug hover:text-[var(--accent)]">{e.title}</button>
      </div>
    );
  }

  function cell(stream: StreamMeta, col: Column) {
    const key = `${stream.id}:${col}`;
    const everything = itemsOf(stream.id).filter((i) => columnOf(i) === col);
    const ranked = new Map(everything.map((i, n) => [i.line, n]));
    const mine = everything.filter((i) => matchesLabel(i, label, today));
    const notes = col === "someday" && label === "all" ? notesOf(stream.id) : [];
    const combined: (PipelineItemData | NotebookEntryData)[] = [...mine, ...notes];
    const cap = CAPS[col];
    const { shown, more } = capped(combined, cap, !!opened[key]);
    const shownItems = shown.filter((x): x is PipelineItemData => "lane" in x && "goal_ref" in x);
    const shownNotes = shown.filter((x): x is NotebookEntryData => "kind" in x);
    const groups: GoalGroup<PipelineItemData>[] = groupByGoal(shownItems, goalsOf(stream.id));
    if (groups.length === 0 && shownNotes.length === 0) return <span className="text-[var(--muted-foreground)] opacity-60">·</span>;
    return (
      <>
        {groups.map((g) => (
          <div key={g.goal?.id ?? "none"}>
            {(groups.length > 1 || g.goal) && (
              <p className={`mono mt-1.5 truncate first:mt-0 ${g.goal?.ended ? "text-[var(--warn)]" : "text-[var(--muted-foreground)]"} ${focus && g.goal?.id !== focus ? "opacity-30" : ""}`}>
                {g.goal ? `↳ ${g.goal.text}${g.goal.ended ? ` · ${quarterText(g.goal.quarter)} ended` : ""}` : "not nested"}
              </p>
            )}
            {g.items.map((i) => itemLine(stream, i, col, col === "next" ? ranked.get(i.line) ?? 0 : null))}
          </div>
        ))}
        {shownNotes.map((e) => noteLine(stream, e))}
        {more > 0 && <button type="button" className={link} onClick={() => setOpened({ ...opened, [key]: true })}>+{more} more</button>}
        {more === 0 && opened[key] && combined.length > cap && <button type="button" className={link} onClick={() => setOpened({ ...opened, [key]: false })}>less</button>}
      </>
    );
  }

  function addGoal(stream: StreamMeta) {
    const text = draft.trim();
    if (!text) return;
    const lines = (quarter.streams.find((s) => s.stream === stream.id)?.goal_checklist ?? []).map((l) => ({ id: l.id, text: l.text, done: l.done }));
    void run(() => vaultApi.updateStream(stream.id, { goal_checklist: [...lines, { text }] })).then((ok) => { if (ok) { setDraft(""); setAdding(null); } });
  }

  function blockCell(stream: StreamMeta) {
    const goals = goalsOf(stream.id).filter((g) => !g.ended);
    const lines = quarter.streams.find((s) => s.stream === stream.id)?.goal_checklist ?? [];
    const nowN = itemsOf(stream.id).filter((i) => columnOf(i) === "now").length;
    const items = itemsOf(stream.id);
    return (
      <td className="bg-[var(--surface)] px-3 py-3 align-top">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="h-2 w-2 shrink-0" style={{ background: stream.color }} aria-hidden="true" />
          <b className="text-small font-semibold">{stream.label}</b>
          {nowN > pipelines.now_limit && <span className="mono text-[var(--warn)]">Now {nowN}/{pipelines.now_limit}</span>}
          <button type="button" onClick={() => onEdit(stream.id)} aria-label={`Edit ${stream.label}`} className={`${link} ml-auto`}>Edit</button>
        </div>
        <div className="mt-1.5" role="list" aria-label={`${stream.label} goals`}>
          {goals.map((g) => {
            const line = lines.find((l) => l.id === g.id);
            const n = nestedCount(items, g.id);
            return (
              <div key={g.id} role="listitem" data-goal={g.id} className={`flex items-center gap-1.5 border-t border-[var(--border)] py-0.5 first:border-t-0 ${focus === g.id ? "bg-[var(--muted)] shadow-[inset_2px_0_0_var(--accent)]" : ""}`}>
                <Checkbox checked={!!line?.done} disabled={busy} label={`Goal reached: ${g.text}`} onChange={() => void run(() => vaultApi.tickStreamItem(stream.id, "goal", g.id, !line?.done))} />
                <button type="button" aria-pressed={focus === g.id} title="Show only the tasks nested under this goal" onClick={() => setFocus(focus === g.id ? null : g.id)}
                  className={`min-w-0 flex-1 text-left text-small font-medium leading-snug hover:text-[var(--accent)] ${line?.done ? "text-[var(--muted-foreground)] line-through" : ""}`}>{g.text}</button>
                {n.total > 0 && <span className="mono shrink-0 text-[var(--muted-foreground)]" title="tasks done / nested">{n.done}/{n.total}</span>}
              </div>
            );
          })}
          {goals.length === 0 && <p className="text-xs text-[var(--muted-foreground)]">No {quarterText(quarter.quarter)} goal yet.</p>}
        </div>
        {adding === stream.id ? (
          <form className="mt-1 flex gap-1" onSubmit={(e) => { e.preventDefault(); addGoal(stream); }}>
            <input autoFocus value={draft} maxLength={300} aria-label={`New ${quarterText(quarter.quarter)} goal for ${stream.label}`} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setAdding(null)}
              className="min-w-0 flex-1 border border-[var(--rule)] bg-[var(--background)] px-1.5 py-1 text-small outline-none focus:border-[var(--accent)]" />
            <button type="submit" disabled={busy || !draft.trim()} className={`${chip} disabled:opacity-40`}>Add</button>
          </form>
        ) : (
          <button type="button" className={`${link} mt-1`} onClick={() => { setAdding(stream.id); setDraft(""); }}>+ {quarterText(quarter.quarter)} goal</button>
        )}
      </td>
    );
  }

  const selected = (() => {
    if (!sel) return null;
    const meta = streams.find((s) => s.id === sel.stream);
    if (!meta) return null;
    if (sel.kind === "item") {
      const item = itemsOf(sel.stream).find((i) => i.line === sel.line);
      return item ? { meta, item, entry: null } : null;
    }
    const entry = notesOf(sel.stream).find((e) => (e.id ?? `${e.line}:${e.hash}`) === sel.key);
    return entry ? { meta, item: null, entry } : null;
  })();

  const filterGroup = (
    <div role="group" aria-label="Block" className="flex flex-wrap items-center gap-1.5">
      <span className="mono mr-1 text-[var(--muted-foreground)]">Block</span>
      <button type="button" aria-pressed={!block} onClick={() => onBlock(null)} className={chip}>All blocks</button>
      {streams.map((s) => <button key={s.id} type="button" aria-pressed={block === s.id} onClick={() => onBlock(block === s.id ? null : s.id)} className={chip}>{s.label}</button>)}
      <button type="button" onClick={onAddBlock} aria-label="Add a block" className={`${chip} inline-flex items-center gap-1`}><Plus size={11} aria-hidden="true" />Block</button>
    </div>
  );

  return (
    <div>
      <div className="grid gap-2 border-b border-[var(--border)] px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {view === "plan" ? (
            <div role="group" aria-label="Label" className="flex flex-wrap items-center gap-1.5">
              <span className="mono mr-1 text-[var(--muted-foreground)]">Label</span>
              {[["all", "All"], ...months.map((m) => [m, monthText(m)]), ["none", "No label"], ...(lateN ? [["late", `Late ${lateN}`]] : [])].map(([k, l]) => (
                <button key={k} type="button" aria-pressed={label === k} onClick={() => setLabel(k)} className={`${chip} ${k === "late" ? "text-[var(--destructive)]" : ""}`}>{l}</button>
              ))}
              {focus && <button type="button" aria-pressed="true" onClick={() => setFocus(null)} className={chip}>One goal ×</button>}
            </div>
          ) : <span className="mono text-[var(--muted-foreground)]">Done · {doneItems.length}</span>}
          <button type="button" aria-pressed={view === "done"} onClick={() => { setView(view === "done" ? "plan" : "done"); setSel(null); }} className={chip}>
            {view === "done" ? "Back to Plan" : `Done ${doneItems.length}`}
          </button>
        </div>
        {filterGroup}
      </div>
      {editor && <div className="border-b border-[var(--border)] p-4">{editor}</div>}

      <div className={`grid ${selected ? "lg:grid-cols-[minmax(0,1fr)_23rem]" : ""}`}>
        <div className="min-w-0 overflow-x-auto" data-testid="plan-scroll">
          {view === "plan" ? (
            <table aria-label="Plan" className="w-full min-w-[60rem] table-fixed border-collapse text-small">
              <colgroup><col className="w-[25%]" /><col /><col /><col className="w-[22%]" /></colgroup>
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th scope="col" className="mono px-3 py-2 text-left align-bottom font-medium text-[var(--muted-foreground)]">Block<span className="block font-normal">{quarterText(quarter.quarter)} goals</span></th>
                  {COLUMNS.map((c) => (
                    <th key={c.id} scope="col" className="mono border-l border-[var(--border)] px-3 py-2 text-left align-bottom font-medium text-[var(--muted-foreground)]">
                      {c.label} <span className="tabular-nums text-[var(--foreground)]">{visible.reduce((n, s) => n + itemsOf(s.id).filter((i) => columnOf(i) === c.id && matchesLabel(i, label, today)).length, 0)}</span>
                      <span className="block font-normal">{c.hint(week)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((s) => (
                  <tr key={s.id} data-block={s.id} className="border-b border-[var(--border)] align-top last:border-b-0">
                    {blockCell(s)}
                    {COLUMNS.map((c) => <td key={c.id} data-col={c.id} className={`border-l border-[var(--border)] px-3 py-3 align-top ${c.id === "now" ? "bg-[var(--accent-light)]" : ""}`}>{cell(s, c.id)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table aria-label="Done" className="w-full min-w-[40rem] table-fixed border-collapse text-small">
              <colgroup><col /><col className="w-[11rem]" /><col className="w-[30%]" /><col className="w-[7rem]" /></colgroup>
              <thead>
                <tr className="border-b border-[var(--border)]">
                  {["Item", "Block", "Goal", "Label"].map((h, n) => <th key={h} scope="col" className={`mono px-3 py-2 text-left font-medium text-[var(--muted-foreground)] ${n ? "border-l border-[var(--border)]" : ""}`}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {visible.flatMap((s) => itemsOf(s.id).filter((i) => columnOf(i) === null).map((i) => {
                  const g = goalsOf(s.id).find((x) => x.id === i.goal_ref);
                  return (
                    <tr key={i.line} data-done-task={i.line} className="border-b border-[var(--border)]">
                      <td className="px-3 py-1">
                        <div className="flex items-center gap-1.5">
                          <Checkbox checked disabled={busy} label={`Reopen: ${i.text}`} onChange={() => void setDone(s.id, i)} />
                          <span className="min-w-0 text-[var(--muted-foreground)] line-through">{i.text}</span>
                        </div>
                      </td>
                      <td className="border-l border-[var(--border)] px-3 py-1"><span className="mr-1.5 inline-block h-2 w-2" style={{ background: s.color }} aria-hidden="true" />{s.label}</td>
                      <td className="border-l border-[var(--border)] px-3 py-1 text-[var(--muted-foreground)]">{g ? g.text : "·"}</td>
                      <td className="mono border-l border-[var(--border)] px-3 py-1 text-[var(--muted-foreground)]">{labelOf(i)?.text ?? "·"}</td>
                    </tr>
                  );
                }))}
                {doneItems.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-[var(--muted-foreground)]">Nothing done yet.</td></tr>}
              </tbody>
            </table>
          )}
          {message && <p role="status" className="mono px-4 py-2 text-[var(--accent)]">{message}</p>}
        </div>

        {selected && (
          <aside aria-label="Item" aria-live="polite" className="grid content-start gap-4 border-t border-[var(--border)] bg-[var(--surface)] p-4 lg:border-l lg:border-t-0">
            <button type="button" onClick={() => setSel(null)} className={`${link} justify-self-end`}>Close</button>
            {selected.item ? (
              <ItemCard key={`${selected.item.line}:${selected.item.hash}`} row={{ type: "item", key: String(selected.item.line), stream: selected.meta.id, item: selected.item }} meta={selected.meta}
                months={months} goals={goalsOf(selected.meta.id).filter((g) => !g.ended || g.id === selected.item.goal_ref)}
                blockers={notesOf(selected.meta.id).filter((e) => e.kind === "blocker")} week={week} busy={busy} run={run} />
            ) : selected.entry && (
              <NoteCard key={selected.entry.id ?? selected.entry.line} row={{ type: "note", key: String(selected.entry.line), stream: selected.meta.id, entry: selected.entry }} meta={selected.meta} busy={busy} run={run} />
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
