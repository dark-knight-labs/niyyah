"use client";

import { ChevronLeft, ChevronRight, Maximize2, Minimize2, Plus, Star, Trash2, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatMinutes } from "@/lib/routine";
import { StreamMeta } from "@/lib/streams";
import { formatDuration } from "@/lib/ring";
import { vaultApi } from "@/lib/vault-api";
import { GoogleStatusData, VaultEvent, VaultTaskData } from "@/lib/vault-types";
import { addDays, fmtDay, sundayOf, weekDays } from "@/lib/week";
import { AddEventForm, ConnectButton, meetingName, QuickAdd } from "@/components/routine/calendar-parts";

/** The grid shows the whole day. One hour is HOUR_PX tall (SLEEP_PX when it is a collapsed sleep hour); events snap to SNAP minutes when moved or drawn. */
const HOUR_PX = 28;
const SLEEP_PX = 5;
const SNAP = 15;
const MICRO = "text-micro font-medium text-[var(--muted-foreground)]";
const BTN = "inline-flex min-h-8 items-center whitespace-nowrap border border-[var(--border)] px-2.5 text-xs font-semibold text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-40";

export interface DayData { events: VaultEvent[]; tasks: VaultTaskData[]; }
export interface SleepSpan { from: number; to: number; }

/** Vertical positions for a day column. `collapsed[h]` squeezes hour h to a thin strip. */
function makeScale(collapsed: boolean[]) {
  const heights = collapsed.map((c) => (c ? SLEEP_PX : HOUR_PX));
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

/** What a pin is stored under: a Google event by its id, any other event by title, day and start, a task by day and text. */
const eventPin = (day: string, e: VaultEvent) => `e:${e.id ?? `${e.title}|${day}|${e.start_min ?? "all"}`}`;
const taskPin = (day: string, t: VaultTaskData) => `t:${day}|${t.text}`;

/** The week Sunday to Saturday around `today`, its events and tasks per day, and the paging that changes it. */
export function useWeek(today: string | null, refreshKey: number) {
  const [start, setStart] = useState<string | null>(null);
  const [events, setEvents] = useState<Record<string, VaultEvent[]>>({});
  const [tasks, setTasks] = useState<Record<string, VaultTaskData[]>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [eventChange, setEventChange] = useState(0);
  const [taskChange, setTaskChange] = useState(0);
  const [pins, setPins] = useState<string[]>([]);
  const first = start ?? (today ? sundayOf(today) : null);
  const thisWeek = today ? sundayOf(today) : null;
  const days = useMemo(() => (first ? weekDays(`${first}/${addDays(first, 6)}`) : []), [first]);
  const data = useMemo(() => Object.fromEntries(days.map((day) => [day, { events: events[day] ?? [], tasks: tasks[day] ?? [] }])) as Record<string, DayData>, [days, events, tasks]);

  // Events come from outside calendars and take about a second a day; tasks are local and fast. They load apart so a task change never waits on, or repeats, the calendar fetch.
  useEffect(() => {
    if (!days.length) return;
    let live = true;
    Promise.all(days.map(async (day) => {
      const res = await vaultApi.events(day).catch(() => ({ events: [] as VaultEvent[], errors: ["Calendar: could not load"] }));
      return { day, events: res.events, errors: res.errors };
    })).then((all) => {
      if (!live) return;
      setEvents(Object.fromEntries(all.map((a) => [a.day, a.events])));
      setErrors([...new Set(all.flatMap((a) => a.errors))]);
    });
    return () => { live = false; };
  }, [days, refreshKey, eventChange]);

  useEffect(() => {
    if (!days.length) return;
    let live = true;
    Promise.all(days.map(async (day) => [day, await vaultApi.tasks(day).catch(() => [] as VaultTaskData[])] as const)).then((all) => {
      if (live) setTasks(Object.fromEntries(all));
    });
    return () => { live = false; };
  }, [days, refreshKey, taskChange]);

  useEffect(() => {
    let live = true;
    vaultApi.pins().then((p) => live && setPins(p)).catch(() => {});
    return () => { live = false; };
  }, []);

  return {
    days, data, errors, today, isThisWeek: first === thisWeek, pins, setPins,
    /** Mark an event or task important (or clear it); shows at once and settles on what the server says. */
    togglePin: (key: string) => {
      const pinned = !pins.includes(key);
      setPins(pinned ? [...pins, key] : pins.filter((k) => k !== key));
      vaultApi.setPin(key, pinned).then(setPins).catch(() => setPins(pins));
    },
    go: (n: number) => setStart(addDays(first as string, 7 * n)),
    goToday: () => setStart(null),
    /** Fetch events and tasks again. */
    reload: () => { setEventChange((c) => c + 1); setTaskChange((c) => c + 1); },
    /** Fetch only the tasks again. */
    reloadTasks: () => setTaskChange((c) => c + 1),
  };
}
export type Week = ReturnType<typeof useWeek>;

/** "18–24 Oct", or "28 Oct – 3 Nov" when the week spans two months. */
function rangeLabel(first: string, last: string): string {
  const month = (d: string) => fmtDay(d, { month: "short" });
  const day = (d: string) => fmtDay(d, { day: "numeric" });
  return month(first) === month(last) ? `${day(first)}–${day(last)} ${month(last)}` : `${day(first)} ${month(first)} – ${day(last)} ${month(last)}`;
}

/** One row: add a task or event for today, previous / the week's range / next, expand, and a note when a calendar could not be read (with Reconnect when Google's consent expired). The range button returns to this week. */
export function WeekToolbar({ week, status, expanded, onExpand, onAdded }: { week: Week; status: GoogleStatusData | null; expanded: boolean; onExpand: () => void; onAdded: () => void }) {
  const { days, errors } = week;
  if (!days.length) return null;
  const expired = errors.some((e) => e.includes("Reconnect"));
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-x-3 gap-y-1.5 pb-px">
      {errors.length > 0 && (
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--destructive)]" title={errors.join("\n")}>
          <TriangleAlert size={13} aria-hidden="true" className="shrink-0" />
          <span className="hidden max-w-[14rem] truncate 2xl:inline">{errors[0]}</span>
          {expired && <ReconnectLink />}
        </span>
      )}
      {week.today && <QuickAdd day={week.today} connected={!!status?.connected} onAdded={onAdded} />}
      <span className="inline-flex shrink-0" role="group" aria-label="Week">
        <button type="button" onClick={() => week.go(-1)} aria-label="Previous week" className={`${BTN} px-1.5`}><ChevronLeft size={15} aria-hidden="true" /></button>
        <button type="button" onClick={week.goToday} disabled={week.isThisWeek} aria-label={`${rangeLabel(days[0], days[6])} ${fmtDay(days[6], { year: "numeric" })}${week.isThisWeek ? ", this week" : ", back to this week"}`} title={week.isThisWeek ? "This week" : "Back to this week"}
          className={`${BTN} border-x-0 font-mono tabular-nums ${week.isThisWeek ? "!text-[var(--foreground)] !opacity-100" : ""}`}>{rangeLabel(days[0], days[6])}</button>
        <button type="button" onClick={() => week.go(1)} aria-label="Next week" className={`${BTN} px-1.5`}><ChevronRight size={15} aria-hidden="true" /></button>
      </span>
      <button type="button" onClick={onExpand} aria-pressed={expanded} aria-label={expanded ? "Shrink calendar" : "Expand calendar over the clock"} title={expanded ? "Shrink" : "Expand"} className={`${BTN} px-1.5`}>
        {expanded ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}
      </button>
    </div>
  );
}

function ReconnectLink() {
  return (
    <button type="button" className="relative shrink-0 whitespace-nowrap border border-[var(--destructive)] px-2 py-0.5 text-xs font-semibold hover:bg-[var(--muted)]"
      onClick={() => void vaultApi.googleConnect().then((r) => window.location.assign(r.url)).catch(() => {})}>Reconnect</button>
  );
}

const day0 = (pick: string) => pick.slice(0, 10);

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

/** A task edited in its chip: Enter saves the text, Esc cancels, the bin deletes it, the stream menu moves it to another stream at once. */
function EditTask({ text, stream, streams, onDone, onStream, onDelete }: {
  text: string; stream: string | null; streams: StreamMeta[]; onDone: (text: string | null) => void; onStream: (stream: string | null) => void; onDelete: () => void;
}) {
  const [draft, setDraft] = useState(text);
  const finished = useRef(false);
  const finish = (value: string | null) => { if (!finished.current) { finished.current = true; onDone(value); } };
  const changed = () => (draft.trim() && draft.trim() !== text ? draft.trim() : null);
  return (
    <div className="flex items-center gap-0.5" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) finish(changed()); }}>
      <input autoFocus value={draft} maxLength={300} aria-label="Edit task" onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") finish(changed()); if (e.key === "Escape") finish(null); }}
        className="min-h-6 min-w-0 flex-1 border border-[var(--accent)] bg-[var(--background)] px-1 text-xs" />
      {streams.length > 0 && <StreamSelect value={stream} streams={streams} label="Stream of this task" onChange={(next) => { finished.current = true; onStream(next); }} />}
      <button type="button" aria-label="Delete task" title="Delete task" onMouseDown={(e) => e.preventDefault()} onClick={() => { finished.current = true; onDelete(); }}
        className="grid h-6 w-6 shrink-0 place-items-center text-[var(--muted-foreground)] hover:text-[var(--destructive)]"><Trash2 size={12} aria-hidden="true" /></button>
    </div>
  );
}

interface Placed { event: VaultEvent; key: string; lane: number; lanes: number; }

/** Side-by-side lanes for events that overlap in time, so none hides another. */
function place(day: string, events: VaultEvent[]): Placed[] {
  const timed = events.map((event, i) => ({ event, key: `${day}:${i}` })).filter((e) => !e.event.all_day && e.event.start_min !== null && e.event.end_min !== null)
    .sort((a, b) => (a.event.start_min as number) - (b.event.start_min as number));
  const out: Placed[] = [];
  let group: Placed[] = [];
  let groupEnd = -1;
  const flush = () => { const lanes = Math.max(0, ...group.map((g) => g.lane)) + 1; out.push(...group.map((g) => ({ ...g, lanes }))); group = []; };
  for (const e of timed) {
    if (group.length && (e.event.start_min as number) >= groupEnd) { flush(); groupEnd = -1; }
    const taken = new Set(group.filter((g) => (g.event.end_min as number) > (e.event.start_min as number)).map((g) => g.lane));
    let lane = 0;
    while (taken.has(lane)) lane++;
    group.push({ ...e, lane, lanes: 1 });
    groupEnd = Math.max(groupEnd, e.event.end_min as number);
  }
  flush();
  return out;
}

interface Drag { id: string; day: string; allDay: boolean; duration: number; grab: number; task?: VaultTaskData; }
interface Draw { day: string; from: number; to: number; }

/** The week as a 24-hour grid: drag an event to move it, drag across an empty slot to draw a new one. Sleep is greyed out; tasks sit in the all-day row. */
export function WeekCalendar({ week, streams, nowMin, status, sleepFor, onChanged, onEventsChanged }: {
  week: Week; streams: StreamMeta[]; nowMin: number; status: GoogleStatusData | null; sleepFor: (day: string) => SleepSpan[]; onChanged: () => void; onEventsChanged: () => void;
}) {
  const { days, data, today } = week;
  const [picked, setPicked] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ day: string; start: string; end?: string } | null>(null);
  const [draw, setDraw] = useState<Draw | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [sleepOpen, setSleepOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // An hour collapses when every day of the week is asleep for all of it and no event touches it.
  const collapsible = Array.from({ length: 24 }, (_, h) => days.length > 0 && days.every((day) =>
    sleepFor(day).some((s) => s.from <= h * 60 && s.to >= (h + 1) * 60)
    && !(data[day]?.events ?? []).some((e) => e.all_day || e.start_min === null || e.end_min === null ? false : e.start_min < (h + 1) * 60 && e.end_min > h * 60)));
  const canCollapse = collapsible.some(Boolean);
  const { px, minuteAt: scaleMinuteAt, heights, tops, total: GRID_PX } = makeScale(collapsible.map((c) => c && !sleepOpen));

  // Start scrolled to about three hours before now.
  const scrolled = useRef(false);
  useEffect(() => {
    if (!days.length || !scroller.current || scrolled.current) return;
    scrolled.current = true;
    scroller.current.scrollTop = Math.max(0, px(nowMin) - 3 * HOUR_PX);
  }, [days.length, nowMin, px]);

  const refresh = useCallback(() => { week.reload(); onChanged(); onEventsChanged(); }, [week, onChanged, onEventsChanged]);

  /** Run a change, then fetch again only what it touched: a task change reloads tasks (fast), an event change reloads the calendar too (slow). */
  async function change(action: () => Promise<unknown>, touches: "tasks" | "events" = "events") {
    setProblem(null);
    try { await action(); } catch (err) { setProblem(err instanceof Error ? err.message : "Could not save"); }
    if (touches === "tasks") { week.reloadTasks(); onChanged(); } else refresh();
  }

  const streamOf = (t: VaultTaskData) => streams.find((s) => s.id === t.stream);
  const lookup = new Map<string, VaultEvent>();
  days.forEach((day) => (data[day]?.events ?? []).forEach((e, i) => lookup.set(`${day}:${i}`, e)));
  const selected = picked ? lookup.get(picked) ?? null : null;
  const isPinned = (key: string) => week.pins.includes(key);
  const pinnedItems = days.flatMap((day) => [
    ...(data[day]?.events ?? []).map((e, i) => ({ key: eventPin(day, e), label: e.title, when: `${fmtDay(day, { weekday: "short" })} ${e.all_day || e.start_min === null ? "" : formatMinutes(e.start_min)}`.trim(), pick: `${day}:${i}`, over: !!today && (day < today || (day === today && !e.all_day && (e.end_min as number) < nowMin)) })),
    ...(data[day]?.tasks ?? []).filter((t) => !t.done).map((t) => ({ key: taskPin(day, t), label: t.text, when: `${fmtDay(day, { weekday: "short" })} task`, pick: null as string | null, over: !!today && day < today })),
  ]).filter((p) => isPinned(p.key) && !p.over);
  const upcoming = today ? (data[today]?.events ?? []).filter((e) => !e.all_day && e.start_min !== null && e.start_min > nowMin).sort((a, b) => (a.start_min as number) - (b.start_min as number))[0] : undefined;
  const minuteAt = (el: HTMLElement, clientY: number) => scaleMinuteAt(clientY - el.getBoundingClientRect().top);

  const whenText = (e: VaultEvent) => (e.all_day || e.start_min === null || e.end_min === null ? "All day" : `${formatMinutes(e.start_min)}–${formatMinutes(e.end_min)}`);
  const eventTip = (day: string, e: VaultEvent, hint: string) => [`${isPinned(eventPin(day, e)) ? "★ " : ""}${e.title}`, whenText(e), `${e.calendar}${e.location ? ` · ${e.location}` : ""}`, hint].join("\n");

  function startDrag(e: React.DragEvent, ev: VaultEvent, day: string) {
    if (!ev.id) return;
    const rect = e.currentTarget.getBoundingClientRect();
    drag.current = { id: ev.id, day, allDay: ev.all_day, duration: ev.all_day ? 0 : (ev.end_min as number) - (ev.start_min as number), grab: ev.all_day ? 0 : scaleMinuteAt(e.clientY - rect.top + px(ev.start_min as number)) - (ev.start_min as number) };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", ev.id);
  }

  function startTaskDrag(e: React.DragEvent, task: VaultTaskData, day: string) {
    drag.current = { id: String(task.line), day, allDay: true, duration: 0, grab: 0, task };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", task.text);
  }

  function dropTimed(e: React.DragEvent<HTMLDivElement>, day: string) {
    e.preventDefault();
    setOver(null);
    const d = drag.current;
    drag.current = null;
    if (!d || d.allDay) return;
    const start = Math.min(1440 - d.duration, Math.max(0, snap(minuteAt(e.currentTarget, e.clientY) - d.grab)));
    void change(() => vaultApi.moveEvent(d.id, { day, start: hhmm(start), end: hhmm(start + d.duration) }));
  }

  function dropAllDay(e: React.DragEvent, day: string) {
    e.preventDefault();
    setOver(null);
    const d = drag.current;
    drag.current = null;
    if (!d?.allDay || d.day === day) return;
    const task = d.task;
    if (!task) return void change(() => vaultApi.moveEvent(d.id, { day }));
    const from = taskPin(d.day, task);
    const was = isPinned(from);
    void change(async () => {
      await vaultApi.moveTask(task, d.day, day);
      if (was) await vaultApi.setPin(from, false).then(() => vaultApi.setPin(taskPin(day, task), true)).then(week.setPins);
    }, "tasks");
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

  return (
    <div>
      <div ref={scroller} className="max-h-[calc(100vh-14rem)] overflow-auto border border-[var(--border)]" role="grid" aria-label="Week schedule">
        <div className="grid min-w-[40rem] grid-cols-[2.5rem_repeat(7,minmax(0,1fr))]">
          <div className="sticky top-0 z-20 h-[34px] border-b border-[var(--border)] bg-[var(--surface)]" />
          {days.map((day) => (
            <div key={day} className={`sticky top-0 z-20 flex h-[34px] items-baseline gap-1.5 border-b border-l border-[var(--border)] px-1.5 py-1.5 ${day === today ? "bg-[var(--accent-light)] shadow-[inset_0_-2px_0_var(--accent)]" : "bg-[var(--surface)]"}`}>
              <span className={`${MICRO} ${day === today ? "!text-[var(--accent)]" : ""}`}>{fmtDay(day, { weekday: "short" })}</span>
              <span className={`font-mono text-small font-medium tabular-nums ${day === today ? "text-[var(--accent)]" : ""}`}>{fmtDay(day, { day: "numeric" })}</span>
            </div>
          ))}

          <div className="sticky top-[34px] z-20 border-b border-[var(--border)] bg-[var(--surface)] px-1 py-1.5 text-micro text-[var(--muted-foreground)]">All day</div>
          {days.map((day) => {
            const d = data[day];
            return (
              <div key={day} onDragOver={(e) => { if (drag.current?.allDay) { e.preventDefault(); setOver(`ad:${day}`); } }} onDragLeave={() => setOver(null)} onDrop={(e) => dropAllDay(e, day)}
                onClick={(e) => { if (e.target === e.currentTarget) setAdding(day); }}
                className={`group sticky top-[34px] z-20 flex max-h-[5.5rem] min-h-7 cursor-cell flex-col gap-0.5 overflow-y-auto border-b border-l border-[var(--border)] p-0.5 ${over === `ad:${day}` ? "bg-[var(--accent-light)]" : "bg-[var(--surface)]"}`}>
                {(d?.events ?? []).map((e, i) => e.all_day && (
                  <div key={i} role="button" tabIndex={0} draggable={!!e.id} onDragStart={(ev) => startDrag(ev, e, day)} onDragEnd={() => { drag.current = null; setOver(null); }}
                    onClick={() => setPicked(`${day}:${i}`)} onKeyDown={(k) => k.key === "Enter" && setPicked(`${day}:${i}`)} title={eventTip(day, e, e.id ? "Drag to another day to move" : "Read-only calendar")} aria-pressed={picked === `${day}:${i}`}
                    className={`flex items-center gap-1 border-l-2 bg-[var(--muted)] px-1.5 text-xs font-medium ${e.id ? "cursor-grab" : "cursor-pointer"} ${picked === `${day}:${i}` ? "outline outline-1 outline-[var(--foreground)]" : ""}`} style={{ borderColor: e.color ?? "var(--muted-foreground)" }}>
                    {isPinned(eventPin(day, e)) && <Star size={10} aria-label="Important" className="shrink-0 fill-[var(--accent)] text-[var(--accent)]" />}
                    <span className="truncate">{e.title}</span>
                  </div>
                ))}
                {(d?.tasks ?? []).map((t) => {
                  const id = `${t.path}:${t.line}`;
                  return editing === id ? (
                    <EditTask key={id} text={t.text} stream={t.stream} streams={streams}
                      onDone={(text) => { setEditing(null); if (text) void change(() => vaultApi.editTask(t, text), "tasks"); }}
                      onStream={(next) => { setEditing(null); void change(() => vaultApi.setTaskStream(t, next), "tasks"); }}
                      onDelete={() => { setEditing(null); void change(() => vaultApi.removeTask(t), "tasks"); }} />
                  ) : (
                    <div key={id} draggable onDragStart={(ev) => startTaskDrag(ev, t, day)} onDragEnd={() => { drag.current = null; setOver(null); }}
                      title={`${t.text}${streamOf(t) ? ` · ${streamOf(t)?.label}` : ""}${isPinned(taskPin(day, t)) ? " (important)" : ""}\nClick to edit · drag to another day to move`}
                      className="group/task flex cursor-grab items-center border border-dashed border-[var(--border)] text-xs hover:bg-[var(--muted)]">
                      <button type="button" aria-label={`${t.done ? "Not done" : "Done"}: ${t.text}`} aria-pressed={t.done} onClick={() => void change(() => vaultApi.setTask(t, !t.done), "tasks")}
                        className="grid h-5 w-5 shrink-0 place-items-center"><span className={`h-2.5 w-2.5 border border-[var(--muted-foreground)] ${t.done ? "bg-[var(--accent)]" : ""}`} /></button>
                      {streamOf(t) && <span aria-hidden="true" className="h-2 w-2 shrink-0" style={{ background: streamOf(t)?.color }} />}
                      <button type="button" onClick={() => setEditing(id)} className={`min-w-0 flex-1 truncate py-0.5 pr-1 text-left ${t.done ? "text-[var(--muted-foreground)] line-through" : ""}`}>{t.text}</button>
                      <button type="button" aria-pressed={isPinned(taskPin(day, t))} aria-label={`Important: ${t.text}`} title="Mark important" onClick={() => week.togglePin(taskPin(day, t))}
                        className={`grid h-4 w-4 shrink-0 place-items-center ${isPinned(taskPin(day, t)) ? "" : "opacity-0 focus:opacity-100 group-hover/task:opacity-100"}`}>
                        <Star size={11} className={isPinned(taskPin(day, t)) ? "fill-[var(--accent)] text-[var(--accent)]" : "text-[var(--muted-foreground)]"} />
                      </button>
                    </div>
                  );
                })}
                {adding === day ? (
                  <AddTask key="add" day={day} streams={streams} onDone={(text, stream) => { setAdding(null); if (text) void change(() => vaultApi.addTask(day, text, stream), "tasks"); }} />
                ) : (
                  <button type="button" aria-label={`Add a task on ${fmtDay(day, { weekday: "long", day: "numeric", month: "long" })}`} title="Add a task for this day" onClick={() => setAdding(day)}
                    className="flex h-4 items-center gap-0.5 px-0.5 text-micro text-[var(--muted-foreground)] opacity-40 hover:opacity-100 focus:opacity-100 group-hover:opacity-100"><Plus size={11} aria-hidden="true" />Task</button>
                )}
              </div>
            );
          })}

          <div className="relative" style={{ height: GRID_PX }}>
            {Array.from({ length: 24 }, (_, h) => h > 0 && heights[h] === HOUR_PX && (
              <span key={h} className="absolute right-1 -translate-y-1.5 font-mono text-micro text-[var(--muted-foreground)]" style={{ top: tops[h] }}>{pad2(h)}</span>
            ))}
          </div>
          {days.map((day) => (
            <div key={day} role="gridcell" aria-label={`${fmtDay(day, { weekday: "long", day: "numeric", month: "long" })}: drag on an empty slot to add an event`}
              className={`relative cursor-cell border-l border-[var(--border)] ${day === today ? "bg-[var(--accent-light)]" : ""}`}
              style={{ height: GRID_PX, touchAction: "pan-x pan-y" }}
              onPointerDown={(e) => startDraw(e, day)} onPointerMove={moveDraw} onPointerUp={endDraw} onPointerCancel={() => setDraw(null)}
              onDragOver={(e) => { if (drag.current && !drag.current.allDay) { e.preventDefault(); } }} onDrop={(e) => dropTimed(e, day)}>
              {tops.map((t, h) => <div key={h} aria-hidden="true" className="pointer-events-none absolute inset-x-0 border-t border-[var(--border)]" style={{ top: t }} />)}
              {sleepFor(day).map((s, i) => (
                <div key={i} aria-hidden="true" title="Sleep: keep clear" className="pointer-events-none absolute inset-x-0 bg-[var(--muted)] opacity-80"
                  style={{ top: px(s.from), height: px(s.to - s.from), backgroundImage: "repeating-linear-gradient(135deg, transparent 0 5px, var(--border) 5px 6px)" }} />
              ))}
              {place(day, data[day]?.events ?? []).map(({ event: e, key, lane, lanes }) => {
                const colour = e.color ?? "var(--muted-foreground)";
                const long = (e.end_min as number) - (e.start_min as number) >= 45;
                return (
                  <div key={key} role="button" tabIndex={0} draggable={!!e.id} onDragStart={(ev) => startDrag(ev, e, day)} onDragEnd={() => { drag.current = null; }}
                    onPointerDown={(ev) => ev.stopPropagation()} onClick={() => { setPicked(key); setDraft(null); }} onKeyDown={(k) => k.key === "Enter" && setPicked(key)}
                    aria-pressed={picked === key} title={eventTip(day, e, e.id ? "Drag to move" : "Read-only calendar")}
                    className={`absolute overflow-hidden border-l-2 px-1.5 py-0.5 text-left text-xs font-medium leading-[15px] ${e.id ? "cursor-grab" : "cursor-pointer"} ${picked === key ? "z-10 outline outline-1 outline-[var(--foreground)]" : ""}`}
                    style={{ top: px(e.start_min as number), height: Math.max(20, px((e.end_min as number) - (e.start_min as number)) - 2), left: `calc(${(100 * lane) / lanes}% + 2px)`, width: `calc(${100 / lanes}% - 4px)`,
                      borderColor: colour, background: `color-mix(in srgb, ${colour} 16%, var(--surface))` }}>
                    <span className="flex items-center gap-1">
                      {isPinned(eventPin(day, e)) && <Star size={10} aria-label="Important" className="shrink-0 fill-[var(--accent)] text-[var(--accent)]" />}
                      <span className="truncate">{e.title}</span>
                    </span>
                    {long && <span className="block font-mono text-micro text-[var(--muted-foreground)]">{formatMinutes(e.start_min as number)}</span>}
                  </div>
                );
              })}
              {draw?.day === day && (
                <div className="pointer-events-none absolute inset-x-0.5 border border-[var(--accent)] bg-[var(--accent-light)]"
                  style={{ top: px(Math.min(draw.from, draw.to)), height: Math.max(px(SNAP), px(Math.abs(draw.to - draw.from))) }} />
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
            <button key={p.key} type="button" disabled={!p.pick} onClick={() => p.pick && setPicked(p.pick)} title={`${p.label}\n${p.when}`}
              className="inline-flex min-h-7 max-w-[16rem] items-center gap-1.5 border border-[var(--border)] px-2 text-xs enabled:hover:bg-[var(--muted)]">
              <span className="font-mono text-micro tabular-nums text-[var(--muted-foreground)]">{p.when}</span><span className="truncate font-medium">{p.label}</span>
            </button>
          ))}
        </div>
      )}
      <div className="mt-2 flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 border border-[var(--border)] px-3 py-1.5 text-small">
        {selected ? (
          <>
            <span className="font-semibold">{selected.title}</span>
            <span className="font-mono tabular-nums text-[var(--muted-foreground)]">{selected.all_day || selected.start_min === null || selected.end_min === null ? "All day" : `${formatMinutes(selected.start_min)}–${formatMinutes(selected.end_min)} · ${formatDuration(selected.end_min - selected.start_min)}`}</span>
            <span className="text-[var(--muted-foreground)]">{selected.calendar}{selected.location ? ` · ${selected.location}` : ""}{selected.id ? "" : " · read-only"}</span>
            <span className="flex-1" />
            {(() => {
              const key = eventPin(day0(picked as string), selected);
              return <button type="button" aria-pressed={isPinned(key)} onClick={() => week.togglePin(key)} className={`inline-flex min-h-7 items-center gap-1 border border-[var(--border)] px-2.5 text-xs font-semibold hover:bg-[var(--muted)] ${isPinned(key) ? "text-[var(--accent)]" : "text-[var(--muted-foreground)]"}`}><Star size={12} aria-hidden="true" className={isPinned(key) ? "fill-[var(--accent)]" : ""} />{isPinned(key) ? "Important" : "Mark important"}</button>;
            })()}
            {selected.meeting_url && <a href={selected.meeting_url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-7 items-center border border-[var(--border)] px-2.5 text-xs font-semibold text-[var(--accent)] hover:bg-[var(--accent-light)]">Join {meetingName(selected.meeting_url)}</a>}
            {selected.id && <button type="button" onClick={() => { const id = selected.id as string; setPicked(null); void change(() => vaultApi.removeEvent(id)); }} className="min-h-7 border border-[var(--border)] px-2.5 text-xs font-semibold text-[var(--destructive)] hover:bg-[var(--muted)]">Delete</button>}
            <button type="button" onClick={() => setPicked(null)} className="min-h-7 px-2 text-xs font-semibold text-[var(--muted-foreground)] hover:text-[var(--foreground)]">Close</button>
          </>
        ) : (
          <>
            {upcoming && week.isThisWeek ? (
              <>
                <span className={MICRO}>Next up</span>
                <span className="font-mono font-medium tabular-nums text-[var(--accent)]">{formatMinutes(upcoming.start_min as number)}</span>
                <span className="min-w-0 truncate font-semibold">{upcoming.title}</span>
                <span className={MICRO}>in {formatDuration((upcoming.start_min as number) - nowMin)}</span>
                {upcoming.meeting_url && <a href={upcoming.meeting_url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-7 items-center border border-[var(--border)] px-2.5 text-xs font-semibold text-[var(--accent)] hover:bg-[var(--accent-light)]">Join {meetingName(upcoming.meeting_url)}</a>}
              </>
            ) : <span className="text-[var(--muted-foreground)]">{connected ? "Drag an event to move it, drag across an empty slot to add one." : "Connect Google Calendar to move or add events."} Hatching is sleep.</span>}
            <span className="flex-1" />
            {canCollapse && <button type="button" aria-pressed={sleepOpen} onClick={() => setSleepOpen(!sleepOpen)} className={BTN}>{sleepOpen ? "Collapse sleep" : "Expand sleep"}</button>}
            {connected && <button type="button" onClick={() => setDraft({ day: today ?? days[0], start: "09:00", end: "10:00" })} className={BTN}><Plus size={14} aria-hidden="true" />New event</button>}
          </>
        )}
      </div>
      {problem && <p role="alert" className="mt-1.5 text-xs text-[var(--destructive)]">{problem}</p>}

      {connected && draft && (
        <AddEventForm key={`${draft.day}-${draft.start}-${draft.end}`} day={draft.day} start={draft.start} end={draft.end}
          onChanged={() => { setDraft(null); refresh(); }} onCancel={() => setDraft(null)} />
      )}
      {status?.configured && !status.connected && <ConnectButton />}
      {status && !status.configured && <p className="mt-2 text-xs text-[var(--muted-foreground)]">Google Calendar is not set up on the server yet.</p>}
    </div>
  );
}
