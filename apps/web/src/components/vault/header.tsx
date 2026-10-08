"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { vaultApi } from "@/lib/vault-api";
import { VaultDayData, VaultSyncStatusData } from "@/lib/vault-types";
import { resolveModeColor } from "@/lib/vault-constants";

interface VaultHeaderProps {
  today: VaultDayData | null;
  status: VaultSyncStatusData | null;
  onSynced: () => void;
}

/** "3 min ago", "2 h ago", "4 d ago" for an ISO time. */
function ago(iso: string | null): string {
  if (!iso) return "never";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} d ago`;
}

export function VaultHeader({ today, status, onSynced }: VaultHeaderProps) {
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  async function handleSync() {
    setSyncing(true);
    setSyncError(null);
    try {
      const result = await vaultApi.sync();
      if (result.errors.length > 0) {
        // The sync itself succeeded (HTTP 200), but per-file parse failures
        // are exactly the kind of error that must never pass silently.
        setSyncError(
          `${result.errors.length} file${result.errors.length === 1 ? "" : "s"} failed to sync — ${result.errors[0]}`
        );
      }
      onSynced();
    } catch (err) {
      // Network error, 401, 500, etc. — the sync() promise itself rejected.
      setSyncError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  const modeColor = today ? resolveModeColor(today.mode) : "#71717a";
  const empty = status !== null && status.head === null;

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
                <span className="rounded-full border px-2 py-px text-[0.625rem] uppercase tracking-[0.18em]" style={{ borderColor: `${modeColor}55`, color: modeColor }}>
                  {today.mode}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted-foreground)]">
          {today && <span className="font-mono tabular-nums">{today.total}/{today.possible} · {today.pct}%</span>}
          {status && !empty && (
            <span className="font-mono tabular-nums" title={`Vault remote last contacted ${status.pulled_at ?? "never"}`}>
              synced {ago(status.pulled_at ?? status.head_at)} · {status.head} · {status.days} days
            </span>
          )}
          <button onClick={handleSync} disabled={syncing}
            className="flex min-h-8 items-center gap-1.5 rounded-[0.3125rem] border border-[var(--border)] px-2.5 text-[0.6875rem] font-semibold text-[var(--foreground)] hover:bg-[var(--muted)] disabled:opacity-50">
            <RefreshCw size={12} className={syncing ? "animate-spin" : ""} />
            {syncing ? "Syncing" : "Sync now"}
          </button>
        </div>
      </div>
      {empty && (
        <p role="status" className="rounded-lg bg-[var(--warn-light)] px-3 py-1.5 text-xs text-[var(--warn)]">
          The vault has not been pulled yet, so there is nothing to show. Press Sync now.
        </p>
      )}
      {syncError && <p role="alert" className="rounded-lg bg-[var(--warn-light)] px-3 py-1.5 text-xs text-[var(--destructive)]">{syncError}</p>}
    </header>
  );
}
