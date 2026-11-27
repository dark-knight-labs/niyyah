"use client";

import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { PageSlot } from "@/components/page-slot";
import { Checkbox } from "@/components/routine/checkbox";
import type { AddColumn } from "@/components/planner/capture-bar";
import { BlockCell } from "@/components/planner/block-cell";
import { PlanHabitCard, RunHabits, WeekTicks } from "@/components/planner/plan-habits";
import { ItemCard, NoteCard } from "@/components/planner/work-card";
import { isOpenBlocker, waitingOn } from "@/lib/plan-model";
import {
  CAPS, GoalRef, GoalGroup, LabelFilter, capped, columnOf, goalIndex, groupByGoal, isLate, labelOf, matchesLabel, monthText, monthsOfQuarter,
  quarterText, sinceWeek, weekText,
} from "@/lib/plan-v2";
import { planBlockOf, planHabits, quarterTabs, tabLabel } from "@/lib/plan-v3";
import { StreamMeta } from "@/lib/streams";
import { vaultApi } from "@/lib/vault-api";
import { HabitsData, NotebookEntryData, NotebooksData, PipelineItemData, PipelinesData, ProductData, QuarterData } from "@/lib/vault-types";

type Run = (action: () => Promise<unknown>) => Promise<boolean>;
type Column = AddColumn;

/** A task that was just added: its column opens in that block so the new row (it lands last) is not behind "+N more". */
export interface Reveal { stream: string; column: Column; seq: number }

const COLUMNS: { id: Column; label: string; hint: (week: string) => string }[] = [
  { id: "now", label: "Now", hint: (w) => `this week · ${weekText(w)}` },
  { id: "next", label: "Next", hint: () => "prioritized" },
  { id: "someday", label: "Someday", hint: () => "ideas, notes, links" },
];

/** Below this width (px) of the table area the three columns no longer fit side by side, so one is open and the others are rails. 60rem is the width the table was always built for (its old min-width). */
const NARROW_BELOW = 960;

const chip = "mono min-h-6 border border-[var(--rule)] px-2 text-[var(--muted-foreground)] hover:bg-[var(--muted)] aria-pressed:border-[var(--foreground)] aria-pressed:bg-[var(--foreground)] aria-pressed:text-[var(--background)]";
/** The detail panel. From lg up it is sticky beside the table, under the 2.75rem header. Below lg it is fixed to the right edge (over the list), with its own scroll. */
const PANEL = "grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-4 border-[var(--border)] bg-[var(--surface)] p-4 "
  + "max-lg:fixed max-lg:bottom-0 max-lg:right-0 max-lg:top-11 max-lg:z-40 max-lg:w-[min(90vw,420px)] max-lg:overflow-y-auto max-lg:border-l max-lg:shadow-xl "
  + "lg:sticky lg:top-11 lg:max-h-[calc(100dvh-2.75rem)] lg:self-start lg:overflow-y-auto lg:border-l";
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
  /** Habits (Plan v3): shown under their goals and as this week's ticks in Now. Null until loaded. */
  habits: HabitsData | null;
  runHabits: RunHabits;
  /** The "+" in a column header: write a new task into that column (the page points the capture line there). */
  onAdd: (column: Column) => void;
  /** Opens a column after an add; a new `seq` applies it once. */
  reveal?: Reveal | null;
  /** Turn a task into a habit (the task is deleted); answers with the new habit's id, or null when it failed. */
  makeHabit: (stream: string, item: PipelineItemData) => Promise<number | null>;
}

/** What is selected: a task (by its line) or a notebook entry (by its key). */
type Sel = { kind: "item"; stream: string; line: number } | { kind: "note"; stream: string; key: string } | { kind: "habit"; id: number } | null;

/** The Plan: one table, a row per block (with its quarter goals) against Now, Next and Someday; Done is its own view. */
export function PlanTable({ streams, quarter, pipelines, notebooks, today, block, onBlock, editor, onEdit, onAddBlock, busy, run, message, habits, runHabits, makeHabit, onAdd, reveal = null }: Props) {
  const [view, setView] = useState<"plan" | "done">("plan");
  const [label, setLabel] = useState<LabelFilter>("all");
  const [focus, setFocus] = useState<string | null>(null);
  const [sel, setSel] = useState<Sel>(null);
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  // Narrow table area: the one open column (the others are rails). Component state only.
  const [colFocus, setColFocus] = useState<Column>("now");
  const [narrow, setNarrow] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const [seenReveal, setSeenReveal] = useState(0);
  if (reveal && reveal.seq !== seenReveal) {
    setSeenReveal(reveal.seq);
    setOpened({ ...opened, [`${reveal.stream}:${reveal.column}`]: true });
    setColFocus(reveal.column);
  }
  // The quarter tab that is open (null = the current quarter) and quarters opened with "+" that have no goal yet.
  const [openQ, setOpenQ] = useState<string | null>(null);
  const [extraQ, setExtraQ] = useState<string[]>([]);

  const months = monthsOfQuarter(quarter.quarter);
  const thisMonth = today.slice(0, 7);
  const week = pipelines.week;
  const itemsOf = (id: string): PipelineItemData[] => pipelines.streams.find((s) => s.stream === id)?.items ?? [];
  const notesOf = (id: string): NotebookEntryData[] => notebooks?.streams.find((n) => n.stream === id)?.entries ?? [];
  const current = quarter.quarter;
  const tabs = quarterTabs(current, pipelines.quarters, extraQ);
  const shownQ = openQ && tabs.tabs.includes(openQ) ? openQ : current;
  const productsOf = (id: string): ProductData[] => pipelines.streams.find((s) => s.stream === id)?.products ?? [];
  /** The goal lines of a block in one quarter (the current quarter's come from the quarter, later ones from the pipelines read). */
  const linesOf = (id: string, q: string) =>
    q === current ? quarter.streams.find((s) => s.stream === id)?.goal_checklist ?? [] : pipelines.streams.find((s) => s.stream === id)?.quarter_goals?.find((x) => x.quarter === q)?.goals ?? [];
  /** Every goal a task of the block can be nested under: this quarter's, later quarters', then the ended ones. */
  const goalsOf = (id: string): GoalRef[] => {
    const base = goalIndex(linesOf(id, current), current, pipelines.streams.find((s) => s.stream === id)?.ended_goals);
    const later = (pipelines.streams.find((s) => s.stream === id)?.quarter_goals ?? []).filter((x) => x.quarter > current)
      .flatMap((x) => x.goals.map((g) => ({ id: g.id, text: g.text, quarter: x.quarter, ended: false })))
      .filter((g) => !base.some((b) => b.id === g.id));
    return [...base.filter((g) => !g.ended), ...later, ...base.filter((g) => g.ended)];
  };
  const liveHabits = planHabits(habits?.habits ?? [], streams.map((s) => s.id));
  const habitsOf = (id: string) => liveHabits.filter((h) => planBlockOf(h) === id);
  const visible = streams.filter((s) => !block || s.id === block);
  const all = pipelines.streams.flatMap((s) => (!block || s.stream === block ? s.items : []));
  const doneItems = all.filter((i) => columnOf(i) === null);
  const lateN = all.filter((i) => isLate(i, today)).length;

  /** Items in a column across the visible blocks, after the label filter (the number a header or rail shows). */
  const columnCount = (col: Column, only?: string) =>
    visible.reduce((n, s) => n + (only && s.id !== only ? 0 : itemsOf(s.id).filter((i) => columnOf(i) === col && matchesLabel(i, label, today)).length), 0);

  function setDone(stream: string, item: PipelineItemData) {
    return run(() => vaultApi.movePipelineItem(stream, item, columnOf(item) === null ? "next" : "done"));
  }

  /** Swap with the neighbour shown above or below: the API swaps lane neighbours, so repeat it for the items between them. */
  function moveTo(stream: StreamMeta, item: PipelineItemData, neighbour: PipelineItemData, direction: "up" | "down", ranked: Map<number, number>) {
    const steps = Math.abs((ranked.get(item.line) ?? 0) - (ranked.get(neighbour.line) ?? 0));
    return run(async () => { for (let i = 0; i < steps; i++) await vaultApi.reorderPipelineItem(stream.id, item, direction); });
  }

  function itemLine(stream: StreamMeta, item: PipelineItemData, col: Column, rank: number | null, nav?: { up: () => void; down: () => void; hasUp: boolean; hasDown: boolean }) {
    const lab = labelOf(item);
    const late = isLate(item, today);
    const since = sinceWeek(item, week);
    const blocked = waitingOn(item, notesOf(stream.id)).some((w) => w.found);
    const dim = focus && item.goal_ref !== focus;
    const picked = sel?.kind === "item" && sel.stream === stream.id && sel.line === item.line;
    return (
      <div key={item.line} data-task={item.line} data-stream={stream.id} data-check-row className={`flex min-h-7 items-center gap-1.5 border-t border-[var(--border)] first:border-t-0 ${dim ? "opacity-30" : ""} ${picked ? "bg-[var(--muted)] shadow-[inset_2px_0_0_var(--accent)]" : ""}`}>
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
        {col === "next" && nav && (
          <span className="shrink-0 whitespace-nowrap">
            {nav.hasUp && <button type="button" disabled={busy} aria-label={`Move up: ${item.text}`} onClick={nav.up} className="mono px-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)]">↑</button>}
            {nav.hasDown && <button type="button" disabled={busy} aria-label={`Move down: ${item.text}`} onClick={nav.down} className="mono px-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)]">↓</button>}
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
    // Open blockers come first, outside the cap and the label filter: something is stuck and must not hide.
    const blockers = col === "someday" ? notesOf(stream.id).filter(isOpenBlocker) : [];
    const notes = col === "someday" && label === "all" ? notesOf(stream.id).filter((e) => !isOpenBlocker(e)) : [];
    const combined: (PipelineItemData | NotebookEntryData)[] = [...mine, ...notes];
    const cap = CAPS[col];
    const { shown, more } = capped(combined, cap, !!opened[key]);
    const shownItems = shown.filter((x): x is PipelineItemData => "lane" in x && "goal_ref" in x);
    const shownNotes = shown.filter((x): x is NotebookEntryData => "kind" in x);
    const groups: GoalGroup<PipelineItemData>[] = groupByGoal(shownItems, goalsOf(stream.id));
    if (groups.length === 0 && shownNotes.length === 0 && blockers.length === 0) return <span className="text-[var(--muted-foreground)] opacity-60">·</span>;
    const plain = label === "all" && !focus; // a filter hides items, so the order the arrows act on is not the order shown
    let shownRank = 0;
    return (
      <>
        {blockers.map((e) => noteLine(stream, e))}
        {groups.map((g) => (
          <div key={g.removed ? "removed" : g.goal?.id ?? "none"}>
            {(groups.length > 1 || g.goal || g.removed) && (
              <p className={`mono mt-1.5 truncate first:mt-0 ${g.goal?.ended || g.removed ? "text-[var(--warn)]" : "text-[var(--muted-foreground)]"} ${focus && g.goal?.id !== focus ? "opacity-30" : ""}`}>
                {g.removed ? "↳ (removed goal)" : g.goal ? `↳ ${g.goal.text}${g.goal.ended ? ` · ${quarterText(g.goal.quarter)} ended` : g.goal.quarter !== current ? ` · ${quarterText(g.goal.quarter)}` : ""}` : "not nested"}
              </p>
            )}
            {g.items.map((i, at) => {
              const up = g.items[at - 1], down = g.items[at + 1];
              return itemLine(stream, i, col, col === "next" ? shownRank++ : null, col === "next" && plain
                ? { hasUp: !!up, hasDown: !!down, up: () => void moveTo(stream, i, up, "up", ranked), down: () => void moveTo(stream, i, down, "down", ranked) }
                : undefined);
            })}
          </div>
        ))}
        {shownNotes.map((e) => noteLine(stream, e))}
        {more > 0 && <button type="button" className={link} onClick={() => setOpened({ ...opened, [key]: true })}>+{more} more</button>}
        {more === 0 && opened[key] && combined.length > cap && <button type="button" className={link} onClick={() => setOpened({ ...opened, [key]: false })}>less</button>}
      </>
    );
  }

  function blockCell(stream: StreamMeta) {
    const stuck = notesOf(stream.id).filter(isOpenBlocker);
    return (
      <BlockCell stream={stream} quarter={shownQ} currentQuarter={current} lines={linesOf(stream.id, shownQ)} goalRefs={goalsOf(stream.id)}
        products={productsOf(stream.id)} items={itemsOf(stream.id)} habits={habitsOf(stream.id)} focus={focus} onFocus={setFocus}
        nowN={itemsOf(stream.id).filter((i) => columnOf(i) === "now").length} nowLimit={pipelines.now_limit}
        stuck={stuck.map((e) => ({ id: e.id ?? `${e.line}:${e.hash}`, title: e.title }))}
        onStuck={() => setSel({ kind: "note", stream: stream.id, key: stuck[0].id ?? `${stuck[0].line}:${stuck[0].hash}` })}
        onEdit={() => onEdit(stream.id)} pickedHabit={sel?.kind === "habit" ? sel.id : null} onPickHabit={(id) => setSel({ kind: "habit", id })}
        busy={busy} run={run} runHabits={runHabits} />
    );
  }

  // Is there room for all three columns? Measure the table area (not the window): the open detail panel takes width from it.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const measure = () => setNarrow(el.clientWidth < NARROW_BELOW);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The old work list's keys: J and K move down and up the tasks on screen, X ticks, S makes the small domino, / goes to the capture bar.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (!t || e.metaKey || e.ctrlKey || e.altKey || view !== "plan") return;
      if (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.closest("[role=menu]")) return;
      if (e.key === "/") { e.preventDefault(); document.getElementById("plan-capture")?.focus(); return; }
      const rows = [...document.querySelectorAll<HTMLElement>("[data-task]")].map((el) => ({ stream: el.dataset.stream ?? "", line: Number(el.dataset.task) }));
      const at = sel?.kind === "item" ? rows.findIndex((r) => r.stream === sel.stream && r.line === sel.line) : -1;
      const pick = (r?: { stream: string; line: number }) => r && setSel({ kind: "item", stream: r.stream, line: r.line });
      if (e.key === "j") pick(rows[at + 1]);
      else if (e.key === "k") pick(rows[at - 1]);
      else if (sel?.kind === "item") {
        const item = itemsOf(sel.stream).find((i) => i.line === sel.line);
        if (!item) return;
        if (e.key === "x") void setDone(sel.stream, item);
        else if (e.key === "s" && streams.find((m) => m.id === sel.stream)?.weekly) void run(() => vaultApi.focusPipelineItem(sel.stream, item));
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const selectedHabit = sel?.kind === "habit" ? liveHabits.find((h) => h.id === sel.id) ?? habits?.habits.find((h) => h.id === sel.id) ?? null : null;
  const selected = (() => {
    if (!sel || sel.kind === "habit") return null;
    const meta = streams.find((s) => s.id === sel.stream);
    if (!meta) return null;
    if (sel.kind === "item") {
      const item = itemsOf(sel.stream).find((i) => i.line === sel.line);
      return item ? { meta, item, entry: null } : null;
    }
    const entry = notesOf(sel.stream).find((e) => (e.id ?? `${e.line}:${e.hash}`) === sel.key);
    return entry ? { meta, item: null, entry } : null;
  })();

  const sel_ = "mono min-h-8 min-w-0 max-w-full border border-[var(--rule)] bg-[var(--background)] px-1.5 text-[var(--foreground)]";
  const labelOptions: [string, string][] = [["all", "All"], ...months.map((m): [string, string] => [m, monthText(m)]), ["none", "No label"], ...(lateN || label === "late" ? [["late", `Late ${lateN}`] as [string, string]] : [])];
  // Page-level controls: compact menus. From md up they sit in the top bar (PageSlot); on phones they are one row above the table.
  const controls = (
    <div className="flex min-w-0 items-center gap-2 max-lg:border-b max-lg:border-[var(--border)] max-lg:px-4 max-lg:py-2" data-testid="plan-controls">
      {view === "plan" ? (
        <label className="flex min-w-0 items-center gap-1 text-[var(--muted-foreground)] max-lg:flex-1">
          <span className="mono max-md:sr-only">Label</span>
          <select aria-label="Label" value={label} onChange={(e) => setLabel(e.target.value)} className={`${sel_} ${label === "late" ? "text-[var(--destructive)]" : ""}`}>
            {labelOptions.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
      ) : <span className="mono text-[var(--muted-foreground)]">Done · {doneItems.length}</span>}
      <label className="flex min-w-0 items-center gap-1 text-[var(--muted-foreground)] max-lg:flex-1">
        <span className="mono max-md:sr-only">Block</span>
        <select aria-label="Block" value={block ?? ""} onChange={(e) => onBlock(e.target.value || null)} className={sel_}>
          <option value="">All blocks</option>
          {streams.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </label>
      <button type="button" onClick={onAddBlock} aria-label="Add a block" title="Add a block" className={`${chip} inline-flex min-h-8 shrink-0 items-center gap-1`}><Plus size={11} aria-hidden="true" /><span className="max-lg:sr-only">Block</span></button>
      {focus && view === "plan" && <button type="button" aria-pressed="true" onClick={() => setFocus(null)} className={`${chip} min-h-8 shrink-0`}>One goal ×</button>}
      <button type="button" aria-pressed={view === "done"} onClick={() => { setView(view === "done" ? "plan" : "done"); setSel(null); }} className={`${chip} min-h-8 shrink-0`}>
        {view === "done" ? "Back to Plan" : `Done ${doneItems.length}`}
      </button>
    </div>
  );

  return (
    <div>
      <PageSlot minPx={1024}>{controls}</PageSlot>
      {editor && <div className="border-b border-[var(--border)] p-4">{editor}</div>}

      <div className={`grid ${selected || selectedHabit ? "lg:grid-cols-[minmax(0,1fr)_23rem]" : ""}`}>
        <div ref={area} className="min-w-0 overflow-x-auto" data-testid="plan-scroll" data-narrow={narrow}>
          {view === "plan" ? (
            <table aria-label="Plan" className={`w-full table-fixed border-collapse text-small ${narrow ? "min-w-[32.5rem]" : "min-w-[60rem]"}`}>
              <colgroup>
                <col className={narrow ? "w-44" : "w-[25%]"} />
                {COLUMNS.map((c) => <col key={c.id} className={narrow ? (c.id === colFocus ? "" : "w-11") : c.id === "someday" ? "w-[22%]" : ""} />)}
              </colgroup>
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th scope="col" className="mono px-3 py-2 text-left align-bottom font-medium text-[var(--muted-foreground)]">Block
                    <span role="group" aria-label="Quarter" className="mt-1 flex flex-wrap gap-1 font-normal">
                      {tabs.tabs.map((q) => <button key={q} type="button" aria-pressed={shownQ === q} onClick={() => setOpenQ(q)} className={chip}>{tabLabel(q, current)}</button>)}
                      <button type="button" aria-label={`Add quarter ${quarterText(tabs.plus)}`} title={`Open ${quarterText(tabs.plus)}`} onClick={() => { setExtraQ([...extraQ, tabs.plus]); setOpenQ(tabs.plus); }} className={chip}>+</button>
                    </span>
                    <span className="mt-1 block font-normal">{quarterText(shownQ)} goals</span></th>
                  {COLUMNS.map((c) => {
                    const n = columnCount(c.id);
                    if (narrow && c.id !== colFocus) {
                      // A rail: the column's name and count, written upright down the side; a click opens it and closes the open one.
                      return (
                        <th key={c.id} scope="col" data-col={c.id} data-rail className="mono border-l border-[var(--border)] p-0 align-top font-medium text-[var(--muted-foreground)]">
                          <button type="button" aria-expanded="false" aria-label={`Open ${c.label}, ${n} ${n === 1 ? "item" : "items"}`} onClick={() => setColFocus(c.id)}
                            className="flex w-full flex-col items-center gap-1 px-1 py-2 hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
                            <span className="tabular-nums text-[var(--foreground)]">{n}</span>
                            <span className="[writing-mode:vertical-rl]">{c.label}</span>
                          </button>
                        </th>
                      );
                    }
                    return (
                      <th key={c.id} scope="col" data-col={c.id} className="mono border-l border-[var(--border)] px-3 py-2 text-left align-bottom font-medium text-[var(--muted-foreground)]">
                        <span className="flex items-center justify-between gap-2">
                          <span>{c.label} <span className="tabular-nums text-[var(--foreground)]">{n}</span></span>
                          <button type="button" disabled={busy} onClick={() => onAdd(c.id)} aria-label={`Add to ${c.label}`} title={`Add to ${c.label}`} className={`${chip} inline-flex min-h-6 items-center`}><Plus size={11} aria-hidden="true" /></button>
                        </span>
                        <span className="block font-normal">{c.hint(week)}</span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {visible.map((s) => (
                  <tr key={s.id} data-block={s.id} className="border-b border-[var(--border)] align-top last:border-b-0">
                    {blockCell(s)}
                    {COLUMNS.map((c) => narrow && c.id !== colFocus ? (
                      // A rail cell shows only how many tasks this block has in the column; its tasks are not rendered.
                      <td key={c.id} data-col={c.id} data-rail onClick={() => setColFocus(c.id)} title={`Open ${c.label}`}
                        className={`mono cursor-pointer border-l border-[var(--border)] px-1 py-3 text-center align-top tabular-nums text-[var(--muted-foreground)] hover:bg-[var(--muted)] ${c.id === "now" ? "bg-[var(--accent-light)]" : ""}`}>
                        {columnCount(c.id, s.id) || "·"}
                      </td>
                    ) : (
                      <td key={c.id} data-col={c.id} className={`border-l border-[var(--border)] px-3 py-3 align-top ${c.id === "now" ? "bg-[var(--accent-light)]" : ""}`}>
                        {c.id === "now" && <WeekTicks habits={habitsOf(s.id)} today={today} busy={busy} runHabits={runHabits} dim={(h) => !!focus && h.goal_ref !== focus} onPick={(id) => setSel({ kind: "habit", id })} />}
                        {cell(s, c.id)}
                      </td>
                    ))}
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
          <p className="mono flex flex-wrap gap-x-5 gap-y-1 px-4 py-2.5 text-[var(--muted-foreground)]">
            <span>J K move</span><span>X done</span><span>S small domino</span><span>/ capture</span>
            {message && <span role="status" className="text-[var(--accent)]">{message}</span>}
          </p>
        </div>

        {selectedHabit && (
          <aside aria-label="Habit" aria-live="polite" className={PANEL}>
            <PlanHabitCard key={selectedHabit.id} habit={selectedHabit} busy={busy} runHabits={runHabits} onClose={() => setSel(null)}
              goals={(planBlockOf(selectedHabit) ? goalsOf(planBlockOf(selectedHabit)!) : []).filter((g) => !g.ended || g.id === selectedHabit.goal_ref)} />
          </aside>
        )}
        {selected && (
          <aside aria-label="Item" aria-live="polite" className={PANEL}>
            <button type="button" onClick={() => setSel(null)} className={`${link} justify-self-end max-lg:sticky max-lg:top-0 max-lg:z-10 max-lg:bg-[var(--surface)] max-lg:py-1`}>Close</button>
            {selected.item ? (
              <ItemCard key={`${selected.item.line}:${selected.item.hash}`} row={{ type: "item", key: String(selected.item.line), stream: selected.meta.id, item: selected.item }} meta={selected.meta}
                months={months} goals={goalsOf(selected.meta.id).filter((g) => !g.ended || g.id === selected.item.goal_ref)}
                blockers={notesOf(selected.meta.id).filter((e) => e.kind === "blocker")} week={week} busy={busy} run={run}
                products={productsOf(selected.meta.id)} onMakeHabit={async (item) => { const id = await makeHabit(selected.meta.id, item); if (id !== null) setSel({ kind: "habit", id }); }} />
            ) : selected.entry && (
              <NoteCard key={selected.entry.id ?? selected.entry.line} row={{ type: "note", key: String(selected.entry.line), stream: selected.meta.id, entry: selected.entry }} meta={selected.meta} busy={busy} run={run} />
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
