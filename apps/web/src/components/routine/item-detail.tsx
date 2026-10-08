"use client";

import { useEffect, useRef } from "react";

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

/** A read-only card with everything the vault knows about one item. Closes on Escape, the backdrop or Close. */
export function ItemDetail({ title, eyebrow, fields, description, actions, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[0_12px_30px_rgba(0,0,0,.2)] sm:max-w-md sm:rounded-xl">
        {eyebrow && <p className="mb-1 text-[0.6875rem] font-bold uppercase tracking-[0.09em] text-[var(--muted-foreground)]">{eyebrow}</p>}
        <h2 className="font-serif text-lg leading-snug [text-wrap:balance]">{title}</h2>
        <dl className="mt-3 grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1.5 text-[0.8125rem]">
          {fields.map((f) => (
            <div key={f.label} className="contents">
              <dt className="text-[var(--muted-foreground)]">{f.label}</dt>
              <dd className="min-w-0 break-words">{f.value}</dd>
            </div>
          ))}
        </dl>
        {description && (
          <div className="mt-3 border-t border-[var(--border)] pt-3">
            <p className="mb-1 text-[0.6875rem] font-bold uppercase tracking-[0.09em] text-[var(--muted-foreground)]">Notes</p>
            <p className="whitespace-pre-wrap text-[0.8125rem] leading-relaxed">{description}</p>
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          {actions}
          <button ref={closeRef} type="button" onClick={onClose}
            className="min-h-9 rounded-lg border border-[var(--border)] px-3 text-xs font-semibold hover:bg-[var(--muted)]">Close</button>
        </div>
      </div>
    </div>
  );
}
