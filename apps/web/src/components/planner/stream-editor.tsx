"use client";

import { useState } from "react";
import { Archive, Check, X } from "lucide-react";
import { ICONS, MONTH_LABEL, colorVar } from "@/lib/streams";
import { QuarterData, QuarterStreamData, StreamChange } from "@/lib/vault-types";

interface Props {
  quarter: QuarterData;
  /** The stream being edited; omit to add a new block. */
  stream?: QuarterStreamData;
  busy: boolean;
  onSave: (change: StreamChange & { name: string }, id: string) => Promise<void>;
  onCancel: () => void;
}

const STATUSES = ["active", "committed", "paused"] as const;

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/^[^a-z]+/, "").slice(0, 24);

const field = "min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 text-sm placeholder:text-[var(--muted-foreground)]";
const label = "mb-1.5 block text-[0.6875rem] font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)]";

/** Add a block (Finance, Errands…) or edit one: name, goal, month checkpoints, colour, icon. Saved into the quarter note. */
export function StreamEditor({ quarter, stream, busy, onSave, onCancel }: Props) {
  const [name, setName] = useState(stream?.name ?? "");
  const [slot, setSlot] = useState(stream?.slot ?? "");
  const [goal, setGoal] = useState(stream?.goal ?? "");
  const [status, setStatus] = useState<string>(stream?.status === "archived" ? "committed" : stream?.status || "committed");
  const [weekly, setWeekly] = useState(stream?.weekly ?? true);
  const [color, setColor] = useState(stream?.color ?? "teal");
  const [icon, setIcon] = useState(stream?.icon ?? "circle-dot");
  const [cps, setCps] = useState<Record<string, string>>(() => Object.fromEntries(quarter.months.map((m) => [m, stream?.checkpoints.find((c) => c.month === m)?.text ?? ""])));
  const taken = new Set(quarter.streams.map((s) => s.stream));

  function newId(): string {
    const base = slug(name) || "block";
    let id = base.length < 2 ? `${base}-block` : base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`.slice(0, 24);
    return id;
  }

  function save(e: React.FormEvent, nextStatus = status) {
    e.preventDefault();
    if (!name.trim()) return;
    void onSave({ name: name.trim(), slot: slot.trim(), goal: goal.trim(), status: nextStatus as StreamChange["status"], weekly, color, icon, checkpoints: cps }, stream?.stream ?? newId());
  }

  return (
    <form onSubmit={save} className="grid gap-5 rounded-2xl border-2 bg-[var(--background)] p-5 sm:p-6" style={{ borderColor: colorVar(color) }} aria-label={stream ? `Edit ${stream.name}` : "Add a block"}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          <span className={label}>Name</span>
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="Errands" maxLength={60} required autoFocus />
        </label>
        <label>
          <span className={label}>Where the time goes</span>
          <input className={field} value={slot} onChange={(e) => setSlot(e.target.value)} placeholder="Weekends, after Asr" maxLength={80} />
        </label>
      </div>

      <label>
        <span className={label}>Quarter goal</span>
        <textarea className={`${field} py-2.5`} rows={2} value={goal} onChange={(e) => setGoal(e.target.value)} maxLength={400} placeholder="The end state at the end of the quarter" />
      </label>

      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className={label}>Month checkpoints</legend>
        {quarter.months.map((m) => (
          <label key={m}>
            <span className="mb-1 block text-xs font-bold" style={{ color: colorVar(color) }}>{MONTH_LABEL[m]}</span>
            <input className={field} value={cps[m]} onChange={(e) => setCps({ ...cps, [m]: e.target.value })} maxLength={400} placeholder="Where it should be" />
          </label>
        ))}
      </fieldset>

      <div className="grid gap-5 lg:grid-cols-2">
        <fieldset>
          <legend className={label}>Colour</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Colour">
            {quarter.colors.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={c === color} aria-label={c} onClick={() => setColor(c)}
                className="grid h-9 w-9 place-items-center rounded-full border-2 transition active:scale-90"
                style={{ background: colorVar(c), borderColor: c === color ? "var(--foreground)" : "transparent" }}>
                {c === color && <Check size={15} className="text-white" aria-hidden="true" />}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className={label}>Icon</legend>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Icon">
            {quarter.icons.map((key) => {
              const Icon = ICONS[key];
              if (!Icon) return null;
              const on = key === icon;
              return (
                <button key={key} type="button" role="radio" aria-checked={on} aria-label={key} onClick={() => setIcon(key)}
                  className="grid h-9 w-9 place-items-center rounded-lg border transition active:scale-90"
                  style={on ? { color: colorVar(color), borderColor: colorVar(color), background: `color-mix(in srgb, ${colorVar(color)} 13%, var(--background))` } : { borderColor: "var(--border)", color: "var(--muted-foreground)" }}>
                  <Icon size={17} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </fieldset>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-[0.6875rem] font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">Status</span>
          <select className="min-h-10 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={weekly} onChange={(e) => setWeekly(e.target.checked)} />
          Has a weekly objective
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={busy || !name.trim()} className="min-h-11 rounded-xl bg-[var(--accent)] px-5 text-sm font-bold text-[var(--accent-fg)] disabled:opacity-50">{stream ? "Save" : "Add block"}</button>
        <button type="button" onClick={onCancel} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[var(--border)] px-4 text-sm font-semibold"><X size={15} aria-hidden="true" /> Cancel</button>
        {stream && (
          <button type="button" disabled={busy} onClick={(e) => save(e as unknown as React.FormEvent, "archived")}
            className="ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-[var(--muted-foreground)] hover:text-[var(--destructive)]"
            title="Hide this block from the planner. Its notes stay in the vault.">
            <Archive size={15} aria-hidden="true" /> Archive
          </button>
        )}
      </div>
    </form>
  );
}
