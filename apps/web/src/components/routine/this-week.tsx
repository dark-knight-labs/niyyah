"use client";

import { vaultApi } from "@/lib/vault-api";
import { colorVar } from "@/lib/streams";
import { QuarterData, VaultObjectivesData } from "@/lib/vault-types";
import { EditableRow } from "@/components/routine/editable-row";

/** The quarter goal and each stream's small domino for the week, as plain text beside a stream-coloured square. Click the pencil to edit a domino in place. */
export function ThisWeek({ quarter, objectives, onChanged }: { quarter: QuarterData | null; objectives: VaultObjectivesData | null; onChanged: () => void }) {
  const items = (objectives?.items ?? []).filter((o) => o.text);
  return (
    <section aria-label="This week" className="border border-[var(--border)] bg-[var(--surface)]">
      <h2 className="mono flex h-[30px] items-center justify-between border-b border-[var(--border)] px-3 text-[var(--foreground)]">
        This week
        {quarter && <span className="font-normal text-[var(--muted-foreground)]">Wk {quarter.week_of_quarter} / {quarter.weeks_in_quarter}</span>}
      </h2>
      <div className="grid gap-1 px-3 py-2.5 text-small">
        {quarter?.objective && (
          <>
            <p className="mono text-[var(--muted-foreground)]">Quarter goal</p>
            <p className="mb-1">{quarter.objective}</p>
          </>
        )}
        <p className="mono mt-1 text-[var(--muted-foreground)]">Small dominoes</p>
        {items.length === 0 && <p className="text-[var(--muted-foreground)]">None set for this week.</p>}
        {items.map((o) => (
          <div key={o.stream} className="border-t border-[var(--border)] first:border-t-0">
            <EditableRow text={o.text} struck={o.done} maxLength={300}
              lead={<span className="h-2 w-2 shrink-0" style={{ background: colorVar(o.color) }} aria-hidden="true" />}
              onSave={async (text) => { await vaultApi.setObjective(o.stream, { text }); onChanged(); }} />
          </div>
        ))}
      </div>
    </section>
  );
}
