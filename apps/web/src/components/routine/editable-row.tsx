"use client";

import { Check, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

interface Props {
  text: string;
  /** Shown instead of the text while it is empty. */
  placeholder?: string;
  struck?: boolean;
  /** Left of the text: a checkbox, a time, a block name. */
  lead?: React.ReactNode;
  maxLength?: number;
  onSave: (text: string) => Promise<void>;
  onDelete?: () => Promise<void>;
}

/** One list row whose text can be edited in place (Enter saves, Esc cancels) and optionally deleted. */
export function EditableRow({ text, placeholder, struck, lead, maxLength = 300, onSave, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  const icon = "grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-40";

  if (editing) {
    return (
      <form className="flex min-h-9 items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) void run(() => onSave(draft.trim())); }}>
        {lead}
        <input autoFocus value={draft} maxLength={maxLength} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
          aria-label="Edit text" className="min-h-8 min-w-0 flex-1 rounded-md border border-[var(--accent)] bg-[var(--background)] px-2.5 text-sm" />
        <button type="submit" disabled={busy || !draft.trim()} aria-label="Save" className={icon}><Check size={16} /></button>
        {onDelete && <button type="button" disabled={busy} aria-label="Delete" onClick={() => void run(onDelete)} className={`${icon} hover:!text-[var(--destructive)]`}><Trash2 size={16} /></button>}
      </form>
    );
  }

  return (
    <div className="group flex min-h-9 items-center gap-2">
      {lead}
      <span className={`min-w-0 flex-1 break-words text-sm ${struck ? "text-[var(--muted-foreground)] line-through" : ""} ${text ? "" : "text-[var(--muted-foreground)]"}`}>{text || placeholder}</span>
      <button aria-label="Edit" onClick={() => { setDraft(text); setEditing(true); }} className={`${icon} opacity-60 group-hover:opacity-100`}><Pencil size={15} /></button>
    </div>
  );
}
