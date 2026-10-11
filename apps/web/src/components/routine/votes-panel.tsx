"use client";

import { useState } from "react";
import { vaultApi } from "@/lib/vault-api";
import { VaultDayData } from "@/lib/vault-types";
import { useBlocks } from "@/lib/blocks";

interface Props {
  day: string;
  today: VaultDayData | null;
  onSaved: (day: VaultDayData | null) => void;
  /** The block you are in; its votes are bright, the rest are dimmed. */
  current?: string;
}

/** 1-3 stars per block for today, as one thin strip; tapping the current level clears it. */
export function VotesPanel({ day, today, onSaved, current }: Props) {
  const blocks = useBlocks();
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

  const list = blocks.forDay(today?.blocks).filter((b) => b.counts_for_stars);
  return (
    <section aria-label="Votes" className="grid gap-1.5">
      <h2 className="text-micro font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">Votes</h2>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        {list.map((b) => {
          const block = b.key;
          const stars = today?.blocks[block] ?? 0;
          const color = blocks.color(block);
          return (
            <div key={block} role="group" aria-label={`${b.label} vote`}
              className={`flex min-h-10 min-w-0 items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] pl-3 pr-1 transition-opacity ${current && current !== block ? "opacity-60" : ""}`}>
              <span className="flex min-w-0 items-center gap-2 text-small font-semibold">
                <i className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />
                <span className="truncate">{b.label}</span>
              </span>
              <span className="flex shrink-0">
                {[1, 2, 3].map((n) => (
                  <button key={n} type="button" disabled={busy} aria-pressed={stars === n} aria-label={`${b.label} ${n} ${n === 1 ? "star" : "stars"}`}
                    onClick={() => void vote(block, stars === n ? 0 : n)}
                    className="group grid h-10 w-8 place-items-center disabled:opacity-60">
                    <span className="grid h-6 w-6 place-items-center rounded-md bg-[var(--muted)] font-mono text-micro font-semibold text-[var(--muted-foreground)] transition-colors group-hover:bg-[var(--border)] group-aria-pressed:text-white"
                      style={stars === n ? { background: color } : undefined}>{n}</span>
                  </button>
                ))}
              </span>
            </div>
          );
        })}
      </div>
      {error && <p className="text-xs text-[var(--destructive)]">{error}</p>}
    </section>
  );
}
