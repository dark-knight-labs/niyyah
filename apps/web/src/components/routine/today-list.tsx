"use client";

import { useState } from "react";
import { vaultApi } from "@/lib/vault-api";
import { VaultLogEntry, VaultTaskData } from "@/lib/vault-types";
import { Checkbox } from "@/components/routine/checkbox";
import { EditableRow } from "@/components/routine/editable-row";
import { Section } from "@/components/routine/section";

interface Props {
  /** "YYYY-MM-DD" the list is for; new tasks are scheduled on it. */
  day: string;
  tasks: VaultTaskData[];
  entries: VaultLogEntry[];
  /** The part of the day a new log line is filed under, e.g. "OT" and "06:00-16:02". */
  section: string;
  span: string;
  /** Called after a change so the page reloads (line hashes change when a task is ticked or edited). */
  onChanged: () => void;
}

/** The day's tasks and log lines in one list. One input adds either: a task, or a timestamped log line. */
export function TodayList({ day, tasks, entries, section, span, onChanged }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<"task" | "log">("task");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    }
    onChanged();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    setBusy(true);
    await save(() => (kind === "task" ? vaultApi.addTask(day, value) : vaultApi.addNote(day, section, span, value)));
    setText("");
    setBusy(false);
  }

  const open = tasks.filter((t) => !t.done).length;
  const row = "border-t border-[var(--border)] first:border-t-0";

  return (
    <Section title="Today" aside={`${open} open · ${entries.length} logged`} error={error}>
      {tasks.length === 0 && entries.length === 0 && <p className="py-2 text-sm text-[var(--muted-foreground)]">Nothing due and nothing logged yet.</p>}
      <ul>
        {tasks.map((t) => (
          <li key={`${t.path}:${t.line}`} className={row}>
            <EditableRow text={t.text} struck={t.done}
              lead={<Checkbox checked={t.done} label={`Done: ${t.text}`} onChange={() => void save(() => vaultApi.setTask(t, !t.done))} />}
              onSave={(next) => save(() => vaultApi.editTask(t, next))}
              onDelete={() => save(() => vaultApi.removeTask(t))} />
          </li>
        ))}
        {[...entries].reverse().map((entry) => (
          <li key={`${entry.index}:${entry.hash}`} className={`${row} ${tasks.length ? "" : "first:border-t-0"}`}>
            <EditableRow text={entry.text} maxLength={500}
              onSave={(next) => save(() => vaultApi.editLog(day, entry, next))}
              onDelete={() => save(() => vaultApi.removeLog(day, entry))} />
          </li>
        ))}
      </ul>
      <form onSubmit={submit} className="mt-2 flex items-center gap-1.5 border-t border-[var(--border)] pt-2">
        <select value={kind} onChange={(e) => setKind(e.target.value as "task" | "log")} aria-label="Entry type"
          className="min-h-10 rounded-[5px] border border-[var(--border)] bg-[var(--surface)] px-1.5 text-xs font-semibold">
          <option value="task">To do</option>
          <option value="log">Log</option>
        </select>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={300}
          placeholder={kind === "task" ? "Add a task for today" : "Log what just happened"} aria-label={kind === "task" ? "Add a task for today" : "Log what just happened"}
          className="min-h-10 min-w-0 flex-1 rounded-[5px] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm placeholder:text-[var(--muted-foreground)]" />
        <button type="submit" disabled={busy || !text.trim()} className="min-h-10 rounded-[5px] bg-[var(--accent)] px-3.5 text-sm font-bold text-[var(--accent-fg)] disabled:opacity-50">
          {kind === "task" ? "Add" : "Log"}
        </button>
      </form>
    </Section>
  );
}
