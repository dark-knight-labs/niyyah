"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { vaultApi } from "@/lib/vault-api";
import { VaultDayData } from "@/lib/vault-types";
import { ROUTINE_BLOCKS, ResolvedBlock, formatMinutes } from "@/lib/routine";
import { BLOCK_COLORS, BLOCK_LABELS, BLOCK_ORDER } from "@/lib/vault-constants";

const MODES = [
  ["full", "Full"], ["yellow", "Yellow"], ["compressed", "Compressed"], ["minimal", "Minimal"],
  ["off", "Off"], ["ramadan", "Ramadan"], ["fasting", "Fasting"],
] as const;

interface Props {
  open: boolean;
  onClose: () => void;
  /** "YYYY-MM-DD" in the schedule's timezone. */
  day: string;
  today: VaultDayData | null;
  /** Today's routine blocks, used to pick which part of the day a note belongs to. */
  blocks: ResolvedBlock[];
  /** Called after every saved change so the page can refresh. */
  onSaved: (day: VaultDayData | null) => void;
}

const logLines = (log: string | null) => (log ?? "").split("\n").map((l) => l.trim()).filter((l) => l.startsWith("- ") && l.length > 2);

/** Change today's mode, votes and notes. Every change is written straight into the day's note in the vault. */
export function DayEditor({ open, onClose, day, today, blocks, onSaved }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState(0);
  const [text, setText] = useState("");

  async function run(action: () => Promise<{ day: VaultDayData | null }>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      onSaved((await action()).day);
      after?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  const mode = today?.mode ?? "full";
  const target = blocks[section];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <aside className="h-full w-full max-w-md overflow-y-auto bg-[var(--background)] p-5 shadow-xl" onClick={(e) => e.stopPropagation()} aria-label="Edit today">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold">Edit {day}</h2>
          <button onClick={onClose} aria-label="Close" className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X size={18} /></button>
        </div>
        {error && <p className="mb-3 rounded-lg border border-[var(--destructive)] px-3 py-2 text-xs text-[var(--destructive)]">{error}</p>}
        <p className="mb-5 text-xs text-[var(--muted-foreground)]">Saved straight into today&apos;s note in the vault{busy ? " — saving…" : "."}</p>

        <section className="mb-6">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--muted-foreground)]">Mode</h3>
          <div className="flex flex-wrap gap-2">
            {MODES.map(([key, label]) => (
              <button key={key} disabled={busy} onClick={() => run(() => vaultApi.setMode(day, key))}
                className={`rounded-full border px-3 py-1 text-sm transition ${mode === key ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--border)] hover:bg-[var(--muted)]"}`}>
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="mb-6">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--muted-foreground)]">Votes</h3>
          <div className="space-y-2">
            {BLOCK_ORDER.map((block) => {
              const current = today?.blocks[block] ?? 0;
              return (
                <div key={block} className="flex items-center gap-3">
                  <span className="w-28 text-sm font-medium" style={{ color: BLOCK_COLORS[block] }}>{BLOCK_LABELS[block]}</span>
                  <div className="flex gap-1">
                    {[0, 1, 2, 3].map((n) => (
                      <button key={n} disabled={busy} aria-label={`${BLOCK_LABELS[block]} ${n} stars`} onClick={() => run(() => vaultApi.setVote(day, block, n))}
                        className={`h-8 w-10 rounded border text-sm transition ${current === n ? "text-white" : "border-[var(--border)] hover:bg-[var(--muted)]"}`}
                        style={current === n ? { background: BLOCK_COLORS[block], borderColor: BLOCK_COLORS[block] } : undefined}>
                        {n === 0 ? "–" : "★".repeat(n)}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--muted-foreground)]">Note for a part of the day</h3>
          <select value={section} onChange={(e) => setSection(Number(e.target.value))} className="mb-2 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm">
            {blocks.map((b, i) => (
              <option key={`${b.block}-${b.startMin}`} value={i}>{ROUTINE_BLOCKS[b.block].label} · {formatMinutes(b.startMin)}–{formatMinutes(b.endMin)}</option>
            ))}
          </select>
          <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={500} rows={3} placeholder="What happened in this part of the day?"
            className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm" />
          <button disabled={busy || !text.trim() || !target} className="mt-2 rounded bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-50"
            onClick={() => run(() => vaultApi.addNote(day, ROUTINE_BLOCKS[target.block].label, `${formatMinutes(target.startMin)}-${formatMinutes(target.endMin)}`, text), () => setText(""))}>
            Add note
          </button>
          <ul className="mt-4 space-y-1.5 text-sm">
            {logLines(today?.log ?? null).map((line) => <li key={line} className="text-[var(--muted-foreground)]">{line.slice(2)}</li>)}
          </ul>
        </section>
      </aside>
    </div>
  );
}
