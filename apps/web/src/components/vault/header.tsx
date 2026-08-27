"use client";

import { useState, type CSSProperties } from "react";
import { RefreshCw } from "lucide-react";
import { vaultApi } from "@/lib/vault-api";
import { VaultDayData } from "@/lib/vault-types";
import { MODE_COLORS } from "@/lib/vault-constants";

interface VaultHeaderProps {
  today: VaultDayData | null;
  onSynced: () => void;
}

export function VaultHeader({ today, onSynced }: VaultHeaderProps) {
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

  const modeColor = today ? MODE_COLORS[today.mode] ?? "#71717a" : "#71717a";

  return (
    <div
      className="widget border border-[var(--border)] bg-[var(--surface)] rounded px-5 pt-5 pb-4 mb-4"
      style={{ "--widget-accent": modeColor } as CSSProperties}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className="w-2 h-2 rounded-full pulse-dot shrink-0"
            style={{ backgroundColor: modeColor }}
            title="Live"
          />
          <div>
            <p className="eyebrow">Vault</p>
            <div className="flex items-baseline gap-2 mt-0.5">
              <h1 className="heading-elegant text-2xl leading-none">Today&rsquo;s Ledger</h1>
              {today && (
                <span
                  className="text-[10px] uppercase tracking-[0.18em] px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: `${modeColor}18`, color: modeColor }}
                >
                  {today.mode}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {today && (
            <span className="font-mono text-sm tabular-nums text-[var(--muted-foreground)]">
              {today.total}/{today.possible} · {today.pct}%
            </span>
          )}
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-50"
          >
            <RefreshCw size={12} className={syncing ? "animate-spin" : ""} />
            Sync
          </button>
        </div>
      </div>
      {syncError && (
        <p className="text-xs text-[var(--destructive)] mt-2">{syncError}</p>
      )}
    </div>
  );
}
