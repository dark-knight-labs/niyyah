"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError } from "@/lib/api-client";
import { useBlocks } from "@/lib/blocks";
import { isAuthenticated } from "@/lib/auth";
import { vaultApi } from "@/lib/vault-api";
import { GoogleStatusData, QuarterData, NotebooksData, VaultGoalsData, VaultObjectivesData, PipelinesData, VaultDayData, VaultEventsData, VaultLogEntry, VaultTaskData, HabitsData } from "@/lib/vault-types";
import { dateInTz, formatMinutes, hasLocation, nowMinutes, resolveDay, slotOwnerFor, VaultScheduleData } from "@/lib/routine";
import { useNow } from "@/hooks/use-now";
import { currentBlock } from "@/lib/ring";
import { TopBar } from "@/components/routine/top-bar";
import { LogList } from "@/components/routine/log-list";
import { NowCard } from "@/components/routine/now-card";
import { RoutineRing } from "@/components/routine/routine-ring";
import { TaskList } from "@/components/routine/task-list";
import { ThisWeek } from "@/components/routine/this-week";
import { HabitsPanel } from "@/components/routine/habits-panel";
import { VotesPanel } from "@/components/routine/votes-panel";
import { SleepSpan, useWeek, WeekCalendar, WeekToolbar } from "@/components/routine/week-calendar";
import { WorkLanes } from "@/components/routine/work-lanes";

const REFRESH_MS = 60_000;
/** Calendar, tasks and log share one tabbed panel on every screen size; keys 1, 2 and 3 switch between them. */
const SIDE_TABS = [["calendar", "Calendar"], ["tasks", "Tasks"], ["log", "Log"]] as const;

/** Overview, the home page: the day's clock, lists and votes, with Now / Next / Someday across every block at the end. */
export default function OverviewPage() {
  const blocks = useBlocks();
  const [schedule, setSchedule] = useState<VaultScheduleData | null>(null);
  const [today, setToday] = useState<VaultDayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  const [tasks, setTasks] = useState<VaultTaskData[]>([]);
  const [log, setLog] = useState<VaultLogEntry[]>([]);
  const [events, setEvents] = useState<VaultEventsData | null>(null);
  const [google, setGoogle] = useState<GoogleStatusData | null>(null);
  // Back from Google's consent screen: say how it went (a spinner renders first, so no hydration mismatch).
  const [calendarNote] = useState<string | null>(() => {
    const result = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("calendar");
    if (!result) return null;
    return result === "connected" ? "Google Calendar connected." : "Could not connect Google Calendar. Try again.";
  });
  const [pipelines, setPipelines] = useState<PipelinesData | null>(null);
  const [notebooks, setNotebooks] = useState<NotebooksData | null>(null);
  const [goals, setGoals] = useState<VaultGoalsData | null>(null);
  const [quarter, setQuarter] = useState<QuarterData | null>(null);
  const [objectives, setObjectives] = useState<VaultObjectivesData | null>(null);
  const [habits, setHabits] = useState<HabitsData | null>(null);
  const [side, setSide] = useState<(typeof SIDE_TABS)[number][0]>("calendar");
  const [calendarKey, setCalendarKey] = useState(0);
  const now = useNow(30_000);
  const dayToday = schedule ? dateInTz(now, schedule.meta.tz) : null;
  const week = useWeek(canEdit ? dayToday : null, calendarKey);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName)) return;
      const tab = SIDE_TABS["123".indexOf(e.key)];
      if (tab) setSide(tab[0]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const load = useCallback(() => {
    vaultApi
      .schedule()
      .then((s) => {
        setSchedule(s);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(
          err instanceof Error && (err as ApiError).status === 404
            ? "Calendar/Schedule.md is not in the synced vault yet. Push it and sync."
            : "Could not load the schedule — the API may be unreachable.",
        );
      })
      .finally(() => setLoading(false));

    // Mode is private decoration: only fetched with a session. 404 just means
    // no daily note synced yet.
    if (isAuthenticated()) {
      vaultApi.today().then(setToday).catch(() => setToday(null));
      vaultApi.editAccess().then((a) => setCanEdit(a.allowed)).catch(() => setCanEdit(false));
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const knownBlocks = useMemo(() => new Set(blocks.list.map((b) => b.key)), [blocks.list]);
  const needsLocation = !!schedule && !hasLocation(schedule.meta);
  const resolved = useMemo(() => {
    if (!schedule || needsLocation) return null;
    try {
      return { day: resolveDay(schedule, now, knownBlocks), failure: null };
    } catch (err) {
      return { day: null, failure: (err as Error).message };
    }
  }, [schedule, needsLocation, now, knownBlocks]);

  // Tasks, log lines and weekly objectives are private note text: only the vault owner's session can read them.
  const dayKey = schedule ? dateInTz(now, schedule.meta.tz) : null;
  const loadPrivate = useCallback(() => {
    if (!canEdit || !dayKey) return;
    vaultApi.tasks(dayKey).then(setTasks).catch(() => setTasks([]));
    vaultApi.log(dayKey).then(setLog).catch(() => setLog([]));
    vaultApi.events(dayKey).then(setEvents).catch(() => setEvents(null));
    setCalendarKey((k) => k + 1);
    vaultApi.googleStatus().then(setGoogle).catch(() => setGoogle(null));
    vaultApi.pipelines().then(setPipelines).catch(() => setPipelines(null));
    vaultApi.notebooks().then(setNotebooks).catch(() => setNotebooks(null));
    vaultApi.goals().then(setGoals).catch(() => setGoals(null));
    vaultApi.quarter().then(setQuarter).catch(() => setQuarter(null));
    vaultApi.objectives().then(setObjectives).catch(() => setObjectives(null));
    vaultApi.habits().then(setHabits).catch(() => setHabits(null));
    vaultApi.today().then(setToday).catch(() => setToday(null));
  }, [canEdit, dayKey]);

  // Drop the ?calendar= param so a reload does not repeat the note.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("calendar")) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  useEffect(() => {
    loadPrivate();
    const id = setInterval(loadPrivate, REFRESH_MS);
    return () => clearInterval(id);
  }, [loadPrivate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const problems = [
    ...(error ? [error] : []),
    ...(schedule?.errors ?? []),
    ...(resolved?.failure ? [resolved.failure] : []),
    ...(resolved?.day?.warnings ?? []),
  ];

  const dateLabel = schedule
    ? new Intl.DateTimeFormat("en-GB", { timeZone: schedule.meta.tz, weekday: "short", day: "numeric", month: "short" }).format(now)
    : "";
  const day = resolved?.day ?? null;
  const nowMin = schedule ? nowMinutes(now, schedule.meta.tz) : 0;
  const block = day ? currentBlock(day, nowMin) : undefined;
  const owner = canEdit && !!dayKey && !!day;
  const slotId = schedule ? slotOwnerFor(schedule, now) : null;
  // Sleep blocks of any day of the week, as minute spans, so the grid can grey them out. UTC noon keeps the date in every timezone the schedule can use.
  const sleepFor = (iso: string): SleepSpan[] => {
    if (!schedule) return [];
    try {
      return resolveDay(schedule, new Date(`${iso}T12:00:00Z`), knownBlocks).blocks
        .filter((b) => b.block === "sleep" || blocks.label(b.block).toLowerCase() === "sleep")
        .flatMap((b) => (b.endMin > 1440 ? [{ from: b.startMin, to: 1440 }, { from: 0, to: b.endMin - 1440 }] : [{ from: b.startMin, to: b.endMin }]));
    } catch {
      return [];
    }
  };

  return (
    <div className="w-full">
      {problems.length > 0 && (
        <div className="mb-4 space-y-0.5 border border-[var(--destructive)] bg-[var(--surface)] px-4 py-2 text-xs text-[var(--destructive)]">
          {problems.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      )}
      {calendarNote && <p role="status" className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-xs">{calendarNote}</p>}
      {needsLocation && (
        <div className="mx-auto max-w-xl rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center">
          <h2 className="font-serif text-xl">Set your location</h2>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">Prayer times anchor your clock. Add your city and calculation method in Settings.</p>
          <Link href="/settings" className="mt-4 inline-block rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-fg)]">Open Settings</Link>
        </div>
      )}
      {schedule && day && (
        <>
          <TopBar dateLabel={dateLabel} city={schedule.meta.city} editDay={owner ? dayKey : null} today={today} onSaved={setToday}
            goals={owner ? goals?.items ?? null : null} quarter={owner ? quarter : null}
            onTick={async (id, done) => setGoals(await vaultApi.tickGoalItem(id, done))} />
          {owner ? (
            <>
              <div className="mb-5 grid gap-6 md:items-start xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.7fr)_minmax(0,0.8fr)] xl:gap-6">
                <div className="mx-auto w-full max-w-lg xl:max-w-none">
                  <div className="font-clock"><RoutineRing day={day} nowMin={nowMin} events={events?.events} /></div>
                  <div className="font-clock"><NowCard day={day} nowMin={nowMin} /></div>
                </div>
                <section aria-label="Calendar, tasks and log" className="min-w-0">
                  <div role="tablist" aria-label="Calendar, tasks and log" className="mb-3 flex flex-wrap items-end gap-x-3 border-b border-[var(--border)]">
                    {SIDE_TABS.map(([key, label], i) => {
                      const count = key === "calendar" ? `${events?.events.length ?? 0}` : key === "tasks" ? `${tasks.filter((t) => t.done).length}/${tasks.length}` : `${log.length}`;
                      return (
                        <button key={key} type="button" role="tab" id={`tab-${key}`} aria-selected={side === key} aria-controls={`panel-${key}`} onClick={() => setSide(key)}
                          className="-mb-px flex min-h-10 items-center gap-2 whitespace-nowrap border-b-2 border-transparent px-3.5 text-small font-semibold text-[var(--muted-foreground)] hover:text-[var(--foreground)] aria-selected:border-[var(--accent)] aria-selected:text-[var(--foreground)]">
                          {label}<span className="font-mono text-micro font-normal tabular-nums text-[var(--muted-foreground)]">{count}</span>
                          <kbd className="hidden border border-[var(--border)] px-1 font-mono text-micro font-normal text-[var(--muted-foreground)] xl:inline">{i + 1}</kbd>
                        </button>
                      );
                    })}
                                      {side === "calendar" && <WeekToolbar week={week} />}
                  </div>
                  <div role="tabpanel" id="panel-calendar" aria-labelledby="tab-calendar" hidden={side !== "calendar"}>
                    <WeekCalendar week={week} nowMin={nowMin} status={google} sleepFor={sleepFor} onChanged={loadPrivate} />
                  </div>
                  <div role="tabpanel" id="panel-tasks" aria-labelledby="tab-tasks" hidden={side !== "tasks"}><TaskList day={dayKey} tasks={tasks} onChanged={loadPrivate} /></div>
                  <div role="tabpanel" id="panel-log" aria-labelledby="tab-log" hidden={side !== "log"}>
                    <LogList day={dayKey} entries={log} onChanged={loadPrivate}
                      section={block ? blocks.label(block.block) : "Day"}
                      span={block ? `${formatMinutes(block.startMin)}-${formatMinutes(block.endMin)}` : "00:00-23:59"} />
                  </div>
                </section>
                <div className="mx-auto w-full max-w-lg xl:max-w-none"><ThisWeek quarter={quarter} objectives={objectives} onChanged={loadPrivate} /></div>
              </div>
              {habits && <div className="mb-5"><HabitsPanel day={dayKey} data={habits} today={today} onData={setHabits} onVoted={setToday} /></div>}
              <div className="mb-5"><VotesPanel day={dayKey} today={today} onSaved={setToday} current={block?.block} /></div>
              {pipelines && <WorkLanes data={pipelines} notebooks={notebooks} ot={slotId ?? undefined} onChanged={loadPrivate} />}
            </>
          ) : (
            <div className="mx-auto max-w-xl">
              <div className="font-clock"><RoutineRing day={day} nowMin={nowMin} /></div>
              <div className="mt-6">
                <div className="font-clock"><NowCard day={day} nowMin={nowMin} /></div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
