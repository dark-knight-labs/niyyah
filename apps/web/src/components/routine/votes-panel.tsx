"use client";

import { useState } from "react";
import { vaultApi } from "@/lib/vault-api";
import { VaultDayData } from "@/lib/vault-types";
import { BLOCK_COLORS, BLOCK_LABELS, blocksForDay } from "@/lib/vault-constants";

interface Props {
  day: string;
  today: VaultDayData | null;
  onSaved: (day: VaultDayData | null) => void;
  /** The block you are in; its votes are bright, the rest are dimmed. */
  current?: string;
}

/** 1-3 stars per block for today, as one thin strip; tapping the current level clears it. */
export function VotesPanel({ day, today, onSaved, current }: Props) {
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
    <section aria-label="Votes" className="flex flex-wrap items-center gap-x-5 gap-y-1 border-y border-[var(--border)] py-1.5">
      <h2 className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">Votes</h2>
      {blocksForDay(today?.blocks).map((block) => {
        const stars = today?.blocks[block] ?? 0;
        return (
          <div key={block} className={`flex items-center gap-1.5 text-xs font-semibold ${current && current !== block ? "opacity-60" : ""}`}>
            <span className="h-2 w-2 rounded-full" style={{ background: BLOCK_COLORS[block] }} />{BLOCK_LABELS[block]}
            <div className="flex gap-0.5" role="group" aria-label={`${BLOCK_LABELS[block]} vote`}>
              {[1, 2, 3].map((n) => (
                <button key={n} disabled={busy} aria-pressed={stars === n} aria-label={`${BLOCK_LABELS[block]} ${n} stars`}
                  onClick={() => void vote(block, stars === n ? 0 : n)}
                  className="grid h-7 w-7 place-items-center rounded-md bg-[var(--muted)] text-[10px] font-bold text-[var(--muted-foreground)] transition disabled:opacity-60 aria-pressed:text-white"
                  style={stars === n ? { background: BLOCK_COLORS[block] } : undefined}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {error && <p className="w-full text-xs text-[var(--destructive)]">{error}</p>}
    </section>
  );
}
