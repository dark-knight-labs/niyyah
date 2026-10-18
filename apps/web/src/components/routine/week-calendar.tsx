"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatMinutes } from "@/lib/routine";
import { formatDuration } from "@/lib/ring";
import { vaultApi } from "@/lib/vault-api";
import { GoogleStatusData, VaultEvent } from "@/lib/vault-types";
import { addDays, fmtDay, mondayOf, weekDays } from "@/lib/week";
import { AddEventForm, ConnectButton, meetingName } from "@/components/routine/calendar-parts";

/** Visible hours of the grid and the height of one hour. Events outside are clamped to the edge. */
const FIRST_HOUR = 5;
const LAST_HOUR = 23;
const HOUR_PX = 30;
const GRID_PX = (LAST_HOUR - FIRST_HOUR) * HOUR_PX;

interface DayEvents { day: string; events: VaultEvent[]; }
interface Placed { event: VaultEvent; key: string; lane: number; lanes: number; }

const MICRO = "text-micro font-medium text-[var(--muted-foreground)]";

/** Side-by-side lanes for events that overlap in time, so none hides another. */
function place(day: string, events: VaultEvent[]): Placed[] {
  const timed = events.map((event, i) => ({ event, key: `${day}:${i}` })).filter((e) => e.event.start_min !== null && e.event.end_min !== null)
    .sort((a, b) => (a.event.start_min as number) - (b.event.start_min as number));
  const out: Placed[] = [];
  let group: Placed[] = [];
  let groupEnd = -1;
  const flush = () => { group.forEach((p) => { p.lanes = Math.max(...group.map((g) => g.lane)) + 1; }); out.push(...group); group = []; };
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

const top = (min: number) => ((Math.max(min, FIRST_HOUR * 60) - FIRST_HOUR * 60) / 60) * HOUR_PX;

/** One week of your calendars as an hour grid (Monday first): previous / next week, an all-day row, a now line and a click on an empty slot to start an event there. */
export function WeekCalendar({ today, nowMin, status, onChanged, refreshKey }: {
  today: string; nowMin: number; status: GoogleStatusData | null; onChanged: () => void; refreshKey: number;
}) {
  const [week, setWeek] = useState(() => mondayOf(today));
  const [data, setData] = useState<DayEvents[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ day: string; start: string } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const days = useMemo(() => weekDays(`${week}/${addDays(week, 6)}`), [week]);
  const thisWeek = mondayOf(today);

  useEffect(() => {
    let live = true;
    Promise.all(days.map((day) => vaultApi.events(day).then((r) => ({ day, events: r.events, errors: r.errors })).catch(() => ({ day, events: [] as VaultEvent[], errors: ["Could not load"] }))))
      .then((all) => {
        if (!live) return;
        setData(all.map(({ day, events }) => ({ day, events })));
        setErrors([...new Set(all.flatMap((a) => a.errors))]);
      });
    return () => { live = false; };
  }, [days, refreshKey]);

  // Start the grid scrolled to about three hours before now, so the day's remaining events are in view.
  const scrolled = useRef(false);
  useEffect(() => {
    if (!data || scrolled.current || !scroller.current) return;
    scrolled.current = true;
    scroller.current.scrollTop = Math.max(0, top(nowMin) - 3 * HOUR_PX);
  }, [data, nowMin]);

  const go = useCallback((n: number) => { setWeek((w) => addDays(w, 7 * n)); setPicked(null); setDraft(null); }, []);
  const byDay = new Map((data ?? []).map((d) => [d.day, d.events]));
  const picks = new Map<string, VaultEvent>();
  days.forEach((day) => (byDay.get(day) ?? []).forEach((e, i) => picks.set(`${day}:${i}`, e)));
  const selected = picked ? picks.get(picked) ?? null : null;
  const next = (byDay.get(today) ?? []).filter((e) => e.start_min !== null && e.start_min > nowMin).sort((a, b) => (a.start_min as number) - (b.start_min as number))[0];
  const range = `${fmtDay(days[0], { day: "numeric", month: "short" })} – ${fmtDay(days[6], { day: "numeric", month: "short", year: "numeric" })}`;
  const btn = "min-h-8 border border-[var(--border)] px-2.5 text-xs font-semibold text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-40";

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pb-2">
        <span className="text-small font-semibold">{range}</span>
        <span className={MICRO}>{week === thisWeek ? "this week" : week > thisWeek ? "ahead" : "past"}</span>
        <span className="flex-1" />
        <span className="inline-flex" role="group" aria-label="Week">
          <button type="button" onClick={() => go(-1)} aria-label="Previous week" className={`${btn} inline-flex items-center`}><ChevronLeft size={14} aria-hidden="true" />Prev</button>
          <button type="button" onClick={() => { setWeek(thisWeek); setPicked(null); }} disabled={week === thisWeek} className={`${btn} border-x-0`}>This week</button>
          <button type="button" onClick={() => go(1)} aria-label="Next week" className={`${btn} inline-flex items-center`}>Next<ChevronRight size={14} aria-hidden="true" /></button>
        </span>
      </div>

      {errors.length > 0 && <p className="mb-2 text-xs text-[var(--destructive)]">Could not read: {errors.join(", ")}</p>}
      <div className="mb-2 min-h-[2.375rem]">
      {next && week === thisWeek && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-[var(--border)] px-3 py-1.5 text-small">
          <span className={MICRO}>Next up</span>
          <span className="font-mono font-medium tabular-nums text-[var(--accent)]">{formatMinutes(next.start_min as number)}</span>
          <span className="min-w-0 flex-1 truncate font-semibold">{next.title}</span>
          <span className={MICRO}>in {formatDuration((next.start_min as number) - nowMin)}</span>
          {next.meeting_url && <a href={next.meeting_url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-7 items-center border border-[var(--border)] px-2.5 text-xs font-semibold text-[var(--accent)] hover:bg-[var(--accent-light)]">Join {meetingName(next.meeting_url)}</a>}
        </div>
      )}
      </div>

      <div ref={scroller} className="max-h-[26rem] overflow-auto border border-[var(--border)]" role="grid" aria-label="Week schedule">
        <div className="grid min-w-[40rem] grid-cols-[2.5rem_repeat(7,minmax(0,1fr))]">
          <div className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--surface)]" />
          {days.map((day) => (
            <div key={day} className={`sticky top-0 z-10 flex items-baseline gap-1.5 border-b border-l border-[var(--border)] px-1.5 py-1.5 ${day === today ? "bg-[var(--accent-light)] shadow-[inset_0_-2px_0_var(--accent)]" : "bg-[var(--surface)]"}`}>
              <span className={`${MICRO} ${day === today ? "!text-[var(--accent)]" : ""}`}>{fmtDay(day, { weekday: "short" })}</span>
              <span className={`font-mono text-small font-medium tabular-nums ${day === today ? "text-[var(--accent)]" : ""}`}>{fmtDay(day, { day: "numeric" })}</span>
              {(byDay.get(day)?.length ?? 0) > 0 && <span className="ml-auto font-mono text-micro text-[var(--muted-foreground)]">{byDay.get(day)?.length}</span>}
            </div>
          ))}

          <div className="border-b border-[var(--border)] px-1 py-1.5 text-micro text-[var(--muted-foreground)]">All day</div>
          {days.map((day) => (
            <div key={day} className="flex min-h-7 flex-col gap-0.5 border-b border-l border-[var(--border)] p-0.5">
              {(byDay.get(day) ?? []).map((e, i) => e.all_day && (
                <button key={i} type="button" onClick={() => setPicked(`${day}:${i}`)} aria-pressed={picked === `${day}:${i}`} title={e.title}
                  className="truncate border-l-2 bg-[var(--muted)] px-1.5 text-left text-xs font-medium aria-pressed:outline aria-pressed:outline-1 aria-pressed:outline-[var(--foreground)]" style={{ borderColor: e.color ?? "var(--muted-foreground)" }}>{e.title}</button>
              ))}
            </div>
          ))}

          <div className="relative" style={{ height: GRID_PX }}>
            {Array.from({ length: LAST_HOUR - FIRST_HOUR }, (_, i) => (
              <span key={i} className="absolute right-1 -translate-y-1.5 font-mono text-micro text-[var(--muted-foreground)]" style={{ top: i * HOUR_PX }}>{String(FIRST_HOUR + i).padStart(2, "0")}</span>
            ))}
          </div>
          {days.map((day) => (
            <div key={day} role="gridcell" aria-label={`${fmtDay(day, { weekday: "long", day: "numeric", month: "long" })}: click an empty slot to add an event`}
              className={`relative cursor-cell border-l border-[var(--border)] ${day === today ? "bg-[var(--accent-light)]" : ""}`}
              style={{ height: GRID_PX, backgroundImage: "linear-gradient(var(--border) 1px, transparent 1px)", backgroundSize: `100% ${HOUR_PX}px` }}
              onClick={(ev) => {
                if (ev.target !== ev.currentTarget) return;
                const y = ev.clientY - ev.currentTarget.getBoundingClientRect().top;
                const half = Math.max(FIRST_HOUR * 2, Math.min((LAST_HOUR - 1) * 2, Math.round(((FIRST_HOUR + y / HOUR_PX) * 2))));
                setPicked(null);
                setDraft({ day, start: `${String(Math.floor(half / 2)).padStart(2, "0")}:${half % 2 ? "30" : "00"}` });
              }}>
              {place(day, byDay.get(day) ?? []).map(({ event: e, key, lane, lanes }) => {
                const colour = e.color ?? "var(--muted-foreground)";
                const tall = (e.end_min as number) - (e.start_min as number) >= 45;
                return (
                  <button key={key} type="button" onClick={() => { setPicked(key); setDraft(null); }} aria-pressed={picked === key} title={e.title}
                    className="absolute overflow-hidden border-l-2 px-1.5 py-0.5 text-left text-xs font-medium leading-[15px] aria-pressed:z-10 aria-pressed:outline aria-pressed:outline-1 aria-pressed:outline-[var(--foreground)]"
                    style={{ top: top(e.start_min as number), height: Math.max(20, top(e.end_min as number) - top(e.start_min as number) - 2), left: `calc(${(100 * lane) / lanes}% + 2px)`, width: `calc(${100 / lanes}% - 4px)`,
                      borderColor: colour, background: `color-mix(in srgb, ${colour} 16%, var(--surface))` }}>
                    {tall || lanes > 1 ? <><span className={lanes > 1 ? "block truncate" : ""}>{e.title}</span><span className="block font-mono text-micro text-[var(--muted-foreground)]">{formatMinutes(e.start_min as number)}</span></>
                      : <span className="block truncate">{e.title}</span>}
                  </button>
                );
              })}
              {day === today && <div className="pointer-events-none absolute inset-x-0 z-10 border-t border-[var(--destructive)]" style={{ top: top(nowMin) }}><span className="absolute -top-[4px] -left-px h-[7px] w-[7px] bg-[var(--destructive)]" /></div>}
            </div>
          ))}
        </div>
      </div>

      {selected && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border border-[var(--border)] px-3 py-2 text-small">
          <span className="font-semibold">{selected.title}</span>
          <span className="font-mono tabular-nums text-[var(--muted-foreground)]">{selected.all_day || selected.start_min === null || selected.end_min === null ? "All day" : `${formatMinutes(selected.start_min)}–${formatMinutes(selected.end_min)} · ${formatDuration(selected.end_min - selected.start_min)}`}</span>
          <span className="text-[var(--muted-foreground)]">{selected.calendar}{selected.location ? ` · ${selected.location}` : ""}</span>
          <span className="flex-1" />
          {selected.meeting_url && <a href={selected.meeting_url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-7 items-center border border-[var(--border)] px-2.5 text-xs font-semibold text-[var(--accent)] hover:bg-[var(--accent-light)]">Join {meetingName(selected.meeting_url)}</a>}
          <button type="button" onClick={() => setPicked(null)} className="min-h-7 px-2 text-xs font-semibold text-[var(--muted-foreground)] hover:text-[var(--foreground)]">Close</button>
        </div>
      )}

      {status?.connected && (
        <AddEventForm key={draft ? `${draft.day}-${draft.start}` : "today"} day={draft?.day ?? today} start={draft?.start}
          onChanged={() => { setDraft(null); onChanged(); }} onCancel={draft ? () => setDraft(null) : undefined} />
      )}
      {status?.configured && !status.connected && <ConnectButton />}
      {status && !status.configured && <p className="mt-2 text-xs text-[var(--muted-foreground)]">Google Calendar is not set up on the server yet.</p>}
    </div>
  );
}
