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
}

/** Date, the day's mode (a picker for the owner) and today's star total. */
export function DayHeader({ dateLabel, city, editDay, today, onSaved }: Props) {
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
    <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="font-serif text-[26px] font-medium leading-tight">{dateLabel}</h1>
        {city && <p className="text-[13px] text-[var(--muted-foreground)]">{city}</p>}
      </div>
      {today && (
        <div className="flex items-center gap-3">
          <label className="flex min-h-11 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] pl-3.5 pr-2 text-sm font-semibold">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: resolveModeColor(mode ?? "") }} />
            {editDay ? (
              <select value={mode ?? "full"} onChange={(e) => void setMode(e.target.value)} aria-label="Day mode" className="bg-transparent py-2 capitalize outline-none">
                {MODES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            ) : <span className="py-2 capitalize">{mode}</span>}
          </label>
          <div className="min-w-24">
            <p className="text-[13px] font-extrabold">{today.total}<span className="font-medium text-[var(--muted-foreground)]"> / {today.possible} stars</span></p>
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
