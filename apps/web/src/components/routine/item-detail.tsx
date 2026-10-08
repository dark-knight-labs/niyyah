"use client";

import { useEffect } from "react";

export interface DetailField {
  label: string;
  value: React.ReactNode;
}

interface Props {
  title: string;
  /** Small coloured line above the title, e.g. the block name. */
  eyebrow?: React.ReactNode;
  fields: DetailField[];
  /** Free notes kept under the item in the vault; shown as written. */
  description?: string;
  actions?: React.ReactNode;
  onClose: () => void;
}

/** Everything the vault knows about one item, shown inline under its row. Esc or Close folds it away. */
export function ItemDetail({ title, eyebrow, fields, description, actions, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <section aria-label={title} className="grid gap-x-8 gap-y-3 px-1 py-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div>
        {eyebrow && <p className="mb-0.5 text-[0.6875rem] font-bold uppercase tracking-[0.09em] text-[var(--muted-foreground)]">{eyebrow}</p>}
        <h3 className="font-serif text-base leading-snug [text-wrap:balance]">{title}</h3>
        <dl className="mt-2 grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1 text-[0.8125rem]">
          {fields.map((f) => (
            <div key={f.label} className="contents">
              <dt className="text-[var(--muted-foreground)]">{f.label}</dt>
              <dd className="min-w-0 break-words">{f.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="flex flex-col justify-between gap-3">
        <div>
          <p className="mb-1 text-[0.6875rem] font-bold uppercase tracking-[0.09em] text-[var(--muted-foreground)]">Notes</p>
          {description
            ? <p className="whitespace-pre-wrap text-[0.8125rem] leading-relaxed">{description}</p>
            : <p className="text-[0.8125rem] text-[var(--muted-foreground)]">No notes. Add indented lines under the task in the vault.</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          <button type="button" onClick={onClose} className="min-h-9 rounded-lg px-3 text-xs font-semibold text-[var(--muted-foreground)] hover:bg-[var(--muted)]">Close</button>
        </div>
      </div>
    </section>
  );
}
