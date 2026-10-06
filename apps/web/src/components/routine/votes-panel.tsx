"use client";

import { useState } from "react";
import { vaultApi } from "@/lib/vault-api";
import { VaultDayData } from "@/lib/vault-types";
import { BLOCK_COLORS, BLOCK_LABELS, blocksForDay } from "@/lib/vault-constants";
import { Section } from "@/components/routine/section";

interface Props {
  day: string;
  today: VaultDayData | null;
  onSaved: (day: VaultDayData | null) => void;
}

/** 1-3 stars per block for today; tapping the current level clears it. */
export function VotesPanel({ day, today, onSaved }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function vote(block: string, stars: number) {
    setBusy(true);
    setError(null);
    try {
      onSaved((await vaultApi.setVote(day, block, stars)).day);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Votes" aside="0–3 per block" error={error}>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2">
        {blocksForDay(today?.blocks).map((block) => {
          const current = today?.blocks[block] ?? 0;
          return (
            <div key={block} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2.5">
              <p className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold">
                <span className="h-2 w-2 rounded-full" style={{ background: BLOCK_COLORS[block] }} />{BLOCK_LABELS[block]}
              </p>
              <div className="flex gap-1" role="group" aria-label={`${BLOCK_LABELS[block]} vote`}>
                {[1, 2, 3].map((n) => (
                  <button key={n} disabled={busy} aria-pressed={current === n} aria-label={`${BLOCK_LABELS[block]} ${n} stars`}
                    onClick={() => void vote(block, current === n ? 0 : n)}
                    className="min-h-11 flex-1 rounded-lg bg-[var(--muted)] text-xs font-bold text-[var(--muted-foreground)] transition disabled:opacity-60 aria-pressed:text-white"
                    style={current === n ? { background: BLOCK_COLORS[block] } : undefined}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
