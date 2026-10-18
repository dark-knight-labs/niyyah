"use client";

import { vaultApi } from "@/lib/vault-api";
import { colorVar } from "@/lib/streams";
import { QuarterData, VaultObjectivesData } from "@/lib/vault-types";
import { EditableRow } from "@/components/routine/editable-row";

/** Each stream's small domino for the week: plain text lines beside a stream-coloured square. Click one to edit it in place. */
export function ThisWeek({ quarter, objectives, onChanged }: { quarter: QuarterData | null; objectives: VaultObjectivesData | null; onChanged: () => void }) {
  const items = (objectives?.items ?? []).filter((o) => o.text);
  const square = (color: string) => <span className="h-2 w-2 shrink-0 self-center" style={{ background: colorVar(color) }} aria-hidden="true" />;
  return (
    <section aria-label="This week" className="border border-[var(--border)] bg-[var(--surface)]">
      <h2 className="mono flex h-[30px] items-center justify-between border-b border-[var(--border)] px-3 text-[var(--foreground)]">
        This week
        {quarter && <span className="font-normal text-[var(--muted-foreground)]">Wk {quarter.week_of_quarter} / {quarter.weeks_in_quarter}</span>}
      </h2>
      <div className="grid gap-0.5 px-3 py-2 text-small">
        {items.length === 0 && <p className="text-[var(--muted-foreground)]">None set for this week.</p>}
        {items.map((o) => (
          <EditableRow key={o.stream} compact text={o.text} struck={o.done} maxLength={300} lead={square(o.color)}
            onSave={async (text) => { await vaultApi.setObjective(o.stream, { text }); onChanged(); }} />
        ))}
      </div>
    </section>
  );
}
