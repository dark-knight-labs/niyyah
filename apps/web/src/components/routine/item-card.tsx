"use client";

import { Star, X } from "lucide-react";
import { useState } from "react";
import { Checklist } from "@/components/planner/checklist";
import { Pick } from "@/components/planner/pick";
import { NotesField, TitleField, label } from "@/components/planner/work-card";
import { meetingName } from "@/components/routine/calendar-parts";
import type { Items } from "@/hooks/use-items";
import { isTimed, subtaskStat } from "@/lib/items";
import { formatDuration } from "@/lib/ring";
import { formatMinutes } from "@/lib/routine";
import { StreamMeta } from "@/lib/streams";
import type { ChecklistLine, ItemData, ItemFields, ItemStatus } from "@/lib/vault-types";
import { fmtDay } from "@/lib/week";

interface Props {
  item: ItemData;
  streams: StreamMeta[];
  items: Items;
  pinned: boolean;
  onPin: () => void;
  onClose: () => void;
  /** After any saved change (the planner reads tasks too). */
  onChanged?: () => void;
  /** An own item was moved to another day: the card follows it there. */
  onMoved?: (day: string) => void;
}

const action = "mono inline-flex min-h-8 items-center gap-1.5 border border-[var(--rule)] px-3 hover:bg-[var(--muted)]";
const seg = "mono min-h-7 px-2.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)] aria-pressed:bg-[var(--foreground)] aria-pressed:text-[var(--background)]";
const STATUSES: { value: ItemStatus; label: string }[] = [{ value: "open", label: "Open" }, { value: "done", label: "Done" }, { value: "skipped", label: "Skipped" }];
const toMin = (hhmm: string) => (/^\d{2}:\d{2}$/.test(hhmm) ? Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) : null);
const hhmm = (min: number) => formatMinutes(Math.min(1439, Math.max(0, min)));
const cleanTag = (raw: string) => raw.trim().replace(/^#/, "").toLowerCase().replace(/[^\w-]/g, "");

/** A segmented row of choices, one pressed. */
function Segments<T extends string | number>({ value, options, label: name, onChange }: { value: T; options: { value: T; label: string; aria?: string }[]; label: string; onChange: (v: T) => void }) {
  return (
    <span role="group" aria-label={name} className="inline-flex w-fit border border-[var(--rule)]">
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} aria-label={o.aria} onClick={() => o.value !== value && onChange(o.value)} className={seg}>{o.label}</button>
      ))}
    </span>
  );
}

/** Start and end of a timed own item; a change saves when the field is left and the range makes sense. */
function TimeRange({ start, end, onSave }: { start: number; end: number; onSave: (start: number, end: number) => void }) {
  const [from, setFrom] = useState(hhmm(start));
  const [to, setTo] = useState(hhmm(end));
  const commit = () => {
    const s = toMin(from);
    const e = toMin(to);
    if (s === null || e === null || e <= s) { setFrom(hhmm(start)); setTo(hhmm(end)); return; }
    if (s !== start || e !== end) onSave(s, e);
  };
  const field = "mono min-h-7 border border-[var(--rule)] bg-[var(--surface)] px-1.5";
  return (
    <span className="inline-flex items-center gap-1.5" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) commit(); }}>
      <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} onKeyDown={(e) => e.key === "Enter" && commit()} aria-label="Start time" className={field} />
      <span className="text-[var(--muted-foreground)]">–</span>
      <input type="time" value={to} onChange={(e) => setTo(e.target.value)} onKeyDown={(e) => e.key === "Enter" && commit()} aria-label="End time" className={field} />
    </span>
  );
}

/**
 * The details card of any item, own task or calendar event: status, weight, stream, tags, sub-tasks and notes for both.
 * An own item also has its title, day, time and Delete; a calendar item's title and time stay its calendar's.
 */
export function ItemCard({ item, streams, items, pinned, onPin, onClose, onChanged, onMoved }: Props) {
  const [newTag, setNewTag] = useState("");
  const [asked, setAsked] = useState(false);
  const own = item.kind === "task";
  const day = item.day ?? "";
  const timed = isTimed(item);
  const tags = item.products;
  const subs = subtaskStat(item.checklist);
  const after = (ok: boolean) => { if (ok) onChanged?.(); };
  const save = (fields: ItemFields) => (own ? items.patch(item, fields) : items.annotate(item, fields)).then(after);
  const lines = (list: { id?: string; text: string; done?: boolean }[]): ChecklistLine[] => list.map((l) => ({ id: l.id, text: l.text, done: !!l.done }));
  const options = [{ value: "", label: "No stream" }, ...streams.map((s) => ({ value: s.id, label: s.label }))];
  const when = timed ? `${formatMinutes(item.start_min as number)}–${formatMinutes(item.end_min as number)} · ${formatDuration((item.end_min as number) - (item.start_min as number))}` : "All day";
  const ref = `${item.kind}-${item.id ?? item.key}-${day}`;

  function addTag() {
    const w = cleanTag(newTag);
    setNewTag("");
    if (w && !tags.includes(w)) void save({ products: [...tags, w] });
  }

  return (
    <section aria-label="Item details" data-kind={item.kind} className="mb-2 grid gap-3 border border-[var(--border)] bg-[var(--surface)] p-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className="grid content-start gap-2">
        <p className="mono flex items-center justify-between gap-2 text-[var(--muted-foreground)]">
          <span className="min-w-0 truncate">{own ? "Task" : `Event · ${item.calendar ?? "calendar"}`} · {fmtDay(day, { weekday: "short", day: "numeric", month: "short" })} · {when}</span>
          <button type="button" onClick={onClose} aria-label="Close details" title="Close" className="grid h-6 w-6 shrink-0 place-items-center hover:text-[var(--foreground)]"><X size={14} aria-hidden="true" /></button>
        </p>
        {own
          ? <TitleField key={`${ref}-${item.title}`} value={item.title} busy={false} onSave={(text) => void items.patch(item, { text }).then(after)} />
          : <h3 className="heading-elegant text-lg leading-tight">{item.title}</h3>}
        {subs.total > 0 && subs.done === subs.total && item.status === "open" && (
          <p role="status" className="flex flex-wrap items-center gap-2 border border-[var(--accent)] bg-[var(--accent-light)] px-2.5 py-1.5 text-small">
            <span className="flex-1">All sub-tasks are done.</span>
            <button type="button" onClick={() => void save({ status: "done" })} className={`${action} min-h-7 border-[var(--accent)] text-[var(--accent)]`}>Mark item done</button>
          </p>
        )}
        <Checklist key={`${ref}-subs`} label="Sub-tasks" title="Sub-tasks" items={item.checklist} placeholder="Add a sub-task, Enter"
          onToggle={(line, done) => save({ checklist: lines(item.checklist.map((l) => (l.id === line.id ? { ...l, done } : l))) })}
          onChange={(list) => save({ checklist: lines(list) })} />
        <label><span className={label}>Notes</span>
          <NotesField key={`${ref}-notes-${item.description}`} value={item.description} busy={false} rows={3} placeholder="Agenda, decisions, links. #tags you type here become tags."
            onSave={(description) => void save({ description })} />
        </label>
      </div>
      <div className="grid content-start gap-3 text-small">
        <div>
          <span className={label}>Status</span>
          <Segments value={item.status} options={STATUSES} label="Status" onChange={(status) => void save({ status })} />
        </div>
        <div>
          <span className={label}>When</span>
          {own ? (
            <div className="grid gap-1.5">
              <input type="date" value={day} aria-label="Day" onChange={(e) => { const to = e.target.value; if (to && to !== day) { onMoved?.(to); void items.move(item, day, to).then(after); } }}
                className="mono min-h-7 w-fit border border-[var(--rule)] bg-[var(--surface)] px-1.5" />
              <div className="flex flex-wrap items-center gap-2">
                <Segments value={timed ? "timed" : "all"} label="When" options={[{ value: "all", label: "All day" }, { value: "timed", label: "Timed" }]}
                  onChange={(v) => void (v === "all" ? items.patch(item, { start_min: null, end_min: null }) : items.patch(item, { day, start_min: 9 * 60, end_min: 10 * 60 })).then(after)} />
                {timed && <TimeRange key={`${ref}-${item.start_min}-${item.end_min}`} start={item.start_min as number} end={item.end_min as number} onSave={(s, e) => void items.patch(item, { day, start_min: s, end_min: e }).then(after)} />}
              </div>
            </div>
          ) : (
            <p data-locked="">{timed ? `${formatMinutes(item.start_min as number)}–${formatMinutes(item.end_min as number)}` : "All day"} <span className="text-[var(--muted-foreground)]">· from the {item.calendar ?? "outside"} calendar</span></p>
          )}
        </div>
        <div>
          <span className={label}>Weight</span>
          <Segments value={item.weight} label="Weight 0 to 3" onChange={(weight) => void save({ weight })}
            options={[0, 1, 2, 3].map((n) => ({ value: n, label: n ? "•".repeat(n) : "–", aria: `Weight ${n}` }))} />
        </div>
        {streams.length > 0 && (
          <div>
            <span className={label}>Stream</span>
            <Pick value={item.stream ?? ""} options={options} label="Stream of this item" onChange={(v) => void save({ stream: v || null })} />
          </div>
        )}
        <div>
          <span className={label}>Tags</span>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Tags">
            {tags.map((t) => (
              <span key={t} data-tag={t} className="mono inline-flex items-center border border-[var(--rule)] text-[var(--muted-foreground)]">
                <span className="px-1.5 py-0.5">#{t}</span>
                <button type="button" aria-label={`Remove tag ${t}`} onClick={() => void save({ products: tags.filter((x) => x !== t) })} className="px-1.5 py-0.5 hover:text-[var(--destructive)]">×</button>
              </span>
            ))}
            <input value={newTag} placeholder="+ tag" aria-label="Add a tag" maxLength={30} onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
              className="mono w-24 border-0 border-b border-[var(--rule)] bg-transparent py-0.5 outline-none focus:border-[var(--accent)]" />
          </div>
        </div>
        {!own && item.location && item.location !== item.meeting_url && <p className="text-[var(--muted-foreground)]">{item.location}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={pinned} onClick={onPin} className={`${action} ${pinned ? "text-[var(--accent)]" : ""}`}><Star size={12} aria-hidden="true" className={pinned ? "fill-[var(--accent)]" : ""} />{pinned ? "Important" : "Mark important"}</button>
          {item.meeting_url && <a href={item.meeting_url} target="_blank" rel="noopener noreferrer" className={`${action} text-[var(--accent)]`}>Join {meetingName(item.meeting_url)}</a>}
          {own && (
            <button type="button" onClick={() => (asked ? (onClose(), void items.remove(item).then(after)) : setAsked(true))} onBlur={() => setAsked(false)}
              className={`${action} border-[var(--destructive)] text-[var(--destructive)]`}>{asked ? "Confirm delete" : "Delete"}</button>
          )}
        </div>
        {!own && <p className="text-xs text-[var(--muted-foreground)]">The {item.calendar ?? "outside"} calendar stays read-only. Status, weight, stream, tags, sub-tasks and notes are kept in Niyyah against this event.</p>}
        {items.problem && <p role="alert" className="text-xs text-[var(--destructive)]">{items.problem}</p>}
      </div>
    </section>
  );
}
