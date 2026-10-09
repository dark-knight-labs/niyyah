"use client";

import { ChevronDown } from "lucide-react";
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
    <header className="mb-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2.5 sm:grid-cols-[minmax(0,1fr)_auto_minmax(9.5rem,12.5rem)]">
      <div className="min-w-0">
        <h1 className="font-serif text-[1.5rem] font-medium leading-tight">{dateLabel}</h1>
        {city && <p className="text-[0.8125rem] text-[var(--muted-foreground)]">{city}</p>}
      </div>
      {today && (
        <>
          <label className="relative inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] pl-2.5 pr-2 text-[0.8125rem] font-semibold focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--accent)]">
            <span className="h-[7px] w-[7px] shrink-0 rounded-full transition-colors" style={{ background: resolveModeColor(mode ?? "") }} />
            {editDay ? (
              <>
                <select value={mode ?? "full"} onChange={(e) => void setMode(e.target.value)} aria-label="Day mode"
                  className="cursor-pointer appearance-none bg-transparent pr-4 text-[0.8125rem] font-semibold capitalize outline-none">
                  {MODES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
                <ChevronDown size={10} aria-hidden="true" className="pointer-events-none absolute right-2 text-[var(--muted-foreground)]" />
              </>
            ) : <span className="capitalize">{mode}</span>}
          </label>
          <div className="col-span-full flex items-center gap-3 sm:col-span-1 sm:grid sm:gap-1.5">
            <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-[var(--muted)] sm:flex-none" role="progressbar" aria-label="Stars today" aria-valuemin={0} aria-valuemax={today.possible} aria-valuenow={today.total}>
              <div className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-[350ms] ease-out" style={{ width: `${today.pct}%` }} />
            </div>
            <p className="order-2 whitespace-nowrap text-[0.78125rem] text-[var(--muted-foreground)] sm:order-none sm:text-right">
              <b className="font-mono font-bold tabular-nums text-[var(--foreground)]">{today.total}</b> / <span className="font-mono tabular-nums">{today.possible}</span> stars
            </p>
          </div>
        </>
      )}
      {error && <p className="col-span-full text-xs text-[var(--destructive)]">{error}</p>}
    </header>
  );
}
