"use client";

import { AlignLeft, ChevronDown, ListChecks, Plus, Star } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useItems } from "@/hooks/use-items";
import { isTimed, itemRef, subtaskStat } from "@/lib/items";
import { formatMinutes } from "@/lib/routine";
import { StreamMeta } from "@/lib/streams";
import { vaultApi } from "@/lib/vault-api";
import { GoogleStatusData, ItemData } from "@/lib/vault-types";
import { addDays, fmtDay, sundayOf, weekDays } from "@/lib/week";
import { ItemCard } from "@/components/routine/item-card";
import { AddEventForm } from "@/components/routine/calendar-parts";

/** The grid shows the whole day. One hour is as tall as fits the window (HOUR_PX before it is measured, never under MIN_HOUR_PX or over MAX_HOUR_PX; SLEEP_PX when it is a collapsed sleep hour); events snap to SNAP minutes when moved or drawn. */
const HOUR_PX = 48;
const MIN_HOUR_PX = 24;
const MAX_HOUR_PX = 96;
const SLEEP_PX = 5;
/** Space left under the grid, and the sticky day header above the all-day row. */
const BOTTOM_GAP = 16;
const HEADER_PX = 34;
/** Width of a day's all-day list when it opens under its cell. */
const LIST_PX = 272;
const SNAP = 15;
const MICRO = "text-micro font-medium text-[var(--muted-foreground)]";

/** A day's calendar events and own items (tasks), each list all day first, then by start. */
export interface DayData { events: ItemData[]; tasks: ItemData[]; }
/** A block's stretch of a day column, with its colour and whether it is sleep (greyed and hatched: keep clear). */
export interface WeekBand { block: string; name: string; from: number; to: number; colour: string; sleep: boolean; }
/** A prayer's place in a day column. */
export interface WeekPrayer { name: string; label: string; min: number; }

/** Vertical positions for a day column. `collapsed[h]` squeezes hour h to a thin strip. */
function makeScale(collapsed: boolean[], hourPx: number) {
  const heights = collapsed.map((c) => (c ? SLEEP_PX : hourPx));
  const tops = heights.map((_, h) => heights.slice(0, h).reduce((a, b) => a + b, 0));
  const total = heights.reduce((a, b) => a + b, 0);
  return {
    heights, tops, total,
    px: (min: number) => { const h = Math.min(23, Math.floor(min / 60)); return tops[h] + ((min - h * 60) / 60) * heights[h]; },
    minuteAt: (y: number) => {
      const clamped = Math.max(0, Math.min(total, y));
      const found = tops.findIndex((t, i) => clamped < t + heights[i]);
      const h = found < 0 ? 23 : found;
      return Math.min(1440, h * 60 + ((clamped - tops[h]) / heights[h]) * 60);
    },
  };
}
const snap = (min: number) => Math.round(min / SNAP) * SNAP;
const pad2 = (n: number) => String(n).padStart(2, "0");
const hhmm = (min: number) => formatMinutes(Math.min(1439, Math.max(0, min)));

/** What a pin is stored under: a Google event by its id, any other event by title, day and start, a task by day and text (as before items). */
const eventPin = (day: string, e: ItemData) => `e:${e.event_id ?? `${e.title}|${day}|${e.start_min ?? "all"}`}`;
const taskPin = (day: string, t: ItemData) => `t:${day}|${t.title}`;
export const pinOf = (i: ItemData) => (i.kind === "task" ? taskPin(i.day as string, i) : eventPin(i.day as string, i));

/** The week Sunday to Saturday around `today`, its items per day (one read of /vault/items), the picked item and the paging that changes it. */
export function useWeek(today: string | null, refreshKey: number) {
  const [start, setStart] = useState<string | null>(null);
  const [pins, setPins] = useState<string[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const first = start ?? (today ? sundayOf(today) : null);
  const thisWeek = today ? sundayOf(today) : null;
  const days = useMemo(() => (first ? weekDays(`${first}/${addDays(first, 6)}`) : []), [first]);
  const items = useItems(days, refreshKey);
  const { byDay } = items;
  const data = useMemo(() => Object.fromEntries(days.map((day) => {
    const list = byDay[day] ?? [];
    return [day, { events: list.filter((i) => i.kind === "event"), tasks: list.filter((i) => i.kind === "task") }];
  })) as Record<string, DayData>, [days, byDay]);
  /** The picked item, found again in what is shown now (an edit replaces it). */
  const selected = picked ? days.flatMap((d) => byDay[d] ?? []).find((i) => itemRef(i) === picked) ?? null : null;

  useEffect(() => {
    let live = true;
    vaultApi.pins().then((p) => live && setPins(p)).catch(() => {});
    return () => { live = false; };
  }, []);

  return {
    days, data, items, errors: items.errors, today, picked, setPicked, selected, showDone, setShowDone, isThisWeek: first === thisWeek, pins, setPins,
    /** Mark an event or task important (or clear it); shows at once and settles on what the server says. */
    togglePin: (key: string) => {
      const pinned = !pins.includes(key);
      setPins(pinned ? [...pins, key] : pins.filter((k) => k !== key));
      vaultApi.setPin(key, pinned).then(setPins).catch(() => setPins(pins));
    },
    go: (n: number) => { setPicked(null); setStart(addDays(first as string, 7 * n)); },
    goToday: () => { setPicked(null); setStart(null); },
    /** Show the week that holds `iso` (the picked item stays when it is already this week). */
    show: (iso: string) => { if (sundayOf(iso) === first) return; setPicked(null); setStart(sundayOf(iso) === thisWeek ? null : sundayOf(iso)); },
    /** Read the week's items again, in the background. */
    reload: items.refetch,
  };
}
export type Week = ReturnType<typeof useWeek>;

const STREAM_SELECT = "min-h-6 min-w-0 max-w-[45%] border border-[var(--border)] bg-[var(--background)] px-0.5 text-micro text-[var(--muted-foreground)]";

/** The stream choice for a task: "No stream" or one of the quarter's streams. */
function StreamSelect({ value, streams, onChange, label }: { value: string | null; streams: StreamMeta[]; onChange: (stream: string | null) => void; label: string }) {
  return (
    <select value={value ?? ""} aria-label={label} title="Stream" onChange={(e) => onChange(e.target.value || null)} className={STREAM_SELECT}>
      <option value="">No stream</option>
      {streams.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
    </select>
  );
}

/** A new task: text plus the stream it belongs to. Enter adds, Esc cancels; leaving the whole row adds what was typed. */
function AddTask({ day, streams, onDone }: { day: string; streams: StreamMeta[]; onDone: (text: string | null, stream: string | null) => void }) {
  const [text, setText] = useState("");
  const [stream, setStream] = useState<string | null>(null);
  const finished = useRef(false);
  const finish = (value: string | null) => { if (!finished.current) { finished.current = true; onDone(value, stream); } };
  return (
    <div className="flex items-center gap-0.5" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) finish(text.trim() || null); }}>
      <input autoFocus value={text} maxLength={300} placeholder="New task" aria-label={`New task for ${day}`} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) finish(text.trim()); if (e.key === "Escape") finish(null); }}
        className="min-h-6 w-full min-w-0 flex-1 border border-[var(--accent)] bg-[var(--background)] px-1 text-xs placeholder:text-[var(--muted-foreground)]" />
      {streams.length > 0 && <StreamSelect value={stream} streams={streams} onChange={setStream} label="Stream for the new task" />}
    </div>
  );
}

interface Placed { item: ItemData; key: string; lane: number; lanes: number; }

/** Side-by-side lanes for timed items (events and own items) that overlap, so none hides another. */
function place(items: ItemData[]): Placed[] {
  const timed = items.filter(isTimed).map((item) => ({ item, key: itemRef(item) }))
    .sort((a, b) => (a.item.start_min as number) - (b.item.start_min as number));
  const out: Placed[] = [];
  let group: Placed[] = [];
  let groupEnd = -1;
  const flush = () => { const lanes = Math.max(0, ...group.map((g) => g.lane)) + 1; out.push(...group.map((g) => ({ ...g, lanes }))); group = []; };
  for (const e of timed) {
    if (group.length && (e.item.start_min as number) >= groupEnd) { flush(); groupEnd = -1; }
    const taken = new Set(group.filter((g) => (g.item.end_min as number) > (e.item.start_min as number)).map((g) => g.lane));
    let lane = 0;
    while (taken.has(lane)) lane++;
    group.push({ ...e, lane, lanes: 1 });
    groupEnd = Math.max(groupEnd, e.item.end_min as number);
  }
  flush();
  return out;
}

/** Small marks on an item: it has notes, its sub-task progress, its weight. */
function Marks({ item }: { item: ItemData }) {
  const subs = subtaskStat(item.checklist);
  if (!item.description && !subs.total && !item.weight) return null;
  return (
    <span className="ml-auto inline-flex shrink-0 items-center gap-1 font-mono text-micro tabular-nums text-[var(--muted-foreground)] no-underline">
      {item.description && <AlignLeft size={10} aria-label="Has notes" data-mark="notes" />}
      {subs.total > 0 && <span data-mark="subtasks" aria-label={`${subs.done} of ${subs.total} sub-tasks done`} className="inline-flex items-center gap-0.5"><ListChecks size={10} aria-hidden="true" />{subs.done}/{subs.total}</span>}
      {item.weight > 0 && <span data-mark="weight" aria-label={`Weight ${item.weight}`} className="tracking-[-0.1em] text-[var(--accent)]">{"•".repeat(item.weight)}</span>}
    </span>
  );
}

/** A drag in progress: a calendar event (moved through Google by `eventId`) or an own item. */
interface Drag { item: ItemData; day: string; allDay: boolean; duration: number; grab: number; }
interface Draw { day: string; from: number; to: number; }

/** The week as a 24-hour grid: drag an item to move it (an own item between the all-day row and the grid too), drag across an empty slot to draw a new event. Each day shows its blocks as faint bands (sleep greyed and hatched) and its five prayers as hairlines. */
export function WeekCalendar({ week, streams, nowMin, status, bandsFor, prayersFor, onChanged, onEventsChanged, onOpenDay, card = true, dimmed, layoutKey }: {
  week: Week; streams: StreamMeta[]; nowMin: number; status: GoogleStatusData | null; bandsFor: (day: string) => WeekBand[]; prayersFor: (day: string) => WeekPrayer[]; onChanged: () => void; onEventsChanged: () => void;
  /** Show the picked item's details card above the grid (off when the page shows it elsewhere). */
  card?: boolean;
  /** A day header was clicked: show that day. */
  onOpenDay?: (day: string) => void;
  /** Items to fade back (a tag filter that does not match them). */
  dimmed?: (item: ItemData) => boolean;
  /** Changes when something above the grid moves (the bar going into the header), so the grid fits the window again. */
  layoutKey?: string;
}) {
  const { days, data, today, items } = week;
  const { picked, setPicked } = week;
  const [draft, setDraft] = useState<{ day: string; start: string; end?: string } | null>(null);
  const [draw, setDraw] = useState<Draw | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** The day whose all-day list is open under its cell, where it sits (fixed, so the scroller does not clip it), and whether a drag from it is under way. */
  const [listDay, setListDay] = useState<string | null>(null);
  const [listPos, setListPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const [listHidden, setListHidden] = useState(false);
  const cells = useRef<Record<string, HTMLDivElement | null>>({});
  const drag = useRef<Drag | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const all = (day: string) => [...(data[day]?.events ?? []), ...(data[day]?.tasks ?? [])];

  // An hour collapses when every day of the week is asleep for all of it and no timed item touches it.
  const collapsible = Array.from({ length: 24 }, (_, h) => days.length > 0 && days.every((day) =>
    bandsFor(day).some((b) => b.sleep && b.from <= h * 60 && b.to >= (h + 1) * 60)
    && !all(day).some((e) => isTimed(e) && (e.start_min as number) < (h + 1) * 60 && (e.end_min as number) > h * 60)));
  const collapsedCount = collapsible.filter(Boolean).length;

  // Fit the window: the scroller fills the space below its top edge, and an hour is whatever height lets all 24 (less collapsed sleep) fit under the sticky header and all-day row. Too small a window scrolls instead.
  const [box, setBox] = useState<{ height: number; hour: number } | null>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const fit = () => {
      const height = Math.max(320, Math.floor(window.innerHeight - el.getBoundingClientRect().top - BOTTOM_GAP));
      const allDay = el.querySelector<HTMLElement>("[data-allday]")?.offsetHeight ?? 0;
      const open = 24 - collapsedCount;
      const hour = Math.max(MIN_HOUR_PX, Math.min(MAX_HOUR_PX, Math.floor((height - 2 - HEADER_PX - allDay - collapsedCount * SLEEP_PX) / Math.max(1, open))));
      setBox((b) => (b && b.height === height && b.hour === hour ? b : { height, hour }));
    };
    fit();
    window.addEventListener("resize", fit);
    // The page above the grid can change height without a window resize (the bar moving into the header, the sidebar stacking).
    const observer = new ResizeObserver(fit);
    observer.observe(document.body);
    return () => { window.removeEventListener("resize", fit); observer.disconnect(); };
  }, [collapsedCount, data, adding, week.picked, problem, dragging, week.showDone, layoutKey]);

  // The open list follows its cell (window or grid scroll, resize) and flips to end at the cell's right edge near the window's edge.
  const openDay = adding ?? listDay;
  useLayoutEffect(() => {
    if (!openDay) return;
    const place = () => {
      const r = cells.current[openDay]?.getBoundingClientRect();
      if (!r) return;
      const width = Math.max(r.width, LIST_PX);
      const left = r.left + width > window.innerWidth - 8 ? Math.max(8, r.right - width) : r.left;
      setListPos({ top: r.bottom, left, width, maxHeight: Math.max(120, Math.min(320, window.innerHeight - r.bottom - 8)) });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [openDay]);
  // Esc or a press outside the open cell closes the list (an add in progress closes itself on blur, see AddTask).
  useEffect(() => {
    if (!listDay) return;
    const away = (e: MouseEvent) => { if (!cells.current[listDay]?.contains(e.target as Node)) setListDay(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setListDay(null); } };
    document.addEventListener("mousedown", away);
    // On window, capture phase: ahead of the page hotkeys (document, capture), whose Escape clears the picked item instead.
    window.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("mousedown", away); window.removeEventListener("keydown", esc, true); };
  }, [listDay]);
  const hourPx = box?.hour ?? HOUR_PX;
  const { px, minuteAt: scaleMinuteAt, heights, tops, total: GRID_PX } = makeScale(collapsible, hourPx);

  // Start scrolled to about three hours before now.
  const scrolled = useRef(false);
  useEffect(() => {
    if (!days.length || !box || !scroller.current || scrolled.current) return;
    scrolled.current = true;
    scroller.current.scrollTop = Math.max(0, px(nowMin) - 3 * hourPx);
  }, [days.length, box, nowMin, px, hourPx]);

  const refresh = useCallback(() => { week.reload(); onChanged(); onEventsChanged(); }, [week, onChanged, onEventsChanged]);

  /** A Google event change: run it, then read the calendar again (slow, in the background). */
  async function changeEvent(action: () => Promise<unknown>) {
    setProblem(null);
    try { await action(); } catch (err) { setProblem(err instanceof Error ? err.message : "Could not save"); }
    refresh();
  }
  /** An own item change: it shows at once (see useItems); the planner reads tasks too, so it reloads after. */
  const changeTask = (work: Promise<boolean>) => void work.then((ok) => { if (ok) onChanged(); });

  const streamOf = (t: ItemData) => streams.find((s) => s.id === t.stream);
  const isPinned = (key: string) => week.pins.includes(key);
  const pick = (i: ItemData) => { const ref = itemRef(i); setPicked(picked === ref ? null : ref); setDraft(null); };
  const pinnedItems = days.flatMap((day) => [
    ...(data[day]?.events ?? []).map((e) => ({ key: eventPin(day, e), label: e.title, when: `${fmtDay(day, { weekday: "short" })} ${isTimed(e) ? formatMinutes(e.start_min as number) : ""}`.trim(), pick: itemRef(e), over: !!today && (day < today || (day === today && isTimed(e) && (e.end_min as number) < nowMin)) })),
    ...(data[day]?.tasks ?? []).filter((t) => !t.done).map((t) => ({ key: taskPin(day, t), label: t.title, when: `${fmtDay(day, { weekday: "short" })} ${isTimed(t) ? formatMinutes(t.start_min as number) : "task"}`, pick: itemRef(t), over: !!today && day < today })),
  ]).filter((p) => isPinned(p.key) && !p.over);
  const minuteAt = (el: HTMLElement, clientY: number) => scaleMinuteAt(clientY - el.getBoundingClientRect().top);

  const whenText = (e: ItemData) => (isTimed(e) ? `${formatMinutes(e.start_min as number)}–${formatMinutes(e.end_min as number)}` : "All day");
  const eventTip = (day: string, e: ItemData, hint: string) => [`${isPinned(eventPin(day, e)) ? "★ " : ""}${e.title}`, whenText(e), `${e.calendar}${e.location ? ` · ${e.location}` : ""}`, hint].join("\n");
  const canDrag = (i: ItemData) => i.kind === "task" || !!i.event_id;

  function startDrag(e: React.DragEvent, item: ItemData, day: string) {
    if (!canDrag(item)) return;
    const timed = isTimed(item);
    const rect = e.currentTarget.getBoundingClientRect();
    drag.current = { item, day, allDay: !timed, duration: timed ? (item.end_min as number) - (item.start_min as number) : 0,
      grab: timed ? scaleMinuteAt(e.clientY - rect.top + px(item.start_min as number)) - (item.start_min as number) : 0 };
    e.dataTransfer.effectAllowed = "move";
    setDragging(true);
    e.dataTransfer.setData("text/plain", item.title);
    // Dragging out of an open all-day list: hide it a tick later so the grid shows, but keep the source mounted (removing it aborts the drag).
    if (listDay) setTimeout(() => setListHidden(true), 0);
  }
  const endDrag = useCallback(() => { drag.current = null; setOver(null); setDragging(false); setListHidden(false); setListDay(null); }, []);
  // A drag that ends on a row which re-rendered away never gets its own dragend; the window still does.
  useEffect(() => {
    window.addEventListener("dragend", endDrag);
    return () => window.removeEventListener("dragend", endDrag);
  }, [endDrag]);
  /** Own items go anywhere; a calendar event keeps its kind (timed stays timed, all day stays all day). */
  const accepts = (allDayRow: boolean, d: Drag | null = drag.current): d is Drag => !!d && (d.item.kind === "task" || d.allDay === allDayRow);

  function dropTimed(e: React.DragEvent<HTMLDivElement>, day: string) {
    e.preventDefault();
    const d = drag.current;
    endDrag();
    if (!accepts(false, d)) return;
    const duration = d.duration || 60;
    const start = Math.min(1440 - duration, Math.max(0, snap(minuteAt(e.currentTarget, e.clientY) - d.grab)));
    if (d.item.kind === "task") return changeTask(items.patch(d.item, { day, start_min: start, end_min: start + duration }));
    void changeEvent(() => vaultApi.moveEvent(d.item.event_id as string, { day, start: hhmm(start), end: hhmm(start + duration) }));
  }

  function dropAllDay(e: React.DragEvent, day: string) {
    e.preventDefault();
    const d = drag.current;
    endDrag();
    if (!accepts(true, d)) return;
    if (d.item.kind === "event") { if (d.day !== day) void changeEvent(() => vaultApi.moveEvent(d.item.event_id as string, { day })); return; }
    const task = d.item;
    if (!d.allDay && d.day === day) return changeTask(items.patch(task, { start_min: null, end_min: null }));
    if (d.day === day) return;
    const from = taskPin(d.day, task);
    const was = isPinned(from);
    changeTask((async () => {
      const ok = await items.move(task, d.day, day);
      if (ok && !d.allDay) await items.patch({ ...task, day }, { start_min: null, end_min: null });
      if (ok && was) await vaultApi.setPin(from, false).then(() => vaultApi.setPin(taskPin(day, task), true)).then(week.setPins).catch(() => {});
      return ok;
    })());
  }

  /** Press on an empty slot and drag to draw an event; a plain click draws one hour. */
  function startDraw(e: React.PointerEvent<HTMLDivElement>, day: string) {
    if (e.target !== e.currentTarget || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const at = snap(minuteAt(e.currentTarget, e.clientY));
    setPicked(null);
    setDraft(null);
    setDraw({ day, from: at, to: at });
  }

  function moveDraw(e: React.PointerEvent<HTMLDivElement>) {
    if (draw) setDraw({ ...draw, to: snap(minuteAt(e.currentTarget, e.clientY)) });
  }

  function endDraw() {
    if (!draw) return;
    let from = Math.min(draw.from, draw.to);
    let to = Math.max(draw.from, draw.to);
    if (to - from < SNAP) to = from + 60;
    if (to > 1440) { to = 1440; from = Math.min(from, 1440 - SNAP); }
    setDraft({ day: draw.day, start: hhmm(from), end: hhmm(to === 1440 ? 1439 : to) });
    setDraw(null);
  }

  if (!days.length) return null;
  const connected = !!status?.connected;
  const sel = week.selected;
  // The All day strip takes no height while no day has anything in it; it opens for a drag (to drop an item into it) or an add.
  const hasAllDay = days.some((day) => (data[day]?.events ?? []).some((e) => !isTimed(e)) || (data[day]?.tasks ?? []).some((t) => !isTimed(t) && (week.showDone || !t.done)));
  const stripOpen = hasAllDay || dragging || adding !== null;
  const strip = stripOpen ? "" : "!h-0 !min-h-0 !max-h-0 overflow-hidden !border-b-0 !p-0";
  const tick = (t: ItemData) => changeTask(items.patch(t, { status: t.done ? "open" : "done" }));
  const finished = (t: ItemData) => t.status !== "open";
  const dim = (i: ItemData) => ({ "data-dimmed": dimmed?.(i) ? "true" : undefined });

  /** One all-day event: inline in its cell (one line) or in the day's list. */
  const eventRow = (day: string, e: ItemData, inline: boolean) => {
    const ref = itemRef(e);
    return (
      <div key={ref} role="button" tabIndex={0} data-item={ref} draggable={!!e.event_id} onDragStart={(ev) => startDrag(ev, e, day)} onDragEnd={endDrag}
        onClick={() => pick(e)} onKeyDown={(k) => k.key === "Enter" && pick(e)} title={eventTip(day, e, e.event_id ? "Drag to another day to move" : "Read-only calendar")} aria-pressed={picked === ref} data-dimmed={dim(e)["data-dimmed"]}
        className={`flex min-w-0 items-center gap-1 border-l-2 bg-[var(--muted)] px-1.5 text-xs font-medium ${inline ? "h-6" : "min-h-6"} ${e.event_id ? "cursor-grab" : "cursor-pointer"} ${picked === ref ? "outline outline-1 outline-[var(--foreground)]" : ""} ${finished(e) ? "text-[var(--muted-foreground)] line-through" : ""}`} style={{ borderColor: e.color ?? "var(--muted-foreground)" }}>
        {isPinned(eventPin(day, e)) && <Star size={10} aria-label="Important" className="shrink-0 fill-[var(--accent)] text-[var(--accent)]" />}
        <span className="truncate">{e.title}</span>
        <Marks item={e} />
      </div>
    );
  };
  /** One own all-day task (tick, stream, title, pin): inline in its cell (one line) or in the day's list (up to two lines). */
  const taskRow = (day: string, t: ItemData, inline: boolean) => {
    const ref = itemRef(t);
    return (
      <div key={ref} data-item={ref} draggable onDragStart={(ev) => startDrag(ev, t, day)} onDragEnd={endDrag}
        title={`${t.title}${t.products.map((tag) => ` #${tag}`).join("")}${streamOf(t) ? ` · ${streamOf(t)?.label}` : ""}${isPinned(taskPin(day, t)) ? " (important)" : ""}\nClick for details · drag to another day or a time to move`}
        data-dimmed={dim(t)["data-dimmed"]}
        className={`group/task flex min-w-0 cursor-grab border border-dashed text-xs hover:bg-[var(--muted)] ${inline ? "h-6 items-center" : "items-start"} ${picked === ref ? "border-[var(--foreground)]" : "border-[var(--border)]"}`}>
        <button type="button" aria-label={`${t.done ? "Not done" : "Done"}: ${t.title}`} aria-pressed={t.done} onClick={() => tick(t)}
          className="grid h-5 w-5 shrink-0 place-items-center"><span className={`h-2.5 w-2.5 border border-[var(--muted-foreground)] ${t.done ? "bg-[var(--accent)]" : ""}`} /></button>
        {streamOf(t) && <span aria-hidden="true" className={`h-2 w-2 shrink-0 ${inline ? "" : "mt-1.5"}`} style={{ background: streamOf(t)?.color }} />}
        <button type="button" onClick={() => pick(t)} aria-pressed={picked === ref} className={`min-w-0 flex-1 break-words pr-1 text-left ${inline ? "truncate" : "line-clamp-2 py-1"} ${finished(t) ? "text-[var(--muted-foreground)] line-through" : ""}`}>
          {t.title}{t.products.map((tag) => <span key={tag} data-tag={tag} className="mono ml-1 text-[var(--muted-foreground)] no-underline">#{tag}</span>)}
        </button>
        <span className="self-center"><Marks item={t} /></span>
        <button type="button" aria-pressed={isPinned(taskPin(day, t))} aria-label={`Important: ${t.title}`} title="Mark important" onClick={() => week.togglePin(taskPin(day, t))}
          className={`grid h-4 w-4 shrink-0 place-items-center self-center ${isPinned(taskPin(day, t)) ? "" : "opacity-0 focus:opacity-100 group-hover/task:opacity-100"}`}>
          <Star size={11} className={isPinned(taskPin(day, t)) ? "fill-[var(--accent)] text-[var(--accent)]" : "text-[var(--muted-foreground)]"} />
        </button>
      </div>
    );
  };

  return (
    <div>
      {card && sel && (
        <ItemCard key={itemRef(sel)} item={sel} streams={streams} items={items} pinned={isPinned(pinOf(sel))}
          onPin={() => week.togglePin(pinOf(sel))} onClose={() => setPicked(null)} onChanged={onChanged}
          onMoved={(to) => setPicked(days.includes(to) ? itemRef({ ...sel, day: to }) : null)} />
      )}
      <div ref={scroller} className="overflow-auto border border-[var(--border)]" style={{ maxHeight: box ? box.height : "calc(100vh - 14rem)" }} role="grid" aria-label="Week schedule">
        <div className="grid min-w-[40rem]" style={{ gridTemplateColumns: `1.5rem ${days.map((d) => (d === today ? "minmax(0,2fr)" : "minmax(0,1fr)")).join(" ")}` }}>
          <div className="sticky top-0 z-20 h-[34px] border-b border-[var(--border)] bg-[var(--surface)]" />
          {days.map((day) => (
            <div key={day} className={`sticky top-0 z-20 flex h-[34px] items-baseline gap-1.5 border-b border-l border-[var(--border)] px-1.5 py-1.5 ${day === today ? "bg-[var(--accent-light)] shadow-[inset_0_-2px_0_var(--accent)]" : "bg-[var(--surface)]"}`}>
              {(() => {
                const head = (
                  <>
                    <span className={`${MICRO} ${day === today ? "!text-[var(--accent)]" : ""}`}>{fmtDay(day, { weekday: "short" })}</span>
                    <span className={`font-mono text-small font-medium tabular-nums ${day === today ? "text-[var(--accent)]" : ""}`}>{fmtDay(day, { day: "numeric" })}</span>
                  </>
                );
                return onOpenDay
                  ? <button type="button" data-open-day={day} onClick={() => onOpenDay(day)} aria-label={`Open ${fmtDay(day, { weekday: "long", day: "numeric", month: "long" })}`} className="flex items-baseline gap-1.5 hover:underline">{head}</button>
                  : head;
              })()}
            </div>
          ))}

          <div className={`sticky top-[34px] z-20 flex items-center border-b border-[var(--border)] bg-[var(--surface)] pl-0.5 text-[9px] font-semibold uppercase leading-[1.1] tracking-[0.06em] text-[var(--muted-foreground)] ${strip}`}><span>All<br />day</span></div>
          {days.map((day) => {
            const d = data[day];
            const evs = (d?.events ?? []).filter((e) => !isTimed(e));
            const tks = (d?.tasks ?? []).filter((t) => !isTimed(t) && (week.showDone || !t.done));
            const n = evs.length + tks.length;
            const done = tks.filter((t) => t.done).length;
            const open = openDay === day;
            const dayName = fmtDay(day, { weekday: "long", day: "numeric", month: "long" });
            const count = [tks.length - done && `${tks.length - done} task${tks.length - done === 1 ? "" : "s"}`, evs.length && `${evs.length} event${evs.length === 1 ? "" : "s"}`, done && `${done} done`].filter(Boolean).join(" · ");
            const rows = (inline: boolean) => [...evs.map((e) => eventRow(day, e, inline)), ...tks.map((t) => taskRow(day, t, inline))];
            return (
              <div key={day} ref={(el) => { cells.current[day] = el; }} data-day={day} data-allday="" data-count={n}
                onDragOver={(e) => { if (accepts(true)) { e.preventDefault(); setOver(`ad:${day}`); } }} onDragLeave={() => setOver(null)} onDrop={(e) => dropAllDay(e, day)}
                onClick={(e) => { if (e.target === e.currentTarget) setAdding(day); }}
                className={`${strip} group sticky top-[34px] ${open ? "z-[25]" : "z-20"} flex h-7 min-w-0 cursor-cell items-center gap-0.5 border-b border-l border-[var(--border)] px-0.5 ${over === `ad:${day}` ? "bg-[var(--accent-light)]" : "bg-[var(--surface)]"}`}>
                {n === 1 && <div className="min-w-0 flex-1">{rows(true)}</div>}
                {n >= 2 && (
                  <button type="button" data-allday-count={day} aria-expanded={listDay === day} aria-label={`${dayName}: ${count}`} onClick={() => setListDay(listDay === day ? null : day)}
                    className="flex h-6 min-w-0 flex-1 items-center justify-between gap-1 px-1 text-xs font-medium hover:bg-[var(--muted)]">
                    <span className="truncate">{count}</span><ChevronDown size={12} aria-hidden="true" className={`shrink-0 text-[var(--muted-foreground)] transition-transform ${listDay === day ? "rotate-180" : ""}`} />
                  </button>
                )}
                <button type="button" aria-label={`Add a task on ${dayName}`} title="Add a task for this day" onClick={() => { setListDay(null); setAdding(day); }}
                  className={`flex h-6 shrink-0 items-center gap-0.5 px-0.5 text-micro text-[var(--muted-foreground)] opacity-40 hover:opacity-100 focus:opacity-100 group-hover:opacity-100 ${n === 0 ? "" : "w-5 justify-center"}`}>
                  <Plus size={11} aria-hidden="true" />{n === 0 && "Task"}
                </button>
                {(n >= 2 || adding === day) && (
                  <div role="list" aria-label={`All day, ${dayName}`} data-allday-list={day}
                    style={open && listPos ? { top: listPos.top, left: listPos.left, maxHeight: listPos.maxHeight, width: listPos.width } : undefined}
                    className={`${open && listPos ? "grid" : "hidden"} fixed z-40 content-start gap-1 overflow-y-auto border border-[var(--border)] bg-[var(--surface)] p-1 shadow-[0_12px_30px_rgb(0_0_0/0.2)] ${listHidden ? "invisible pointer-events-none" : ""}`}>
                    {n >= 2 && rows(false)}
                    {adding === day && (
                      <AddTask key="add" day={day} streams={streams} onDone={(text, stream) => { setAdding(null); if (text) changeTask(items.create({ day, text, stream })); }} />
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <div className="relative" style={{ height: GRID_PX }}>
            {Array.from({ length: 24 }, (_, h) => h > 0 && heights[h] === hourPx && (
              <span key={h} className="absolute right-0.5 -translate-y-1.5 font-mono text-micro text-[var(--muted-foreground)]" style={{ top: tops[h] }}>{pad2(h)}</span>
            ))}
          </div>
          {days.map((day) => (
            <div key={day} role="gridcell" data-grid-day={day} aria-label={`${fmtDay(day, { weekday: "long", day: "numeric", month: "long" })}: drag on an empty slot to add an event`}
              className={`relative cursor-cell border-l border-[var(--border)] ${day === today ? "bg-[var(--accent-light)]" : ""}`}
              style={{ height: GRID_PX, touchAction: "pan-x pan-y" }}
              onPointerDown={(e) => startDraw(e, day)} onPointerMove={moveDraw} onPointerUp={endDraw} onPointerCancel={() => setDraw(null)}
              onDragOver={(e) => { if (accepts(false)) e.preventDefault(); }} onDrop={(e) => dropTimed(e, day)}>
              {tops.map((t, h) => <div key={h} aria-hidden="true" className="pointer-events-none absolute inset-x-0 border-t border-[var(--border)]" style={{ top: t }} />)}
              {bandsFor(day).map((b, i) => (
                <div key={`${b.block}-${i}`} aria-hidden="true" data-band={b.block} data-band-from={b.from} data-band-to={b.to} data-sleep={b.sleep ? "" : undefined}
                  title={b.sleep ? "Sleep: keep clear" : b.name} className={`pointer-events-none absolute inset-x-0 ${b.sleep ? "bg-[var(--muted)] opacity-80" : ""}`}
                  style={{ top: px(b.from), height: px(b.to) - px(b.from),
                    ...(b.sleep ? { backgroundImage: "repeating-linear-gradient(135deg, transparent 0 5px, var(--border) 5px 6px)" } : { background: `color-mix(in srgb, ${b.colour} 12%, transparent)`, boxShadow: `inset 2px 0 0 color-mix(in srgb, ${b.colour} 45%, transparent)` }) }} />
              ))}
              {prayersFor(day).map((p) => (
                <div key={p.name} data-prayer={p.name} data-min={p.min} title={`${p.label} ${formatMinutes(p.min)}`}
                  className="pointer-events-none absolute inset-x-0 z-[1] border-t border-dashed border-[color-mix(in_srgb,var(--foreground)_35%,transparent)]" style={{ top: px(p.min) }}>
                  <span aria-hidden="true" className="absolute right-0.5 -top-[7px] bg-[var(--surface)] px-0.5 font-mono text-[9px] font-semibold uppercase leading-[13px] text-[var(--muted-foreground)]">{p.label[0]}</span>
                </div>
              ))}
              {place(all(day)).filter(({ item }) => item.kind === "event" || week.showDone || !item.done).map(({ item: e, key, lane, lanes }) => {
                const own = e.kind === "task";
                const stream = own ? streamOf(e) : undefined;
                const colour = own ? stream?.color ?? "var(--accent)" : e.color ?? "var(--muted-foreground)";
                const long = (e.end_min as number) - (e.start_min as number) >= 45;
                const tip = own ? `${e.title}\n${whenText(e)}${stream ? ` · ${stream.label}` : ""}\nClick for details · drag to move` : eventTip(day, e, e.event_id ? "Drag to move" : "Read-only calendar");
                return (
                  <div key={key} role="button" tabIndex={0} data-item={key} draggable={canDrag(e)} onDragStart={(ev) => startDrag(ev, e, day)} onDragEnd={endDrag}
                    onPointerDown={(ev) => ev.stopPropagation()} onClick={() => pick(e)} onKeyDown={(k) => k.key === "Enter" && pick(e)}
                    aria-pressed={picked === key} title={tip} data-dimmed={dim(e)["data-dimmed"]}
                    className={`absolute overflow-hidden border-l-2 px-1.5 py-0.5 text-left text-xs font-medium leading-[15px] ${own ? "border border-dashed" : ""} ${canDrag(e) ? "cursor-grab" : "cursor-pointer"} ${picked === key ? "z-10 outline outline-1 outline-[var(--foreground)]" : ""}`}
                    style={{ top: px(e.start_min as number), height: Math.max(20, px(e.end_min as number) - px(e.start_min as number) - 2), left: `calc(${(100 * lane) / lanes}% + 2px)`, width: `calc(${100 / lanes}% - 4px)`,
                      borderColor: colour, background: `color-mix(in srgb, ${colour} ${own ? 8 : 16}%, var(--surface))` }}>
                    <span className="flex items-center gap-1">
                      {isPinned(pinOf(e)) && <Star size={10} aria-label="Important" className="shrink-0 fill-[var(--accent)] text-[var(--accent)]" />}
                      <span className={`truncate ${finished(e) ? "text-[var(--muted-foreground)] line-through" : ""}`}>{e.title}</span>
                      <Marks item={e} />
                    </span>
                    {long && <span className="block font-mono text-micro text-[var(--muted-foreground)]">{formatMinutes(e.start_min as number)}–{formatMinutes(e.end_min as number)}</span>}
                  </div>
                );
              })}
              {draw?.day === day && (
                <div className="pointer-events-none absolute inset-x-0.5 border border-[var(--accent)] bg-[var(--accent-light)]"
                  style={{ top: px(Math.min(draw.from, draw.to)), height: Math.max(px(SNAP), px(Math.max(draw.from, draw.to)) - px(Math.min(draw.from, draw.to))) }} />
              )}
              {day === today && <div className="pointer-events-none absolute inset-x-0 z-10 border-t border-[var(--destructive)]" style={{ top: px(nowMin) }}><span className="absolute -left-px -top-[4px] h-[7px] w-[7px] bg-[var(--destructive)]" /></div>}
            </div>
          ))}
        </div>
      </div>

      {pinnedItems.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-small" aria-label="Important">
          <span className={`${MICRO} inline-flex items-center gap-1`}><Star size={11} aria-hidden="true" className="fill-[var(--accent)] text-[var(--accent)]" />Important</span>
          {pinnedItems.map((p) => (
            <button key={p.key} type="button" onClick={() => setPicked(p.pick)} title={`${p.label}\n${p.when}`}
              className="inline-flex min-h-7 max-w-[16rem] items-center gap-1.5 border border-[var(--border)] px-2 text-xs enabled:hover:bg-[var(--muted)]">
              <span className="font-mono text-micro tabular-nums text-[var(--muted-foreground)]">{p.when}</span><span className="truncate font-medium">{p.label}</span>
            </button>
          ))}
        </div>
      )}
      {(problem || (!sel && items.problem)) && <p role="alert" className="mt-1.5 text-xs text-[var(--destructive)]">{problem ?? items.problem}</p>}

      {connected && draft && (
        <AddEventForm key={`${draft.day}-${draft.start}-${draft.end}`} day={draft.day} start={draft.start} end={draft.end}
          onChanged={() => { setDraft(null); refresh(); }} onCancel={() => setDraft(null)} />
      )}
    </div>
  );
}
