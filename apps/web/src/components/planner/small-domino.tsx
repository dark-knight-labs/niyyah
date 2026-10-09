"use client";

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
}

/** The week's one thing for a stream: tick it, rewrite it, or pick it from the pipeline. */
export function SmallDomino({ meta, objective, pool, run, onPick }: Props) {
  if (!meta.weekly) return <p className="text-sm text-[var(--muted-foreground)]">No weekly objective for this stream.</p>;
  const done = objective?.done ?? false;
  return (
    <div>
      <EditableRow text={objective?.text ?? ""} placeholder="Choose the one thing for this week" struck={done} maxLength={200}
        lead={<Checkbox checked={done} disabled={!objective?.text} label={`${meta.label} objective done`}
          onChange={() => void run(() => vaultApi.setObjective(meta.id, { done: !done }))} />}
        onSave={async (text) => { await run(() => vaultApi.setObjective(meta.id, { text })); }} />
      {!objective?.text && pool.length > 0 && (
        <label className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted-foreground)]">
          <span>Pick from pipeline</span>
          <select defaultValue="" aria-label={`Pick ${meta.label} objective from its pipeline`}
            onChange={(e) => { const it = pool[Number(e.target.value)]; if (it) onPick(it); }}
            className="min-h-9 max-w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-small text-[var(--foreground)]">
            <option value="" disabled>Now, Next and Someday…</option>
            {pool.map((it, idx) => <option key={it.line} value={idx}>{it.lane === "now" ? "★ " : ""}{it.text}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}
