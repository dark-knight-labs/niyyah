"use client";

import Link from "next/link";
import { Check, ChevronDown, Pencil, X } from "lucide-react";
import { useState } from "react";
import { Checklist } from "@/components/planner/checklist";
import { vaultApi } from "@/lib/vault-api";
import { QuarterData, VaultDayData, VaultGoal } from "@/lib/vault-types";
import { resolveModeColor } from "@/lib/vault-constants";

const MODES = [
  ["full", "Full"], ["yellow", "Yellow"], ["compressed", "Compressed"], ["minimal", "Minimal"],
  ["off", "Off"], ["ramadan", "Ramadan"], ["fasting", "Fasting"],
] as const;

interface Props {
  dateLabel: string;
  city: string | null;
  /** "YYYY-MM-DD"; only passed for the owner, who can change the mode. */
  editDay: string | null;
  today: VaultDayData | null;
  onSaved: (day: VaultDayData | null) => void;
  /** Owner only: the goals from Settings and the quarter's Super Objective from Plan. */
  goals: VaultGoal[] | null;
  quarter: QuarterData | null;
  onTick: (id: string, done: boolean) => Promise<unknown>;
  onQuarter: (q: QuarterData) => void;
}

const CELL = "min-w-0 lg:border-l lg:border-[var(--border)] lg:px-4 lg:first:border-l-0 lg:first:pl-0";
const LABEL = "truncate text-micro font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]";

function Meter({ pct, label }: { pct: number | null; label: string }) {
  if (pct === null) return <div className="mt-1.5 h-[3px]" aria-hidden="true" />;
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-[var(--muted)]" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-[350ms] ease-out" style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-xs font-medium tabular-nums text-[var(--muted-foreground)]">{pct}%</span>
    </div>
  );
}

/** The quarter's Super Objective: the same text as on Plan, editable here, with progress from the streams' goal lines. */
function SuperObjective({ quarter, onQuarter }: { quarter: QuarterData; onQuarter: (q: QuarterData) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lines = quarter.streams.flatMap((s) => s.goal_checklist);
  const pct = lines.length ? Math.round((100 * lines.filter((l) => l.done).length) / lines.length) : null;

  async function save() {
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      onQuarter(await vaultApi.setSuperObjective(text, quarter.objective_ar));
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={CELL}>
      <p className={LABEL}>Super objective</p>
      {editing ? (
        <form className="mt-0.5 flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <input autoFocus value={draft} maxLength={300} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setEditing(false)} aria-label="Super Objective"
            className="h-7 min-w-0 flex-1 rounded-md border border-[var(--accent)] bg-[var(--background)] px-2 text-sm" />
          <button type="submit" disabled={busy || !draft.trim()} aria-label="Save" className="grid h-7 w-7 place-items-center rounded-md bg-[var(--accent)] text-[var(--accent-fg)] disabled:opacity-50"><Check size={14} /></button>
          <button type="button" onClick={() => setEditing(false)} aria-label="Cancel" className="grid h-7 w-7 place-items-center rounded-md border border-[var(--border)]"><X size={14} /></button>
        </form>
      ) : (
        <div className="group flex items-center gap-1">
          <Link href="/plan" title="Open the plan" className="line-clamp-2 min-w-0 font-serif text-lg font-medium leading-6 hover:underline">{quarter.objective || "Set it"}</Link>
          <button type="button" onClick={() => { setDraft(quarter.objective); setEditing(true); }} aria-label="Edit the Super Objective"
            className="grid h-6 w-6 shrink-0 place-items-center rounded text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100"><Pencil size={12} /></button>
        </div>
      )}
      {error && <p className="text-xs text-[var(--destructive)]">{error}</p>}
      <Meter pct={pct} label="Super Objective progress" />
    </div>
  );
}

/** Slim top bar: the goals that matter (Super Objective first), then the date, the day's mode and the star total. */
export function TopBar({ dateLabel, city, editDay, today, onSaved, goals, quarter, onTick, onQuarter }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const mode = today?.mode ?? null;
  const opened = goals?.find((g) => g.title === open) ?? null;

  async function setMode(next: string) {
    if (!editDay) return;
    setError(null);
    try {
      onSaved((await vaultApi.setMode(editDay, next)).day);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    }
  }

  return (
    <header className="mb-4 border-b border-[var(--border)] pb-3">
      <div className="grid gap-x-8 gap-y-3 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 lg:flex lg:gap-0 [&>*]:lg:flex-1" role="group" aria-label="Goals">
          {quarter && <SuperObjective quarter={quarter} onQuarter={onQuarter} />}
          {goals?.map((g) => (
            <div key={g.title} className={CELL}>
              <p className={LABEL}>{g.title}</p>
              <button type="button" disabled={g.checklist.length === 0} aria-expanded={g.checklist.length ? open === g.title : undefined} onClick={() => setOpen(open === g.title ? null : g.title)}
                className="block w-full min-w-0 truncate text-left disabled:cursor-default">
                <span className="font-serif text-lg font-medium leading-6">{g.value}</span>
                {g.caption && <span className="text-xs text-[var(--muted-foreground)]"> {g.caption}</span>}
                {g.checklist.length > 0 && <ChevronDown size={12} aria-hidden="true" className={`ml-1 inline text-[var(--muted-foreground)] transition-transform ${open === g.title ? "rotate-180" : ""}`} />}
              </button>
              <Meter pct={g.progress} label={`${g.title} progress`} />
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between gap-x-4 gap-y-1.5 lg:grid lg:justify-items-end">
          <p className="whitespace-nowrap text-xs text-[var(--muted-foreground)]" title={city ?? undefined}>
            <b className="font-semibold text-[var(--foreground)]">{dateLabel}</b>{city && <> · {city}</>}
          </p>
          {today && (
            <div className="flex items-center gap-3 lg:justify-self-end">
              <label className="relative inline-flex h-8 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] pl-2.5 pr-2 text-small font-semibold focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--accent)]">
                <span className="h-[7px] w-[7px] shrink-0 rounded-full transition-colors" style={{ background: resolveModeColor(mode ?? "") }} />
                {editDay ? (
                  <>
                    <select value={mode ?? "full"} onChange={(e) => void setMode(e.target.value)} aria-label="Day mode"
                      className="cursor-pointer appearance-none bg-transparent pr-4 text-small font-semibold capitalize outline-none">
                      {MODES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                    </select>
                    <ChevronDown size={10} aria-hidden="true" className="pointer-events-none absolute right-2 text-[var(--muted-foreground)]" />
                  </>
                ) : <span className="capitalize">{mode}</span>}
              </label>
              <p className="whitespace-nowrap text-xs text-[var(--muted-foreground)]" role="progressbar" aria-label="Stars today" aria-valuemin={0} aria-valuemax={today.possible} aria-valuenow={today.total}>
                <b className="font-mono font-semibold tabular-nums text-[var(--foreground)]">{today.total}</b> / <span className="font-mono tabular-nums">{today.possible}</span> stars
              </p>
            </div>
          )}
        </div>
      </div>
      {opened && (
        <div className="mt-3 border-t border-[var(--border)] pt-2.5">
          <Checklist label={`${opened.title} checklist`} items={opened.checklist} onToggle={(item, done) => onTick(item.id, done)} />
        </div>
      )}
      {error && <p className="mt-2 text-xs text-[var(--destructive)]">{error}</p>}
    </header>
  );
}
