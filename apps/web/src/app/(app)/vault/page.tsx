"use client";

import { useCallback, useEffect, useState } from "react";
import { vaultApi } from "@/lib/vault-api";
import { VaultDayData, VaultMonthData, VaultWeekData } from "@/lib/vault-types";
import { VaultHeader } from "@/components/vault/header";
import { BlockCards } from "@/components/vault/block-cards";
import { WeeklyPulse } from "@/components/vault/weekly-pulse";
import { MonthlyHeatmap } from "@/components/vault/monthly-heatmap";

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function VaultPage() {
  const [today, setToday] = useState<VaultDayData | null>(null);
  const [week, setWeek] = useState<VaultWeekData | null>(null);
  const [month, setMonth] = useState<VaultMonthData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      vaultApi.today().catch(() => null),
      vaultApi.week().catch(() => null),
      vaultApi.month(currentMonth()).catch(() => null),
    ])
      .then(([t, w, m]) => {
        setToday(t);
        setWeek(w);
        setMonth(m);
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
    </div>
  );
}
