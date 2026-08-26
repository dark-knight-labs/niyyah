"use client";

import { useCallback, useEffect, useState } from "react";
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

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      vaultApi.today().catch(() => null),
      vaultApi.week().catch(() => null),
      vaultApi.month(currentMonth()).catch(() => null),
      vaultApi.blocks(30).catch(() => null),
      vaultApi.streaks().catch(() => null),
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
      <VaultHeader today={today} onSynced={load} />
      <BlockCards today={today} />
      <WeeklyPulse week={week} />
      <MonthlyHeatmap month={month} />
      <BlockTrends series={blocks} />
      <FooterStats month={month} streaks={streaks} />
    </div>
  );
}
