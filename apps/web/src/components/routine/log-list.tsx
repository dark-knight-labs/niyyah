"use client";

import { useState } from "react";
import { vaultApi } from "@/lib/vault-api";
import { VaultLogEntry } from "@/lib/vault-types";
import { EditableRow } from "@/components/routine/editable-row";
import { Section, AddForm } from "@/components/routine/section";

interface Props {
  day: string;
  entries: VaultLogEntry[];
  /** The part of the day a new line is filed under, e.g. "OT" and "06:00-16:02". */
  section: string;
  span: string;
  onChanged: () => void;
}

/** What happened today: the day note's Log lines, newest first. Each can be edited or deleted. */
export function LogList({ day, entries, section, span, onChanged }: Props) {
  const [error, setError] = useState<string | null>(null);

  async function save(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    }
    onChanged();
  }

  return (
    <Section title="Log" aside="what happened, timestamped" error={error}>
      {entries.length === 0 ? (
        <p className="py-2 text-sm text-[var(--muted-foreground)]">Nothing logged yet.</p>
      ) : (
        <ul>
          {[...entries].reverse().map((entry) => (
            <li key={`${entry.index}:${entry.hash}`} className="border-b border-[var(--border)]">
              <EditableRow text={entry.text} maxLength={500}
                onSave={(text) => save(() => vaultApi.editLog(day, entry, text))}
                onDelete={() => save(() => vaultApi.removeLog(day, entry))} />
            </li>
          ))}
        </ul>
      )}
      <AddForm placeholder="Log what just happened" button="Log" onAdd={(text) => save(() => vaultApi.addNote(day, section, span, text))} />
    </Section>
  );
}
