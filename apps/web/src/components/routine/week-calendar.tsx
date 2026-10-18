"use client";

import { ChevronLeft, ChevronRight, Plus, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatMinutes } from "@/lib/routine";
import { formatDuration } from "@/lib/ring";
import { vaultApi } from "@/lib/vault-api";
import { GoogleStatusData, VaultEvent, VaultTaskData } from "@/lib/vault-types";
import { addDays, fmtDay, sundayOf, weekDays } from "@/lib/week";
import { AddEventForm, ConnectButton, meetingName } from "@/components/routine/calendar-parts";

/** The grid shows the whole day. One hour is HOUR_PX tall; events snap to SNAP minutes when moved or drawn. */
const HOUR_PX = 28;
const GRID_PX = 24 * HOUR_PX;
const SNAP = 15;
const MICRO = "text-micro font-medium text-[var(--muted-foreground)]";
const BTN = "inline-flex min-h-8 items-center whitespace-nowrap border border-[var(--border)] px-2.5 text-xs font-semibold text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-40";

export interface DayData { events: VaultEvent[]; tasks: VaultTaskData[]; }
export interface SleepSpan { from: number; to: number; }

const px = (min: number) => (min / 60) * HOUR_PX;
const snap = (min: number) => Math.round(min / SNAP) * SNAP;
const hhmm = (min: number) => formatMinutes(Math.min(1439, Math.max(0, min)));

/** The week Sunday to Saturday around `today`, its events and tasks per day, and the paging that changes it. */
export function useWeek(today: string | null, refreshKey: number) {
  const [start, setStart] = useState<string | null>(null);
  const [data, setData] = useState<Record<string, DayData>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [change, setChange] = useState(0);
  const first = start ?? (today ? sundayOf(today) : null);
  const thisWeek = today ? sundayOf(today) : null;
  const days = useMemo(() => (first ? weekDays(`${first}/${addDays(first, 6)}`) : []), [first]);

  useEffect(() => {
    if (!days.length) return;
    let live = true;
    Promise.all(days.map(async (day) => {
      const [res, tasks] = await Promise.all([
        vaultApi.events(day).catch(() => ({ events: [] as VaultEvent[], errors: ["Calendar: could not load"] })),
        vaultApi.tasks(day).catch(() => [] as VaultTaskData[]),
      ]);
      return { day, events: res.events, errors: res.errors, tasks };
    })).then((all) => {
      if (!live) return;
      setData(Object.fromEntries(all.map((a) => [a.day, { events: a.events, tasks: a.tasks }])));
      setErrors([...new Set(all.flatMap((a) => a.errors))]);
    });
    return () => { live = false; };
  }, [days, refreshKey, change]);

  return {
    days, data, errors, today, isThisWeek: first === thisWeek,
    go: (n: number) => setStart(addDays(first as string, 7 * n)),
    goToday: () => setStart(null),
    reload: () => setChange((c) => c + 1),
  };
}
export type Week = ReturnType<typeof useWeek>;

/** One row: the week's range, previous / this week / next, and a note when a calendar could not be read (with Reconnect when Google's consent expired). */
export function WeekToolbar({ week }: { week: Week }) {
  const { days, errors } = week;
  if (!days.length) return null;
  const expired = errors.some((e) => e.includes("Reconnect"));
  return (
    <div className="ml-auto flex shrink-0 items-center gap-2 pb-px max-sm:w-full max-sm:justify-end max-sm:pb-1">
      {errors.length > 0 && (
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--destructive)]" title={errors.join("\n")}>
          <TriangleAlert size={13} aria-hidden="true" className="shrink-0" />
          <span className="hidden max-w-[14rem] truncate 2xl:inline">{errors[0]}</span>
          {expired && <ReconnectLink />}
        </span>
      )}
      <span className={`hidden whitespace-nowrap text-small font-semibold ${errors.length ? "2xl:inline" : "lg:inline"}`}>{fmtDay(days[0], { day: "numeric", month: "short" })} – {fmtDay(days[6], { day: "numeric", month: "short", year: "numeric" })}</span>
      <span className="inline-flex" role="group" aria-label="Week">
        <button type="button" onClick={() => week.go(-1)} aria-label="Previous week" className={`${BTN} px-1.5`}><ChevronLeft size={15} aria-hidden="true" /></button>
        <button type="button" onClick={week.goToday} disabled={week.isThisWeek} className={`${BTN} border-x-0`}>This week</button>
        <button type="button" onClick={() => week.go(1)} aria-label="Next week" className={`${BTN} px-1.5`}><ChevronRight size={15} aria-hidden="true" /></button>
      </span>
    </div>
  );
}

function ReconnectLink() {
  return (
    <button type="button" className="relative shrink-0 whitespace-nowrap border border-[var(--destructive)] px-2 py-0.5 text-xs font-semibold hover:bg-[var(--muted)]"
      onClick={() => void vaultApi.googleConnect().then((r) => window.location.assign(r.url)).catch(() => {})}>Reconnect</button>
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

interface Drag { id: string; day: string; allDay: boolean; duration: number; grab: number; }
interface Draw { day: string; from: number; to: number; }

/** The week as a 24-hour grid: drag an event to move it, drag across an empty slot to draw a new one. Sleep is greyed out; tasks sit in the all-day row. */
export function WeekCalendar({ week, nowMin, status, sleepFor, onChanged }: {
  week: Week; nowMin: number; status: GoogleStatusData | null; sleepFor: (day: string) => SleepSpan[]; onChanged: () => void;
}) {
  const { days, data, today } = week;
  const [picked, setPicked] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ day: string; start: string; end?: string } | null>(null);
  const [draw, setDraw] = useState<Draw | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // Start scrolled to about three hours before now.
  const scrolled = useRef(false);
  useEffect(() => {
    if (!days.length || !scroller.current || scrolled.current) return;
    scrolled.current = true;
    scroller.current.scrollTop = Math.max(0, px(nowMin) - 3 * HOUR_PX);
  }, [days.length, nowMin]);

  const refresh = useCallback(() => { week.reload(); onChanged(); }, [week, onChanged]);

  async function change(action: () => Promise<unknown>) {
    setProblem(null);
    try { await action(); } catch (err) { setProblem(err instanceof Error ? err.message : "Could not save"); }
    refresh();
  }

  const lookup = new Map<string, VaultEvent>();
  days.forEach((day) => (data[day]?.events ?? []).forEach((e, i) => lookup.set(`${day}:${i}`, e)));
  const selected = picked ? lookup.get(picked) ?? null : null;
  const upcoming = today ? (data[today]?.events ?? []).filter((e) => !e.all_day && e.start_min !== null && e.start_min > nowMin).sort((a, b) => (a.start_min as number) - (b.start_min as number))[0] : undefined;
  const minuteAt = (el: HTMLElement, clientY: number) => Math.max(0, Math.min(1440, ((clientY - el.getBoundingClientRect().top) / HOUR_PX) * 60));

  function startDrag(e: React.DragEvent, ev: VaultEvent, day: string) {
    if (!ev.id) return;
    const rect = e.currentTarget.getBoundingClientRect();
    drag.current = { id: ev.id, day, allDay: ev.all_day, duration: ev.all_day ? 0 : (ev.end_min as number) - (ev.start_min as number), grab: ev.all_day ? 0 : ((e.clientY - rect.top) / HOUR_PX) * 60 };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", ev.id);
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
    if (d?.allDay && d.day !== day) void change(() => vaultApi.moveEvent(d.id, { day }));
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
      <div ref={scroller} className="max-h-[min(40rem,calc(100vh-12rem))] overflow-auto border border-[var(--border)]" role="grid" aria-label="Week schedule">
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
                className={`sticky top-[34px] z-20 flex max-h-[5.5rem] min-h-7 flex-col gap-0.5 overflow-y-auto border-b border-l border-[var(--border)] p-0.5 ${over === `ad:${day}` ? "bg-[var(--accent-light)]" : "bg-[var(--surface)]"}`}>
                {(d?.events ?? []).map((e, i) => e.all_day && (
                  <div key={i} role="button" tabIndex={0} draggable={!!e.id} onDragStart={(ev) => startDrag(ev, e, day)} onDragEnd={() => { drag.current = null; setOver(null); }}
                    onClick={() => setPicked(`${day}:${i}`)} onKeyDown={(k) => k.key === "Enter" && setPicked(`${day}:${i}`)} title={e.id ? e.title : `${e.title} (read-only calendar)`} aria-pressed={picked === `${day}:${i}`}
                    className={`truncate border-l-2 bg-[var(--muted)] px-1.5 text-xs font-medium ${e.id ? "cursor-grab" : ""} ${picked === `${day}:${i}` ? "outline outline-1 outline-[var(--foreground)]" : ""}`} style={{ borderColor: e.color ?? "var(--muted-foreground)" }}>{e.title}</div>
                ))}
                {(d?.tasks ?? []).map((t) => (
                  <button key={`${t.path}:${t.line}`} type="button" title={`Task: ${t.text}`} onClick={() => void change(() => vaultApi.setTask(t, !t.done))}
                    className={`flex items-center gap-1 truncate border border-dashed border-[var(--border)] px-1 text-left text-xs hover:bg-[var(--muted)] ${t.done ? "text-[var(--muted-foreground)] line-through" : ""}`}>
                    <span className={`grid h-2.5 w-2.5 shrink-0 place-items-center border border-[var(--muted-foreground)] ${t.done ? "bg-[var(--accent)]" : ""}`} aria-hidden="true" />
                    <span className="truncate">{t.text}</span>
                  </button>
                ))}
              </div>
            );
          })}

          <div className="relative" style={{ height: GRID_PX }}>
            {Array.from({ length: 24 }, (_, h) => h > 0 && (
              <span key={h} className="absolute right-1 -translate-y-1.5 font-mono text-micro text-[var(--muted-foreground)]" style={{ top: h * HOUR_PX }}>{String(h).padStart(2, "0")}</span>
            ))}
          </div>
          {days.map((day) => (
            <div key={day} role="gridcell" aria-label={`${fmtDay(day, { weekday: "long", day: "numeric", month: "long" })}: drag on an empty slot to add an event`}
              className={`relative cursor-cell border-l border-[var(--border)] ${day === today ? "bg-[var(--accent-light)]" : ""}`}
              style={{ height: GRID_PX, touchAction: "pan-x pan-y", backgroundImage: "linear-gradient(var(--border) 1px, transparent 1px)", backgroundSize: `100% ${HOUR_PX}px` }}
              onPointerDown={(e) => startDraw(e, day)} onPointerMove={moveDraw} onPointerUp={endDraw} onPointerCancel={() => setDraw(null)}
              onDragOver={(e) => { if (drag.current && !drag.current.allDay) { e.preventDefault(); } }} onDrop={(e) => dropTimed(e, day)}>
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
                    aria-pressed={picked === key} title={e.id ? `${e.title}: drag to move` : `${e.title} (read-only calendar)`}
                    className={`absolute overflow-hidden border-l-2 px-1.5 py-0.5 text-left text-xs font-medium leading-[15px] ${e.id ? "cursor-grab" : "cursor-pointer"} ${picked === key ? "z-10 outline outline-1 outline-[var(--foreground)]" : ""}`}
                    style={{ top: px(e.start_min as number), height: Math.max(20, px((e.end_min as number) - (e.start_min as number)) - 2), left: `calc(${(100 * lane) / lanes}% + 2px)`, width: `calc(${100 / lanes}% - 4px)`,
                      borderColor: colour, background: `color-mix(in srgb, ${colour} 16%, var(--surface))` }}>
                    <span className="block truncate">{e.title}</span>
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

      <div className="mt-2 flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 border border-[var(--border)] px-3 py-1.5 text-small">
        {selected ? (
          <>
            <span className="font-semibold">{selected.title}</span>
            <span className="font-mono tabular-nums text-[var(--muted-foreground)]">{selected.all_day || selected.start_min === null || selected.end_min === null ? "All day" : `${formatMinutes(selected.start_min)}–${formatMinutes(selected.end_min)} · ${formatDuration(selected.end_min - selected.start_min)}`}</span>
            <span className="text-[var(--muted-foreground)]">{selected.calendar}{selected.location ? ` · ${selected.location}` : ""}{selected.id ? "" : " · read-only"}</span>
            <span className="flex-1" />
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
            ) : <span className="text-[var(--muted-foreground)]">{connected ? "Drag an event to move it, drag across an empty slot to add one." : "Connect Google Calendar to move or add events."} Grey hatching is sleep.</span>}
            <span className="flex-1" />
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
