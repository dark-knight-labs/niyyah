"use client";

import { useState } from "react";


/** A titled block of the routine page: small caps title, a quiet note on the right, an error line. */
export function Section({ title, aside, error, children }: { title: string; aside?: string; error?: string | null; children: React.ReactNode }) {
  return (
    <section className="mb-6" aria-label={title}>
      <h2 className="mb-2.5 flex items-baseline justify-between text-xs font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">
        {title}
        {aside && <span className="text-xs font-medium normal-case tracking-normal">{aside}</span>}
      </h2>
      {error && <p className="mb-2 text-xs text-[var(--destructive)]">{error}</p>}
      {children}
    </section>
  );
}

/** One text input with its button; clears itself once the add succeeded. */
export function AddForm({ placeholder, button, onAdd }: { placeholder: string; button: string; onAdd: (text: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      await onAdd(text.trim());
      setText("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-2.5 flex gap-2">
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} maxLength={300} aria-label={placeholder}
        className="min-h-11 min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 text-sm placeholder:text-[var(--muted-foreground)]" />
      <button type="submit" disabled={busy || !text.trim()} className="min-h-11 rounded-xl bg-[var(--accent)] px-4 text-sm font-bold text-[var(--accent-fg)] disabled:opacity-50">{button}</button>
    </form>
  );
}
