"use client";

import { useState } from "react";
import { vaultApi } from "@/lib/vault-api";
import { VaultDayData } from "@/lib/vault-types";
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
  /** Goal cards, shown between the date and the mode. */
  children?: React.ReactNode;
}

/** Date, the day's mode (a picker for the owner) and today's star total. */
export function DayHeader({ dateLabel, city, editDay, today, onSaved, children }: Props) {
  const [error, setError] = useState<string | null>(null);
  const mode = today?.mode ?? null;

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
    <header className="mb-4 grid items-center gap-x-6 gap-y-3 lg:grid-cols-[auto_minmax(0,1fr)_auto]">
      <div>
        <h1 className="font-serif text-[1.5rem] font-medium leading-tight">{dateLabel}</h1>
        {city && <p className="text-[0.8125rem] text-[var(--muted-foreground)]">{city}</p>}
      </div>
      {children ?? <div />}
      {today && (
        <div className="flex items-center gap-3">
          <label className="flex min-h-8 items-center gap-1.5 rounded-[0.3125rem] border border-[var(--border)] bg-[var(--surface)] pl-2.5 pr-1 text-xs font-semibold">
            <span className="h-2 w-2 rounded-full" style={{ background: resolveModeColor(mode ?? "") }} />
            {editDay ? (
              <select value={mode ?? "full"} onChange={(e) => void setMode(e.target.value)} aria-label="Day mode" className="bg-transparent py-1 text-xs font-semibold capitalize outline-none">
                {MODES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            ) : <span className="py-1 capitalize">{mode}</span>}
          </label>
          <div className="min-w-24">
            <p className="text-[0.8125rem] font-extrabold">{today.total}<span className="font-medium text-[var(--muted-foreground)]"> / {today.possible} stars</span></p>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--muted)]">
              <div className="h-full rounded-full bg-[var(--accent)] transition-[width]" style={{ width: `${today.pct}%` }} />
            </div>
          </div>
        </div>
      )}
      {error && <p className="w-full text-xs text-[var(--destructive)]">{error}</p>}
    </header>
  );
}
