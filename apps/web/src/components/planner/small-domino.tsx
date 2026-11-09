"use client";

import { Pick } from "@/components/planner/pick";
import { Checkbox } from "@/components/routine/checkbox";
import { EditableRow } from "@/components/routine/editable-row";
import { StreamMeta } from "@/lib/streams";
import { vaultApi } from "@/lib/vault-api";
import { PipelineItemData, VaultObjective } from "@/lib/vault-types";

interface Props {
  meta: StreamMeta;
  objective: VaultObjective | null;
  /** Open pipeline items the week's one thing can be picked from. */
  pool: PipelineItemData[];
  run: (action: () => Promise<unknown>) => Promise<unknown>;
  onPick: (item: PipelineItemData) => void;
  /** This stream's carried item (see carriedPick) and the current ISO week, for the "Keep for W46" strip. */
  carried?: PipelineItemData | null;
  week?: string;
}

/** "2026-W45" -> "W45". */
export const weekLabel = (iso: string) => iso.replace(/^\d{4}-/, "");

/** The week's one thing for a stream: tick it, rewrite it, or pick it from the pipeline. */
export function SmallDomino({ meta, objective, pool, run, onPick, carried = null, week = "" }: Props) {
  if (!meta.weekly) return <p className="text-sm text-[var(--muted-foreground)]">No weekly objective for this stream.</p>;
  const done = objective?.done ?? false;
  return (
    <div>
      <EditableRow text={objective?.text ?? ""} placeholder="Choose the one thing for this week" struck={done} maxLength={200}
        lead={<Checkbox checked={done} disabled={!objective?.text} label={`${meta.label} objective done`}
          onChange={() => void run(() => vaultApi.setObjective(meta.id, { done: !done }))} />}
        onSave={async (text) => { await run(() => vaultApi.setObjective(meta.id, { text })); }} />
      {!objective?.text && carried && carried.focus && (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          <span className="min-w-0 break-words text-[var(--warn)]">Carried from {weekLabel(carried.focus)}: {carried.text}</span>
          <button type="button" onClick={() => onPick(carried)}
            className="mono min-h-6 border border-[var(--warn)] px-2 text-[var(--warn)] hover:bg-[var(--warn-light)]">Keep for {weekLabel(week)}</button>
        </div>
      )}
      {!objective?.text && pool.length > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--muted-foreground)]">
          <span>Pick from pipeline</span>
          <Pick value="" label={`Pick ${meta.label} objective from its pipeline`} placeholder="Now, Next and Someday" className="max-w-full"
            options={pool.map((it, idx) => ({ value: String(idx), label: `${it.lane === "now" ? "★ " : ""}${it.text}` }))}
            onChange={(v) => { const it = pool[Number(v)]; if (it) onPick(it); }} />
        </div>
      )}
    </div>
  );
}
