"use client";

import { useState } from "react";
import { Pick } from "@/components/planner/pick";
import { useBlocks } from "@/lib/blocks";
import { STAGE_LABEL, gateLabel, watching } from "@/lib/habit";
import { StreamMeta } from "@/lib/streams";
import { HabitData, HabitFields, HabitStage, HabitsData } from "@/lib/vault-types";
import { vaultApi } from "@/lib/vault-api";

type RunHabits = (action: () => Promise<HabitsData>) => Promise<boolean>;

const label = "mono mb-1.5 block text-[var(--muted-foreground)]";
const box = "border border-[var(--rule)] bg-[var(--background)] px-2.5 py-2 text-small outline-none focus:border-[var(--accent)]";
const field = `w-full ${box}`;
const btn = "mono inline-flex min-h-9 items-center px-3.5 disabled:opacity-40";
const solid = `${btn} bg-[var(--foreground)] text-[var(--background)] hover:opacity-90`;
const ghost = `${btn} border border-[var(--rule)] hover:bg-[var(--muted)]`;
const danger = `${btn} border border-[var(--destructive)] text-[var(--destructive)] hover:bg-[var(--warn-light)]`;

const WEEK_OPTIONS = [7, 6, 5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: n === 7 ? "Every day" : `${n} a week` }));

/** A text field that saves when you leave it or press Enter; the key resets the draft when the habit changes. */
function Text({ value, max, busy, ariaLabel, placeholder, onSave }: { value: string; max: number; busy: boolean; ariaLabel: string; placeholder?: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const save = () => { const t = draft.trim(); if (t !== value) onSave(t); };
  return (
    <input value={draft} maxLength={max} disabled={busy} aria-label={ariaLabel} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={save}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setDraft(value); e.currentTarget.blur(); } }} className={field} />
  );
}

function Weeks({ habit }: { habit: HabitData }) {
  return (
    <div className="grid grid-cols-12 gap-[3px]" role="list" aria-label="Last 12 weeks">
      {habit.weeks.map((w) => (
        <div key={w.start} role="listitem" title={`Week of ${w.start}: ${w.count} of ${habit.per_week} (${w.pct}%)`}
          className={`mono grid h-7 place-items-center border tabular-nums ${w.current ? "border-dashed" : ""} ${w.pct >= habit.gate_pct ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]" : w.count === 0 ? "border-[var(--rule)] text-[var(--muted-foreground)]" : "border-[var(--warn)] bg-[var(--warn-light)] text-[var(--warn)]"}`}>
          {w.count}
        </div>
      ))}
    </div>
  );
}

interface CardProps { habit: HabitData; streams: StreamMeta[]; busy: boolean; runHabits: RunHabits; onClose: () => void }

/** Everything about one habit: its cue and minimum, how close the gate is, the tripwire, and moving it between stages. */
function HabitCard({ habit: h, streams, busy, runHabits, onClose }: CardProps) {
  const blocks = useBlocks();
  const [tripPct, setTripPct] = useState(String(h.trip_pct ?? Math.max(10, h.gate_pct - 20)));
  const [tripWeeks, setTripWeeks] = useState(String(h.trip_weeks ?? 2));
  const [asked, setAsked] = useState(false);
  const [override, setOverride] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const save = (fields: HabitFields) => runHabits(() => vaultApi.updateHabit(h.id, fields));
  const stage = async (next: HabitStage, extra: HabitFields = {}) => {
    const ok = await runHabits(() => vaultApi.updateHabit(h.id, { stage: next, ...extra }));
    if (!ok) setProblem("Not saved. The message is at the top of the page.");
    else setProblem(null);
  };
  const trip = { trip_pct: Number(tripPct), trip_weeks: Number(tripWeeks) };
  const tripOk = trip.trip_pct >= 1 && trip.trip_pct < h.gate_pct && trip.trip_weeks >= 1;
  const gateShare = Math.min(100, (100 * h.gate_run) / h.gate_weeks);

  return (
    <div className="grid gap-5 border-t border-[var(--border)] p-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="grid content-start gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1"><span className={label}>Habit</span><Text key={`n${h.id}${h.name}`} value={h.name} max={200} busy={busy} ariaLabel="Name" onSave={(v) => v && void save({ name: v })} /></div>
          <button type="button" onClick={onClose} className={`${ghost} mt-6`}>Close</button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><span className={label}>Day block</span>
            <Pick value={h.block} label="Day block" className="w-full" options={blocks.list.filter((b) => !b.archived || b.key === h.block).map((b) => ({ value: b.key, label: b.label }))} onChange={(v) => void save({ block: v })} /></div>
          <div><span className={label}>How often</span>
            <Pick value={String(h.per_week)} label="How often" className="w-full" options={WEEK_OPTIONS} onChange={(v) => void save({ per_week: Number(v) })} /></div>
          <div><span className={label}>Cue</span><Text key={`a${h.id}${h.anchor}`} value={h.anchor} max={60} busy={busy} ariaLabel="Cue" placeholder="After Fajr" onSave={(v) => void save({ anchor: v })} /></div>
          <div><span className={label}>Minimum version</span><Text key={`m${h.id}${h.minimum}`} value={h.minimum} max={120} busy={busy} ariaLabel="Minimum version" placeholder="5 minutes" onSave={(v) => void save({ minimum: v })} /></div>
          <div className="sm:col-span-2"><span className={label}>Serves the goal of</span>
            <Pick value={h.stream ?? ""} label="Serves" className="w-full" placeholder="No block"
              options={[{ value: "", label: "No block" }, ...streams.map((s) => ({ value: s.id, label: s.label }))]}
              onChange={(v) => void save(v ? { stream: v } : { clear_stream: true })} /></div>
        </div>
        <div><span className={label}>Last 12 weeks · days checked</span><Weeks habit={h} /></div>
      </div>

      <div className="grid content-start gap-4 md:border-l md:border-[var(--border)] md:pl-5">
        <div>
          <span className={label}>Exit gate</span>
          <p className="text-small"><b className="font-medium">{h.gate_weeks} weeks in a row at {h.gate_pct}% or better.</b></p>
          <div className="relative mt-2 h-1.5 bg-[var(--border)]"><div className="h-full bg-[var(--accent)]" style={{ width: `${gateShare}%` }} /></div>
          <p className="mono mt-1.5 tabular-nums text-[var(--muted-foreground)]">{h.gate_run} of {h.gate_weeks} weeks · streak {h.streak}d · since {h.started_on}</p>
        </div>

        <div>
          <span className={label}>Tripwire{h.stage === "rails" && h.tripwire ? ` · ${h.tripwire}` : ""}</span>
          <div className="flex flex-wrap items-center gap-2 text-small">
            Back to installing if under
            <input aria-label="Tripwire percent" inputMode="numeric" value={tripPct} onChange={(e) => setTripPct(e.target.value.replace(/\D/g, "").slice(0, 3))} className={`${box} w-16 text-center`} />%
            for
            <input aria-label="Tripwire weeks" inputMode="numeric" value={tripWeeks} onChange={(e) => setTripWeeks(e.target.value.replace(/\D/g, "").slice(0, 2))} className={`${box} w-14 text-center`} />
            weeks in a row.
          </div>
          {!tripOk && <p className="mt-1.5 text-xs text-[var(--warn)]">Keep the tripwire under the gate ({h.gate_pct}%), so one ordinary dip does not send the habit back.</p>}
          {h.stage === "rails" && (
            <button type="button" disabled={busy || !tripOk} onClick={() => void save(trip)} className={`${ghost} mt-2`}>Save tripwire</button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {h.stage === "installing" && (
            <button type="button" disabled={busy || !tripOk || (!h.gate_met && !override)} onClick={() => void stage("rails", { ...trip, force: override })} className={solid}>Move to rails</button>
          )}
          {h.stage === "rails" && <button type="button" disabled={busy} onClick={() => void stage("installing")} className={solid}>Back to installing</button>}
          {h.stage !== "retired" && <button type="button" disabled={busy} onClick={() => void stage("retired")} className={ghost}>Retire</button>}
          {h.stage === "retired" && <button type="button" disabled={busy} onClick={() => void stage("installing")} className={solid}>Restart</button>}
          <button type="button" disabled={busy} className={danger} onClick={() => (asked ? void runHabits(() => vaultApi.removeHabit(h.id)) : setAsked(true))} onBlur={() => setAsked(false)}>
            {asked ? "Confirm delete" : "Delete"}
          </button>
        </div>
        {h.stage === "installing" && !h.gate_met && (
          <label className="flex items-start gap-2 text-xs text-[var(--muted-foreground)]">
            <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="mt-0.5" />
            The gate is not met. Move it to rails anyway. (Demoting too early is the usual way a habit decays.)
          </label>
        )}
        {problem && <p className="text-xs text-[var(--destructive)]">{problem}</p>}
      </div>
    </div>
  );
}

function Card({ h, picked, onPick }: { h: HabitData; picked: boolean; onPick: () => void }) {
  const blocks = useBlocks();
  const meter = Math.min(100, (100 * h.gate_run) / h.gate_weeks);
  return (
    <button type="button" onClick={onPick} aria-pressed={picked}
      className={`grid w-full gap-1.5 border-b border-[var(--border)] px-4 py-3 text-left hover:bg-[var(--muted)] ${picked ? "bg-[var(--muted)] shadow-[inset_2px_0_0_var(--accent)]" : "bg-[var(--surface)]"}`}>
      <span className="flex items-center gap-2 text-small font-medium">
        <span className="h-2 w-2 shrink-0" style={{ background: blocks.color(h.block) }} aria-hidden="true" />
        <span className="min-w-0 break-words">{h.name}</span>
      </span>
      <span className="mono text-[var(--muted-foreground)]">{[blocks.label(h.block), h.anchor, h.per_week < 7 ? `${h.per_week}/wk` : ""].filter(Boolean).join(" · ")}</span>
      {h.stage === "installing" && (
        <>
          <span className="block h-1.5 bg-[var(--border)]"><span className="block h-full bg-[var(--accent)]" style={{ width: `${meter}%` }} /></span>
          <span className="mono text-[var(--accent)]">{gateLabel(h)}</span>
        </>
      )}
      {h.stage === "rails" && h.tripwire && <span className={`mono ${h.tripwire === "fired" ? "text-[var(--destructive)]" : h.tripwire === "close" ? "text-[var(--warn)]" : "text-[var(--muted-foreground)]"}`}>Tripwire {h.tripwire}</span>}
    </button>
  );
}

interface Props { data: HabitsData; streams: StreamMeta[]; busy: boolean; runHabits: RunHabits; picked: number | null; onPick: (id: number | null) => void }

/** The habit factory: what is being installed, what runs on rails, and what needs a decision. */
export function HabitBoard({ data, streams, busy, runHabits, picked, onPick }: Props) {
  const [showRetired, setShowRetired] = useState(false);
  const live = data.habits.filter((h) => h.stage !== "retired");
  const installing = live.filter((h) => h.stage === "installing");
  const watch = live.filter(watching);
  const rails = live.filter((h) => h.stage === "rails" && !watching(h));
  const retired = data.habits.filter((h) => h.stage === "retired");
  const open = data.habits.find((h) => h.id === picked) ?? null;
  const over = installing.length - data.installing_limit;

  const columns: { id: string; title: string; hint: string; list: HabitData[]; note?: { text: string; tone: string } }[] = [
    { id: "installing", title: STAGE_LABEL.installing, hint: "Maximum attention until it stops needing it", list: installing,
      note: over > 0 ? { text: `Limit ${data.installing_limit}. Over by ${over}.`, tone: "text-[var(--warn)]" } : undefined },
    { id: "rails", title: STAGE_LABEL.rails, hint: "A cheaper block, tripwire armed", list: rails, note: { text: watch.length ? "" : "All tripwires quiet", tone: "text-[var(--muted-foreground)]" } },
    { id: "watching", title: "Watching", hint: "Tripwire close or fired", list: watch, note: watch.length ? { text: "Decide this week", tone: "text-[var(--destructive)]" } : undefined },
  ];

  return (
    <div>
      <div className="grid md:grid-cols-3">
        {columns.map((c) => (
          <div key={c.id} className="min-w-0 border-b border-[var(--border)] md:border-r md:last:border-r-0">
            <div className="flex items-start justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
              <p className="mono text-[var(--foreground)]">{c.title}<span className="mt-0.5 block text-xs font-normal normal-case tracking-normal text-[var(--muted-foreground)]">{c.hint}</span></p>
              <span className="mono tabular-nums text-[var(--muted-foreground)]">{c.list.length}</span>
            </div>
            {c.note?.text && <p className={`mono border-b border-[var(--border)] px-4 py-1.5 ${c.note.tone}`}>{c.note.text}</p>}
            {c.list.length === 0 && <p className="px-4 py-3 text-small text-[var(--muted-foreground)]">None.</p>}
            {c.list.map((h) => <Card key={h.id} h={h} picked={picked === h.id} onPick={() => onPick(picked === h.id ? null : h.id)} />)}
          </div>
        ))}
      </div>
      {data.habits.length === 0 && (
        <p className="px-4 py-3 text-small text-[var(--muted-foreground)]">No habits yet. Pick Habit in the capture line above and write one: <span className="mono normal-case tracking-normal">Walk 20 min @after Asr, min: 5 min, 5/wk</span></p>
      )}
      {retired.length > 0 && (
        <div className="border-b border-[var(--border)]">
          <button type="button" onClick={() => setShowRetired((v) => !v)} aria-expanded={showRetired} className="mono flex min-h-9 w-full items-center gap-2 px-4 text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
            Retired <span className="tabular-nums">{retired.length}</span> <span aria-hidden="true">{showRetired ? "−" : "+"}</span>
          </button>
          {showRetired && retired.map((h) => <Card key={h.id} h={h} picked={picked === h.id} onPick={() => onPick(picked === h.id ? null : h.id)} />)}
        </div>
      )}
      {open && <HabitCard key={open.id} habit={open} streams={streams} busy={busy} runHabits={runHabits} onClose={() => onPick(null)} />}
    </div>
  );
}
