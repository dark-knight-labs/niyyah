"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/lib/api-client";
import { vaultApi } from "@/lib/vault-api";
import {
  VaultBlocksSeriesData,
  VaultDayData,
  VaultMonthData,
  VaultStreaksData,
  VaultWeekData,
} from "@/lib/vault-types";
import { VaultHeader } from "@/components/vault/header";
import { BlockCards } from "@/components/vault/block-cards";
import { WeeklyPulse } from "@/components/vault/weekly-pulse";
import { MonthlyHeatmap } from "@/components/vault/monthly-heatmap";
import { BlockTrends } from "@/components/vault/block-trends";
import { FooterStats } from "@/components/vault/footer-stats";

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function VaultPage() {
  const [today, setToday] = useState<VaultDayData | null>(null);
  const [week, setWeek] = useState<VaultWeekData | null>(null);
  const [month, setMonth] = useState<VaultMonthData | null>(null);
  const [blocks, setBlocks] = useState<VaultBlocksSeriesData | null>(null);
  const [streaks, setStreaks] = useState<VaultStreaksData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setFetchError(null);

    // `/today` legitimately 404s when nothing has synced yet — that's a real
    // empty state, not a failure. Every other genuine error (network down,
    // 401, 500) must be visible somewhere rather than rendering identically
    // to "no data yet".
    const fetchOrNull = <T,>(label: string, promise: Promise<T>, allow404 = false): Promise<T | null> =>
      promise.catch((err: unknown) => {
        if (allow404 && err instanceof Error && (err as ApiError).status === 404) {
          return null;
        }
        console.error(`Vault ${label} fetch failed:`, err);
        setFetchError((prev) => prev ?? "Could not load some vault data — the API may be unreachable.");
        return null;
      });

    Promise.all([
      fetchOrNull("today", vaultApi.today(), true),
      fetchOrNull("week", vaultApi.week()),
      fetchOrNull("month", vaultApi.month(currentMonth())),
      fetchOrNull("blocks", vaultApi.blocks(30)),
      fetchOrNull("streaks", vaultApi.streaks()),
    ])
      .then(([t, w, m, b, s]) => {
        setToday(t);
        setWeek(w);
        setMonth(m);
        setBlocks(b);
        setStreaks(s);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      {fetchError && (
        <div className="border border-[var(--destructive)] bg-[var(--surface)] rounded px-4 py-2 mb-4 text-xs text-[var(--destructive)]">
          {fetchError}
        </div>
      )}
      <VaultHeader today={today} onSynced={load} />
      <BlockCards today={today} />
      <WeeklyPulse week={week} />
      <MonthlyHeatmap month={month} />
      <BlockTrends series={blocks} />
      <FooterStats month={month} streaks={streaks} />
    </div>
  );
}
