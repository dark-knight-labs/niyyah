"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError } from "@/lib/api-client";
import { isAuthenticated } from "@/lib/auth";
import { vaultApi } from "@/lib/vault-api";
import { GoogleStatusData, NotebooksData, VaultGoalsData, PipelinesData, VaultDayData, VaultEventsData, VaultLogEntry, VaultTaskData } from "@/lib/vault-types";
import { ROUTINE_BLOCKS, dateInTz, formatMinutes, nowMinutes, resolveDay, VaultScheduleData } from "@/lib/routine";
import { PLANNER_TZ, otStreamFor, toMeta } from "@/lib/streams";
import { useNow } from "@/hooks/use-now";
import { currentBlock } from "@/lib/ring";
import { CalendarCard } from "@/components/routine/calendar-card";
import { DayHeader } from "@/components/routine/day-header";
import { GoalCards } from "@/components/routine/goal-cards";
import { LogList } from "@/components/routine/log-list";
import { NowCard } from "@/components/routine/now-card";
import { RoutineRing } from "@/components/routine/routine-ring";
import { TaskList } from "@/components/routine/task-list";
import { VotesPanel } from "@/components/routine/votes-panel";
import { WorkLanes } from "@/components/routine/work-lanes";

const REFRESH_MS = 60_000;

/** Overview, the home page: the day's clock, lists and votes, with Now / Next / Someday across every block at the end. */
export default function OverviewPage() {
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
  const now = useNow(30_000);

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

  const resolved = useMemo(() => {
    if (!schedule) return null;
    try {
      return { day: resolveDay(schedule, now), failure: null };
    } catch (err) {
      return { day: null, failure: (err as Error).message };
    }
  }, [schedule, now]);

  // Tasks, log lines and weekly objectives are private note text: only the vault owner's session can read them.
  const dayKey = schedule ? dateInTz(now, schedule.meta.tz) : null;
  const loadPrivate = useCallback(() => {
    if (!canEdit || !dayKey) return;
    vaultApi.tasks(dayKey).then(setTasks).catch(() => setTasks([]));
    vaultApi.log(dayKey).then(setLog).catch(() => setLog([]));
    vaultApi.events(dayKey).then(setEvents).catch(() => setEvents(null));
    vaultApi.googleStatus().then(setGoogle).catch(() => setGoogle(null));
    vaultApi.pipelines().then(setPipelines).catch(() => setPipelines(null));
    vaultApi.notebooks().then(setNotebooks).catch(() => setNotebooks(null));
    vaultApi.goals().then(setGoals).catch(() => setGoals(null));
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
  const slot = pipelines ? otStreamFor(now, PLANNER_TZ, pipelines.streams.map(toMeta)) : undefined;

  return (
    <div className="mx-auto w-full max-w-[110rem]">
      {problems.length > 0 && (
        <div className="mb-4 space-y-0.5 rounded-xl border border-[var(--destructive)] bg-[var(--surface)] px-4 py-2 text-xs text-[var(--destructive)]">
          {problems.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      )}
      {calendarNote && <p role="status" className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-xs">{calendarNote}</p>}
      {schedule && day && (
        <>
          <DayHeader dateLabel={dateLabel} city={schedule.meta.city} editDay={owner ? dayKey : null} today={today} onSaved={setToday}>
            {owner && goals && <GoalCards data={goals} />}
          </DayHeader>
          {owner ? (
            <>
              <div className="mb-4"><VotesPanel day={dayKey} today={today} onSaved={setToday} current={block?.block} /></div>
              <div className="mb-5 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[repeat(3,minmax(0,1fr))] xl:gap-8 md:items-start">
                <div className="md:col-span-2 xl:col-span-1">
                  <RoutineRing day={day} nowMin={nowMin} events={events?.events} />
                  <NowCard day={day} nowMin={nowMin} />
                </div>
                <div>
                  <TaskList day={dayKey} tasks={tasks} onChanged={loadPrivate} />
                  <LogList day={dayKey} entries={log} onChanged={loadPrivate}
                    section={block ? ROUTINE_BLOCKS[block.block].label : "Day"}
                    span={block ? `${formatMinutes(block.startMin)}-${formatMinutes(block.endMin)}` : "00:00-23:59"} />
                </div>
                <div className="md:col-span-2 xl:col-span-1">
                  <CalendarCard day={dayKey} data={events} status={google} onChanged={loadPrivate} />
                </div>
              </div>
              {pipelines && <WorkLanes data={pipelines} notebooks={notebooks} ot={slot?.id} onChanged={loadPrivate} />}
            </>
          ) : (
            <div className="mx-auto max-w-xl">
              <RoutineRing day={day} nowMin={nowMin} />
              <div className="mt-6">
                <NowCard day={day} nowMin={nowMin} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
