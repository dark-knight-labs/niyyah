"use client";

import { useState } from "react";
import { Brain, Check, Lightbulb, Link2, OctagonAlert, Pencil, Trash2, Users, type LucideIcon } from "lucide-react";
import { SectionTitle } from "@/components/planner/page-title";
import { StreamMeta } from "@/lib/streams";
import { vaultApi } from "@/lib/vault-api";
import { NotebookEntryData, NotebookKind } from "@/lib/vault-types";

export const KINDS: { id: NotebookKind; label: string; icon: LucideIcon; hint: string }[] = [
  { id: "idea", label: "Idea", icon: Lightbulb, hint: "One line is fine. Promote it to the backlog when it earns a slot." },
  { id: "brainstorm", label: "Brainstorm", icon: Brain, hint: "Messy thinking. Bullets welcome, no structure needed." },
  { id: "link", label: "Link", icon: Link2, hint: "Paste a URL, then say why it matters." },
  { id: "meeting", label: "Meeting", icon: Users, hint: "Who, what was agreed, then actions as '- [ ] text'." },
  { id: "blocker", label: "Blocker", icon: OctagonAlert, hint: "What you wait on and who owns it. Tick it when cleared." },
];
const KIND = Object.fromEntries(KINDS.map((k) => [k.id, k])) as Record<NotebookKind, (typeof KINDS)[number]>;

const URL_AT = /(https?:\/\/[^\s<>)\]]+)/g;

/** Body text with bare URLs made clickable; line breaks are kept by the caller's whitespace-pre-wrap. */
function Linked({ text }: { text: string }) {
  return (
    <>
      {text.split(URL_AT).map((part, i) =>
        i % 2 ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="break-all text-[var(--accent)] underline underline-offset-2">{part}</a> : part)}
    </>
  );
}

interface Props {
  meta: StreamMeta;
  entries: NotebookEntryData[];
  busy: boolean;
  run: (action: () => Promise<unknown>) => Promise<void>;
  /** Start on this filter, e.g. "blocker" when arriving from the blocker bar. */
  initialFilter?: NotebookKind | "all";
}

export function Notebook({ meta, entries, busy, run, initialFilter = "all" }: Props) {
  const stream = meta.id;
  const [kind, setKind] = useState<NotebookKind>("idea");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [filter, setFilter] = useState<NotebookKind | "all">(initialFilter);
  const shown = entries.filter((e) => filter === "all" || e.kind === filter);
  const blockers = entries.filter((e) => e.kind === "blocker");
  const links = entries.filter((e) => e.kind === "link" && e.url);

  async function add() {
    if (!title.trim() && !body.trim()) return;
    await run(async () => {
      await vaultApi.addNotebookEntry(stream, kind, title, body);
      setTitle("");
      setBody("");
      setFilter("all");
    });
  }

  const field = "w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm placeholder:text-[var(--muted-foreground)]";
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="grid min-w-0 gap-3">
        <form className="grid gap-2.5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 sm:p-4"
          onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <div role="group" aria-label="Entry type" className="flex flex-wrap gap-1.5">
            {KINDS.map((k) => (
              <button key={k.id} type="button" aria-pressed={k.id === kind} onClick={() => setKind(k.id)}
                className="flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-bold transition"
                style={k.id === kind ? { borderColor: meta.color, background: `color-mix(in srgb, ${meta.color} 14%, var(--background))` } : { borderColor: "var(--border)" }}>
                <k.icon size={14} aria-hidden="true" style={k.id === kind ? { color: meta.color } : undefined} />
                {k.label}
              </button>
            ))}
          </div>
          <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} aria-label="Title" placeholder="Title (optional)" className={field} />
          <textarea value={body} rows={4} maxLength={8000} onChange={(e) => setBody(e.target.value)} aria-label="Notes" placeholder="Write it down. Paste a link, a meeting recap, a half-formed idea." className={`${field} leading-relaxed`} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-[var(--muted-foreground)]">{KIND[kind].hint}</span>
            <button type="submit" disabled={busy || (!title.trim() && !body.trim())}
              className="min-h-10 rounded-xl bg-[var(--accent)] px-5 text-sm font-bold text-[var(--accent-fg)] disabled:opacity-50">Add to notebook</button>
          </div>
        </form>

        <div role="group" aria-label="Filter" className="flex flex-wrap gap-1.5">
          {[{ id: "all" as const, label: "All", n: entries.length }, ...KINDS.map((k) => ({ id: k.id, label: k.label, n: entries.filter((e) => e.kind === k.id).length })).filter((k) => k.n > 0)].map((f) => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}
              className="min-h-8 rounded-full border border-[var(--border)] px-3 text-xs font-bold text-[var(--muted-foreground)] aria-pressed:border-[var(--foreground)] aria-pressed:bg-[var(--foreground)] aria-pressed:text-[var(--background)]">
              {f.label} <span className="tabular-nums font-medium">{f.n}</span>
            </button>
          ))}
        </div>

        <ul className="grid gap-2.5">
          {shown.length === 0 && <li className="px-1 py-2 text-sm text-[var(--muted-foreground)]">{entries.length ? "Nothing of this type yet." : `Nothing written for ${meta.label} yet. Start above.`}</li>}
          {shown.map((e) => (
            <Entry key={`${e.line}-${e.hash}`} entry={e} meta={meta} busy={busy}
              onSave={(t, b) => run(() => vaultApi.editNotebookEntry(stream, e, t, b))}
              onRemove={() => run(() => vaultApi.removeNotebookEntry(stream, e))}
              onPromote={() => run(() => vaultApi.addPipelineItems(stream, [e.title], "backlog"))} />
          ))}
        </ul>
      </div>

      <aside className="grid gap-3 lg:sticky lg:top-4">
        <section aria-label="Blockers" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5 sm:p-4">
          <SectionTitle title="Blockers" />
          {blockers.length === 0 && <p className="text-sm text-[var(--muted-foreground)]">Nothing is holding this block.</p>}
          <ul className="grid gap-2.5">
            {blockers.map((b) => (
              <li key={`${b.line}-${b.hash}`}>
                <label className="flex items-start gap-2.5 text-sm">
                  <input type="checkbox" checked={!b.open} disabled={busy} onChange={() => void run(() => vaultApi.setBlocker(stream, b, !b.open))} className="mt-1 h-4 w-4 accent-[var(--accent)]" />
                  <span className={`min-w-0 break-words ${b.open ? "" : "text-[var(--muted-foreground)] line-through"}`}>
                    {b.title}
                    {b.date && <span className="block text-xs text-[var(--muted-foreground)] no-underline">{b.date}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
        <section aria-label="Links" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5 sm:p-4">
          <SectionTitle title="Links" />
          {links.length === 0 && <p className="text-sm text-[var(--muted-foreground)]">Saved links appear here.</p>}
          <ul className="grid gap-2">
            {links.map((l) => (
              <li key={`${l.line}-${l.hash}`} className="min-w-0 text-sm">
                <a href={l.url ?? "#"} target="_blank" rel="noopener noreferrer" className="break-words text-[var(--accent)] underline underline-offset-2">{l.title}</a>
              </li>
            ))}
          </ul>
        </section>
      </aside>
    </div>
  );
}

function Entry({ entry, meta, busy, onSave, onRemove, onPromote }: {
  entry: NotebookEntryData; meta: StreamMeta; busy: boolean;
  onSave: (title: string, body: string) => Promise<unknown>; onRemove: () => void; onPromote: () => void;
}) {
  const k = KIND[entry.kind];
  const color = entry.kind === "blocker" ? "var(--destructive)" : meta.color;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(entry.title);
  const [body, setBody] = useState(entry.body);
  const [promoted, setPromoted] = useState(false);
  const btn = "grid h-9 w-9 place-items-center rounded-lg text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-40";
  const promotable = entry.kind === "idea" || entry.kind === "brainstorm" || entry.kind === "meeting";
  return (
    <li className="grid gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5 sm:p-4" style={{ borderLeft: `3px solid ${color}` }}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-[0.08em]" style={{ color }}>
          <k.icon size={13} aria-hidden="true" /> {k.label}
          {entry.kind === "blocker" && !entry.open && <span className="rounded bg-[var(--muted)] px-1.5 py-px normal-case tracking-normal text-[var(--muted-foreground)]">cleared</span>}
          <span className="font-medium normal-case tracking-normal text-[var(--muted-foreground)]">{entry.date}</span>
        </p>
        <div className="-mr-1 flex">
          <button type="button" className={btn} disabled={busy} aria-label="Edit" title="Edit" onClick={() => { setTitle(entry.title); setBody(entry.body); setEditing(true); }}><Pencil size={14} /></button>
          <button type="button" className={`${btn} hover:!text-[var(--destructive)]`} disabled={busy} aria-label="Remove" title="Remove" onClick={onRemove}><Trash2 size={15} /></button>
        </div>
      </div>
      {editing ? (
        <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); void onSave(title, body).then(() => setEditing(false)); }}>
          <input autoFocus value={title} maxLength={200} aria-label="Edit title" onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
            className="min-h-10 rounded-lg border border-[var(--accent)] bg-[var(--background)] px-2.5 text-sm font-bold" />
          <textarea value={body} rows={6} maxLength={8000} aria-label="Edit notes" onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
            className="w-full rounded-lg border border-[var(--accent)] bg-[var(--background)] p-2.5 text-sm leading-relaxed" />
          <div className="flex gap-1.5">
            <button type="submit" disabled={busy} className="min-h-9 rounded-lg bg-[var(--accent)] px-3 text-xs font-bold text-[var(--accent-fg)] disabled:opacity-50">Save</button>
            <button type="button" onClick={() => setEditing(false)} className="min-h-9 rounded-lg px-3 text-xs font-bold text-[var(--muted-foreground)] hover:bg-[var(--muted)]">Cancel</button>
          </div>
        </form>
      ) : (
        <>
          <h3 className="break-words text-[15px] font-bold leading-snug">{entry.title}</h3>
          {entry.body && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed"><Linked text={entry.body} /></p>}
        </>
      )}
      {promotable && !editing && (
        <div>
          <button type="button" disabled={busy || promoted} onClick={() => { onPromote(); setPromoted(true); }}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 text-xs font-bold hover:bg-[var(--muted)] disabled:opacity-60">
            {promoted && <Check size={13} aria-hidden="true" />}{promoted ? "In backlog" : "Promote to backlog"}
          </button>
        </div>
      )}
    </li>
  );
}
