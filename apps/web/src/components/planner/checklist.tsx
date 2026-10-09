"use client";

import { useRef, useState } from "react";
import { Checkbox } from "@/components/routine/checkbox";
import { ChecklistItemData, ChecklistLine } from "@/lib/vault-types";

interface Props {
  items: ChecklistItemData[];
  /** Names the list for screen readers and, when `title` is not given, nothing else. */
  label: string;
  /** A small heading with the count at its right. Leave out when the caller draws its own heading. */
  title?: string;
  busy?: boolean;
  /** Tick or untick one line. */
  onToggle: (item: ChecklistItemData, done: boolean) => void | Promise<unknown>;
  /** Replace all the lines (an edit, an added or a removed line). Leave out for a read-only list. */
  onChange?: (lines: ChecklistLine[]) => void | Promise<unknown>;
  placeholder?: string;
  /** Show the count and a thin progress rule. */
  progress?: boolean;
  /** Text shown when the list is empty and not editable. */
  empty?: string;
}

/** A short list of lines with small checkboxes: tick, edit in place (Enter saves), remove on hover, add at the foot. The tick shows at once. */
export function Checklist({ items, label, title, busy, onToggle, onChange, placeholder = "Add a line", progress = true, empty }: Props) {
  // Show the tick immediately; whatever the server then sends replaces it (state adjusted during render, not in an effect).
  const [shown, setShown] = useState(items);
  const [seen, setSeen] = useState(items);
  if (items !== seen) { setSeen(items); setShown(items); }
  const [draft, setDraft] = useState("");
  const count = useRef<HTMLSpanElement>(null);

  const done = shown.filter((i) => i.done).length;
  const lines = (list: ChecklistItemData[]): ChecklistLine[] => list.map((i) => ({ id: i.id, text: i.text, done: i.done }));

  function tick(item: ChecklistItemData) {
    const next = !item.done;
    setShown(shown.map((i) => (i.id === item.id ? { ...i, done: next } : i)));
    const el = count.current;
    if (el) { el.classList.remove("niy-bump"); void el.offsetWidth; el.classList.add("niy-bump"); }
    void onToggle(item, next);
  }

  function edit(item: ChecklistItemData, text: string) {
    const clean = text.replace(/\s+/g, " ").trim();
    if (clean === item.text) return;
    const next = clean ? shown.map((i) => (i.id === item.id ? { ...i, text: clean } : i)) : shown.filter((i) => i.id !== item.id);
    setShown(next);
    void onChange?.(lines(next));
  }

  function remove(item: ChecklistItemData) {
    const next = shown.filter((i) => i.id !== item.id);
    setShown(next);
    void onChange?.(lines(next));
  }

  function add() {
    const text = draft.replace(/\s+/g, " ").trim();
    if (!text) return;
    setDraft("");
    void onChange?.([...lines(shown), { text }]);
  }

  return (
    <div role="group" aria-label={label} className="grid gap-0.5">
      {(title || progress) && (
        <div className="flex items-baseline justify-between gap-3">
          {title ? <span className="text-[0.6875rem] font-bold uppercase tracking-[0.09em] text-[var(--muted-foreground)]">{title}</span> : <span />}
          {progress && shown.length > 0 && <span ref={count} className={`font-mono text-[0.71875rem] tabular-nums ${done === shown.length ? "font-semibold text-[var(--accent)]" : "text-[var(--muted-foreground)]"}`}>{done} / {shown.length}</span>}
        </div>
      )}
      {progress && shown.length > 0 && (
        <div className="mb-1 h-0.5 overflow-hidden rounded bg-[var(--muted)]" aria-hidden="true">
          <div className="h-full bg-[var(--accent)] transition-[width] duration-[400ms] ease-out" style={{ width: `${(100 * done) / shown.length}%` }} />
        </div>
      )}
      {shown.length === 0 && !onChange && empty && <p className="py-1 text-sm text-[var(--muted-foreground)]">{empty}</p>}
      {shown.map((item) => (
        <div key={item.id} data-check-row className="group -mx-1.5 flex min-h-[1.875rem] items-start gap-2.5 rounded-md px-1.5 py-[0.3125rem] hover:bg-[color-mix(in_srgb,var(--muted)_55%,transparent)]">
          <span className="mt-[0.2rem] flex"><Checkbox checked={item.done} disabled={busy} label={`${item.done ? "Reopen" : "Done"}: ${item.text}`} onChange={() => tick(item)} /></span>
          <span
            contentEditable={onChange ? "plaintext-only" : undefined} suppressContentEditableWarning spellCheck={false}
            onBlur={(e) => onChange && edit(item, e.currentTarget.textContent ?? "")}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
            className={`min-w-0 flex-1 break-words text-sm leading-snug outline-none transition-colors [text-decoration-line:line-through] [text-decoration-thickness:1px] focus:shadow-[0_1px_0_var(--accent)] ${item.done ? "text-[var(--muted-foreground)] [text-decoration-color:var(--muted-foreground)]" : "[text-decoration-color:transparent]"} [transition-property:color,text-decoration-color] duration-300`}
          >{item.text}</span>
          {onChange && (
            <button type="button" aria-label={`Remove: ${item.text}`} onClick={() => remove(item)}
              className="rounded px-1.5 text-[0.9375rem] leading-none text-[var(--muted-foreground)] opacity-0 hover:text-[var(--destructive)] focus-visible:opacity-100 group-hover:opacity-100">×</button>
          )}
        </div>
      ))}
      {onChange && (
        <label className="flex items-center gap-2.5 py-1 text-[var(--muted-foreground)]">
          <span className="w-[0.875rem] text-center text-[0.9375rem] leading-none" aria-hidden="true">+</span>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} maxLength={400} aria-label={`${label}: add a line`}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
            className="min-w-0 flex-1 border-0 border-b border-transparent bg-transparent py-0.5 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] focus:border-[var(--accent)]" />
        </label>
      )}
    </div>
  );
}
