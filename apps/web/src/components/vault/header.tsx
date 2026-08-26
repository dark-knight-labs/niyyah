"use client";

import { useState } from "react";
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

  async function handleSync() {
    setSyncing(true);
    try {
      await vaultApi.sync();
      onSynced();
    } finally {
      setSyncing(false);
    }
  }

  const modeColor = today ? MODE_COLORS[today.mode] ?? "#71717a" : "#71717a";

  return (
    <div className="flex items-center justify-between border border-[var(--border)] bg-[var(--surface)] rounded px-4 py-3 mb-4">
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-bold uppercase tracking-wider">Vault</h1>
        {today && (
          <span
            className="text-xs uppercase tracking-wider px-2 py-0.5 rounded font-mono"
            style={{ backgroundColor: `${modeColor}22`, color: modeColor }}
          >
            {today.mode}
          </span>
        )}
      </div>
      <div className="flex items-center gap-4">
        {today && (
          <span className="font-mono text-sm">
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
  );
}
