"use client";

import { useCallback, useEffect, useState } from "react";
import { vaultApi } from "@/lib/vault-api";
import { VaultDayData } from "@/lib/vault-types";
import { VaultHeader } from "@/components/vault/header";
import { BlockCards } from "@/components/vault/block-cards";

export default function VaultPage() {
  const [today, setToday] = useState<VaultDayData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    vaultApi
      .today()
      .then(setToday)
      .catch(() => setToday(null))
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
    </div>
  );
}
