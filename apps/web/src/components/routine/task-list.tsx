"use client";

import { useState } from "react";
import { vaultApi } from "@/lib/vault-api";
import { VaultTaskData } from "@/lib/vault-types";
import { Checkbox } from "@/components/routine/checkbox";
import { EditableRow } from "@/components/routine/editable-row";
import { Section, AddForm } from "@/components/routine/section";

interface Props {
  /** "YYYY-MM-DD" the list is for; new tasks are scheduled on it. */
  day: string;
  tasks: VaultTaskData[];
  /** Called after a change so the page reloads the list (line hashes change when a task is ticked or edited). */
  onChanged: () => void;
}

/** The day's Obsidian tasks as a checklist. Ticking, editing or deleting one rewrites the vault note it lives in. */
export function TaskList({ day, tasks, onChanged }: Props) {
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

  const done = tasks.filter((t) => t.done).length;

  return (
    <Section title="Tasks" aside={`${done} / ${tasks.length}`} error={error}>
      {tasks.length === 0 ? (
        <p className="py-2 text-sm text-[var(--muted-foreground)]">Nothing due or scheduled today.</p>
      ) : (
        <ul>
          {tasks.map((t) => (
            <li key={`${t.path}:${t.line}`} className="border-b border-[var(--border)]">
              <EditableRow text={t.text} struck={t.done}
                lead={<Checkbox checked={t.done} label={`Done: ${t.text}`} onChange={() => void save(() => vaultApi.setTask(t, !t.done))} />}
                onSave={(text) => save(() => vaultApi.editTask(t, text))}
                onDelete={() => save(() => vaultApi.removeTask(t))} />
            </li>
          ))}
        </ul>
      )}
      <AddForm placeholder="Add a task for today" button="Add" onAdd={(text) => save(() => vaultApi.addTask(day, text))} />
    </Section>
  );
}
