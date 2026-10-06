"use client";

import { useState } from "react";
import { ROUTINE_BLOCKS, RoutineBlock } from "@/lib/routine";
import { vaultApi } from "@/lib/vault-api";
import { VaultObjectivesData } from "@/lib/vault-types";
import { Checkbox } from "@/components/routine/checkbox";
import { EditableRow } from "@/components/routine/editable-row";
import { Section } from "@/components/routine/section";

interface Props {
  data: VaultObjectivesData | null;
  onChanged: (data: VaultObjectivesData) => void;
}

/** The one thing to achieve this week, per block, kept in the vault's weekly objectives note. */
export function WeekObjectives({ data, onChanged }: Props) {
  const [error, setError] = useState<string | null>(null);
  if (!data) return null;

  async function save(block: string, change: { text?: string; done?: boolean }) {
    setError(null);
    try {
      onChanged(await vaultApi.setObjective(block, change));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    }
  }

  const done = data.items.filter((i) => i.done).length;

  return (
    <Section title="This week" aside={`${data.week} · ${done} / ${data.items.length} done`} error={error}>
      <ul className="space-y-2">
        {data.items.map((item) => {
          const meta = ROUTINE_BLOCKS[item.block as RoutineBlock];
          if (!meta) return null;
          return (
            <li key={item.block} className="border-b border-l-[3px] border-b-[var(--border)] pl-3" style={{ borderLeftColor: meta.color }}>
              <EditableRow text={item.text} placeholder="Set this week's one thing" struck={item.done} maxLength={200}
                lead={
                  <>
                    <span className="w-24 shrink-0 text-xs font-extrabold uppercase tracking-[0.08em]" style={{ color: meta.color }}>{meta.label}</span>
                    <Checkbox checked={item.done} disabled={!item.text} label={`${meta.label} objective done`} onChange={() => void save(item.block, { done: !item.done })} />
                  </>
                }
                onSave={(text) => save(item.block, { text })} />
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
