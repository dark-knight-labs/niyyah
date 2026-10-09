"use client";

import { DaysStatusData, VaultDayData } from "@/lib/vault-types";
import { resolveModeColor } from "@/lib/vault-constants";

interface VaultHeaderProps {
  today: VaultDayData | null;
  status: DaysStatusData | null;
}

export function VaultHeader({ today, status }: VaultHeaderProps) {
  const modeColor = today ? resolveModeColor(today.mode) : "#71717a";

  return (
    <header className="grid gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex items-center gap-2.5">
          <span className="h-2 w-2 shrink-0 rounded-full pulse-dot" style={{ backgroundColor: modeColor }} title="Live" />
          <div>
            <p className="eyebrow">Vault</p>
            <div className="mt-0.5 flex items-baseline gap-2">
              <h1 className="heading-elegant text-xl leading-none">Today&rsquo;s Ledger</h1>
              {today && (
                <span className="rounded-full border px-2 py-px text-micro uppercase tracking-[0.18em]" style={{ borderColor: `${modeColor}55`, color: modeColor }}>
                  {today.mode}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted-foreground)]">
          {today && <span className="font-mono tabular-nums">{today.total}/{today.possible} · {today.pct}%</span>}
          {status && <span className="font-mono tabular-nums">{status.days} {status.days === 1 ? "day" : "days"} logged</span>}
        </div>
      </div>
    </header>
  );
}
