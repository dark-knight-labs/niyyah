"use client";

import { Star, X } from "lucide-react";
import { useState } from "react";
import { Pick } from "@/components/planner/pick";
import { NotesField, TitleField, label } from "@/components/planner/work-card";
import { tagged } from "@/lib/plan-model";
import { StreamMeta } from "@/lib/streams";
import { vaultApi } from "@/lib/vault-api";
import { VaultTaskData } from "@/lib/vault-types";
import { fmtDay } from "@/lib/week";

interface Props {
  task: VaultTaskData;
  day: string;
  streams: StreamMeta[];
  pinned: boolean;
  onPin: () => void;
  /** Runs a task change and reloads the tasks. */
  change: (action: () => Promise<unknown>) => Promise<void>;
  onClose: () => void;
}

const action = "mono inline-flex min-h-8 items-center gap-1.5 border border-[var(--rule)] px-3 hover:bg-[var(--muted)]";

/** The detail card of one task, laid out like a Plan item's: title, details, stream, tags and the actions. */
export function TaskCard({ task, day, streams, pinned, onPin, change, onClose }: Props) {
  const [newTag, setNewTag] = useState("");
  const [asked, setAsked] = useState(false);
  const tags = task.products ?? [];
  const rewrite = (list: string[]) => change(() => vaultApi.editTask(task, tagged(task.text, list)));
  const options = [{ value: "", label: "No stream" }, ...streams.map((s) => ({ value: s.id, label: s.label }))];
  return (
    <section aria-label="Task details" className="mb-2 grid gap-3 border border-[var(--border)] bg-[var(--surface)] p-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className="grid content-start gap-2">
        <p className="mono flex items-center justify-between text-[var(--muted-foreground)]">
          <span>Task · {fmtDay(day, { weekday: "short", day: "numeric", month: "short" })}{task.done ? " · done" : ""}</span>
          <button type="button" onClick={onClose} aria-label="Close task" title="Close" className="grid h-6 w-6 place-items-center hover:text-[var(--foreground)]"><X size={14} aria-hidden="true" /></button>
        </p>
        <TitleField key={`${task.line}-${task.text}`} value={task.text} busy={false} onSave={(t) => void change(() => vaultApi.editTask(task, tagged(t, tags)))} />
        <label><span className={label}>Details</span>
          <NotesField key={`${task.line}-d`} value={task.description ?? ""} busy={false} rows={3} placeholder="Details, context, links…" onSave={(t) => void change(() => vaultApi.describeTask(task, t))} />
        </label>
      </div>
      <div className="grid content-start gap-3">
        {streams.length > 0 && (
          <div>
            <span className={label}>Stream</span>
            <Pick value={task.stream ?? ""} options={options} label="Stream of this task" onChange={(v) => void change(() => vaultApi.setTaskStream(task, v || null))} />
          </div>
        )}
        <div>
          <span className={label}>Tags</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {tags.map((t) => (
              <span key={t} className="mono inline-flex items-center border border-[var(--rule)] text-[var(--muted-foreground)]">
                <span className="px-1.5 py-0.5">#{t}</span>
                <button type="button" aria-label={`Remove tag ${t}`} onClick={() => void rewrite(tags.filter((x) => x !== t))} className="px-1.5 py-0.5 hover:text-[var(--destructive)]">×</button>
              </span>
            ))}
            <input value={newTag} placeholder="+ tag" aria-label="Add a tag" maxLength={30} onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                const w = newTag.trim().replace(/^#/, "").toLowerCase().replace(/[^\w-]/g, "");
                if (w && !tags.includes(w)) void rewrite([...tags, w]).then(() => setNewTag(""));
              }}
              className="mono w-24 border-0 border-b border-[var(--rule)] bg-transparent py-0.5 outline-none focus:border-[var(--accent)]" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={task.done} onClick={() => void change(() => vaultApi.setTask(task, !task.done))} className={action}>{task.done ? "Reopen" : "Mark done"}</button>
          <button type="button" aria-pressed={pinned} onClick={onPin} className={`${action} ${pinned ? "text-[var(--accent)]" : ""}`}><Star size={12} aria-hidden="true" className={pinned ? "fill-[var(--accent)]" : ""} />{pinned ? "Important" : "Mark important"}</button>
          <button type="button" onClick={() => (asked ? (onClose(), void change(() => vaultApi.removeTask(task))) : setAsked(true))} onBlur={() => setAsked(false)}
            className={`${action} border-[var(--destructive)] text-[var(--destructive)]`}>{asked ? "Confirm delete" : "Delete"}</button>
        </div>
      </div>
    </section>
  );
}
