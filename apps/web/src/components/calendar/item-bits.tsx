"use client";

import { AlignLeft } from "lucide-react";
import { meetingName } from "@/components/routine/calendar-parts";
import { CalDay, itemState, STATE_CLASS, sourceOf, timedItems } from "@/lib/calendar";
import { isTimed, itemRef, subtaskStat } from "@/lib/items";
import { formatMinutes } from "@/lib/routine";
import { useTrayDrag } from "@/lib/tray-drag";
import type { ItemData } from "@/lib/vault-types";

/** What every view needs to draw and act on items. */
export interface ItemHandlers {
  /** itemRef of the item whose card is open. */
  picked: string | null;
  onPick: (item: ItemData) => void;
  /** Done / open, for own items and calendar events alike. */
  onToggle: (item: ItemData) => void;
  /** Faded back by the tag filter. */
  dimmed: (item: ItemData) => boolean;
  /** An item's colour: its stream's for own items, its calendar's for events. */
  colourOf: (item: ItemData) => string;
}

export const MICRO = "text-micro font-semibold uppercase tracking-[0.09em] text-[var(--muted-foreground)]";

/** The attributes every drawn item carries: what tests and the tag filter find it by. */
export const itemAttrs = (item: ItemData, h: ItemHandlers) => ({
  "data-cal-item": itemRef(item),
  "data-dimmed": h.dimmed(item) ? "true" : undefined,
  "data-state": item.status,
});

export const whenOf = (i: ItemData) => (isTimed(i) ? `${formatMinutes(i.start_min as number)}–${formatMinutes(i.end_min as number)}` : "All day");
export const labelOf = (i: ItemData) => `${i.title}, ${whenOf(i)}${i.status !== "open" ? `, ${i.status}` : ""}`;

/** The number a timed item carries in rings and lists (1 = first to start). */
export function numbers(cd: CalDay): Map<string, number> {
  return new Map(timedItems(cd.items).map((i, n) => [itemRef(i), n + 1]));
}

/** A small square: empty when open, filled with a tick when done, struck through when skipped. */
export function StatusBox({ status }: { status: ItemData["status"] }) {
  return (
    <span aria-hidden="true" className={`relative grid h-3 w-3 shrink-0 place-items-center border ${status === "done" ? "border-[var(--foreground)] bg-[var(--foreground)]" : status === "skipped" ? "border-[var(--muted-foreground)]" : "border-[var(--foreground)]"}`}>
      {status === "done" && <svg viewBox="0 0 10 10" className="h-2.5 w-2.5"><path d="M2 5.2 4.2 7.3 8 2.8" fill="none" stroke="var(--background)" strokeWidth="1.6" /></svg>}
      {status === "skipped" && <span className="absolute inset-x-0.5 top-1/2 border-t border-[var(--muted-foreground)]" />}
    </span>
  );
}

/** The done toggle in front of an item. */
export function Toggle({ item, h, className = "" }: { item: ItemData; h: ItemHandlers; className?: string }) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); h.onToggle(item); }} aria-pressed={item.done} aria-label={`${item.done ? "Not done" : "Done"}: ${item.title}`}
      className={`grid h-6 w-6 shrink-0 place-items-center ${className}`}><StatusBox status={item.status} /></button>
  );
}

/** Notes, sub-task progress and the first tags, after a title. */
export function Meta({ item, tags = 2 }: { item: ItemData; tags?: number }) {
  const subs = subtaskStat(item.checklist);
  return (
    <>
      {item.description && <AlignLeft size={11} aria-label="Has notes" className="shrink-0 text-[var(--muted-foreground)]" />}
      {subs.total > 0 && <span className="shrink-0 font-mono text-micro tabular-nums text-[var(--muted-foreground)]" aria-label={`${subs.done} of ${subs.total} sub-tasks done`}>{subs.done}/{subs.total}</span>}
      {item.products.slice(0, tags).map((t) => <span key={t} className="shrink-0 font-mono text-micro text-[var(--muted-foreground)]">#{t}</span>)}
    </>
  );
}

/** One all-day item as a chip: toggle, title (opens the card), progress and tags. */
export function ItemChip({ item, cd, h }: { item: ItemData; cd: CalDay; h: ItemHandlers }) {
  const ref = itemRef(item);
  return (
    <span {...itemAttrs(item, h)} className={`inline-flex min-h-7 max-w-full items-center gap-1 border border-l-4 border-[var(--rule)] bg-[var(--surface)] pr-2 text-xs ${STATE_CLASS[itemState(item, cd)]} ${h.picked === ref ? "outline outline-2 outline-[var(--accent)]" : ""}`}
      style={{ borderLeftColor: h.colourOf(item) }}>
      <Toggle item={item} h={h} />
      <button type="button" onClick={() => h.onPick(item)} aria-pressed={h.picked === ref} aria-label={`Details: ${labelOf(item)}`} className="min-w-0 truncate text-left font-medium" data-title="">{item.title}</button>
      <Meta item={item} />
    </span>
  );
}

/** The All day strip of a day view: items with no time. */
export function AllDayStrip({ cd, h, onDropTray }: { cd: CalDay; h: ItemHandlers; onDropTray?: () => void }) {
  const list = cd.items.filter((i) => !isTimed(i));
  const tray = useTrayDrag();
  return (
    <div data-allday-strip={cd.iso} role="group" aria-label="All day" className={`flex min-h-11 flex-wrap items-center gap-1.5 border-y border-[var(--border)] py-2 ${tray && onDropTray ? "bg-[var(--accent-light)]" : ""}`}
      onDragOver={(e) => { if (tray && onDropTray) e.preventDefault(); }} onDrop={(e) => { if (onDropTray) { e.preventDefault(); onDropTray(); } }}>
      <span className={`${MICRO} mr-1`}>All day</span>
      {list.length ? list.map((i) => <ItemChip key={itemRef(i)} item={i} cd={cd} h={h} />) : <span className="text-xs text-[var(--muted-foreground)]">Nothing all day.</span>}
    </div>
  );
}

/** A number badge, as on the ring and ribbon. */
export function Badge({ n, live }: { n: number; live?: boolean }) {
  return <span aria-hidden="true" className={`grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-[var(--foreground)] px-1 font-mono text-[10px] font-bold text-[var(--background)] ${live ? "ring-2 ring-[var(--accent)] ring-offset-1 ring-offset-[var(--surface)]" : ""}`}>{n}</span>;
}

/** One item as a list row (agendas): toggle, number, time, title, its calendar, meta and a join link. */
export function ItemRow({ item, cd, h, n }: { item: ItemData; cd: CalDay; h: ItemHandlers; n?: number }) {
  const ref = itemRef(item);
  const state = itemState(item, cd);
  return (
    <div {...itemAttrs(item, h)} className={`flex min-h-8 items-center gap-2 border-t border-dashed border-[var(--border)] pl-0.5 text-small ${STATE_CLASS[state]} ${h.picked === ref ? "bg-[var(--accent-light)]" : ""}`}>
      <Toggle item={item} h={h} />
      {n !== undefined && <Badge n={n} live={state === "live"} />}
      <span className="shrink-0 font-mono text-micro tabular-nums text-[var(--muted-foreground)]">{whenOf(item)}</span>
      <button type="button" onClick={() => h.onPick(item)} aria-pressed={h.picked === ref} aria-label={`Details: ${labelOf(item)}`} className="flex min-w-0 flex-1 items-baseline gap-1.5 text-left">
        <span className="truncate font-medium" data-title="">{item.title}</span>
        <span className="shrink-0 text-xs text-[var(--muted-foreground)]">{item.kind === "task" ? "yours" : sourceOf(item)}</span>
      </button>
      <span className="hidden items-center gap-1.5 sm:inline-flex"><Meta item={item} /></span>
      {item.meeting_url && <a href={item.meeting_url} target="_blank" rel="noopener noreferrer" className="shrink-0 border border-[var(--border)] px-2 text-xs font-semibold leading-[22px] text-[var(--accent)] hover:bg-[var(--muted)]">Join {meetingName(item.meeting_url)}</a>}
    </div>
  );
}

/** The numbered list under a ring or ribbon: one row per timed item. */
export function Legend({ cd, h }: { cd: CalDay; h: ItemHandlers }) {
  const timed = timedItems(cd.items);
  if (!timed.length) return <p className="mt-2 text-xs text-[var(--muted-foreground)]">No timed items.</p>;
  return (
    <div className="mt-2 grid gap-x-5 sm:grid-cols-2" aria-label="Timed items" role="group">
      {timed.map((i, n) => <ItemRow key={itemRef(i)} item={i} cd={cd} h={h} n={n + 1} />)}
    </div>
  );
}
