"use client";

import { useState } from "react";
import { vaultApi } from "@/lib/vault-api";
import { VaultTaskData } from "@/lib/vault-types";

interface Props {
  tasks: VaultTaskData[];
  /** Called after a change is saved so the page reloads the list (line hashes change when a task is ticked). */
  onChanged: () => void;
}

/** The day's Obsidian tasks as a checklist. Ticking one writes it into the vault note it lives in. */
export function TaskList({ tasks, onChanged }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(task: VaultTaskData) {
    setBusy(`${task.path}:${task.line}`);
    setError(null);
    try {
      await vaultApi.setTask(task, !task.done);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  const open = tasks.filter((t) => !t.done).length;

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4" aria-label="Tasks for today">
      <h2 className="mb-2 text-sm font-bold">Tasks <span className="font-normal text-[var(--muted-foreground)]">{open} open · {tasks.length - open} done</span></h2>
      {error && <p className="mb-2 text-xs text-[var(--destructive)]">{error}</p>}
      {tasks.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">Nothing due or scheduled today.</p>
      ) : (
        <ul className="space-y-1">
          {tasks.map((t) => {
            const key = `${t.path}:${t.line}`;
            return (
              <li key={key}>
                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={t.done} disabled={busy === key} onChange={() => toggle(t)} />
                  <span className={t.done ? "text-[var(--muted-foreground)] line-through" : ""}>{t.text}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
