"use client";

import { useState } from "react";
import { Pick } from "@/components/planner/pick";
import { useBlocks } from "@/lib/blocks";
import { parseHabit } from "@/lib/habit";
import { parseDraft } from "@/lib/draft";
import { Tab } from "@/lib/plan-model";
import { StreamMeta } from "@/lib/streams";
import { vaultApi } from "@/lib/vault-api";
import { NotebookKind } from "@/lib/vault-types";

type Kind = NotebookKind | "task" | "habit";

const KINDS: { id: Kind; label: string }[] = [
  { id: "idea", label: "Idea" },
  { id: "meeting", label: "Meeting" },
  { id: "blocker", label: "Blocker" },
  { id: "task", label: "Task" },
  { id: "habit", label: "Habit" },
];

interface Props {
  streams: StreamMeta[];
  /** The block the work list is narrowed to; new entries go there. Null = All, so the capture bar asks. */
  stream: string | null;
  busy: boolean;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
  /** Called after a save, with the tab the new entry lives on. */
  onAdded: (tab: Tab, count: number) => void;
  /** Saves a habit; resolves true when it was saved. */
  onHabit: (habit: { name: string; block: string; anchor: string; minimum: string; per_week: number }) => Promise<boolean>;
}

/** One line to write something down: an idea, a meeting, a blocker (into the block's notebook) or tasks (into Someday). */
export function CaptureBar({ streams, stream, busy, run, onAdded, onHabit }: Props) {
  const dayBlocks = useBlocks().list.filter((b) => !b.archived);
  const [kind, setKind] = useState<Kind>("idea");
  const [text, setText] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const [habitBlock, setHabitBlock] = useState<string | null>(null);
  const habitTo = habitBlock ?? dayBlocks[0]?.key ?? "";
  const to = stream ?? target ?? streams[0]?.id ?? "";
  const items = kind === "task" ? parseDraft(text) : [];
  const lines = text.split("\n").filter((l) => l.trim());
  const habit = kind === "habit" ? parseHabit(lines[0] ?? "") : null;
  const ready = kind === "habit" ? !!habit?.name && !!habitTo : kind === "task" ? items.length > 0 : lines.length > 0;

  async function add() {
    if (!ready || (!to && kind !== "habit")) return;
    if (habit) {
      if (await onHabit({ ...habit, block: habitTo })) setText("");
      return;
    }
    const ok = await run(async () => {
      if (kind === "task") await vaultApi.addPipelineItems(to, items.map((i) => i.text), "backlog", items.map((i) => i.description));
      else if (kind !== "habit") await vaultApi.addNotebookEntry(to, kind, lines[0].trim(), lines.slice(1).map((l) => l.trim()).join("\n"));
    });
    if (ok) {
      setText("");
      onAdded(kind === "task" ? "someday" : "notes", kind === "task" ? items.length : 1);
    }
  }

  return (
    <div className="mb-4 flex flex-wrap items-stretch border border-[var(--border)] bg-[var(--surface)] focus-within:shadow-[inset_0_-2px_0_var(--accent)]">
      <span className="mono grid w-11 place-items-center border-r border-[var(--border)] text-base text-[var(--accent)]" aria-hidden="true">+</span>
      <textarea id="plan-capture" value={text} rows={1} maxLength={8000} aria-label="Capture" disabled={!streams.length}
        placeholder={kind === "habit" ? "A habit. Walk 20 min @after Asr, min: 5 min, 5/wk. Enter saves." : "Write it down. Idea, link, recap, blocker, or a list of tasks. #tag and #oct #nov #dec work per line. Enter saves."}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void add(); }
          if (e.key === "Escape") e.currentTarget.blur();
        }}
        style={{ height: `${Math.min(200, Math.max(52, 28 + 22 * Math.max(1, text.split("\n").length)))}px` }}
        className="min-w-0 flex-[1_1_18rem] resize-none bg-transparent px-4 py-3.5 text-small leading-[1.4] outline-none placeholder:text-[var(--muted-foreground)]" />
      <div role="group" aria-label="Kind" className="flex border-l border-[var(--border)] max-md:basis-full max-md:border-l-0 max-md:border-t">
        {KINDS.map((k) => (
          <button key={k.id} type="button" aria-pressed={kind === k.id} onClick={() => setKind(k.id)}
            className="mono flex min-h-9 flex-1 items-center justify-center border-r border-[var(--border)] px-3.5 text-[var(--muted-foreground)] last:border-r-0 hover:bg-[var(--muted)] aria-pressed:bg-[var(--muted)] aria-pressed:text-[var(--foreground)] aria-pressed:shadow-[inset_0_-2px_0_var(--accent)]">
            {k.label}
          </button>
        ))}
      </div>
      {kind === "habit" && dayBlocks.length > 0 && (
        <div className="flex items-center border-l border-[var(--border)] px-2 max-md:border-l-0 max-md:border-t">
          <Pick value={habitTo} label="Day block" options={dayBlocks.map((b) => ({ value: b.key, label: b.label }))} onChange={setHabitBlock} />
        </div>
      )}
      {kind !== "habit" && !stream && streams.length > 1 && (
        <div className="flex items-center border-l border-[var(--border)] px-2 max-md:border-l-0 max-md:border-t">
          <Pick value={to} label="Add to block" options={streams.map((s) => ({ value: s.id, label: s.label }))} onChange={setTarget} />
        </div>
      )}
      <button type="button" onClick={() => void add()} disabled={busy || !ready}
        className="mono flex min-h-11 items-center gap-2 bg-[var(--foreground)] px-5 text-[var(--background)] hover:opacity-90 disabled:opacity-40 max-md:flex-1">
        {kind === "task" && items.length > 1 ? `Add ${items.length} items` : "Add"}
      </button>
    </div>
  );
}
