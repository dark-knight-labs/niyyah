"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError } from "@/lib/api-client";
import { useBlocks } from "@/lib/blocks";
import { isAuthenticated } from "@/lib/auth";
import { vaultApi } from "@/lib/vault-api";
import { GoogleStatusData, QuarterData, NotebooksData, VaultGoalsData, VaultObjectivesData, PipelinesData, VaultDayData, VaultEventsData, HabitsData } from "@/lib/vault-types";
import { dateInTz, hasLocation, nowMinutes, resolveDay, slotOwnerFor, VaultScheduleData } from "@/lib/routine";
import { useNow } from "@/hooks/use-now";
import { currentBlock } from "@/lib/ring";
import { TopBar } from "@/components/routine/top-bar";
import { NowCard } from "@/components/routine/now-card";
import { RoutineRing } from "@/components/routine/routine-ring";
import { ThisWeek } from "@/components/routine/this-week";
import { HabitsPanel } from "@/components/routine/habits-panel";
import { VotesPanel } from "@/components/routine/votes-panel";
import { SleepSpan, useWeek, WeekCalendar, WeekToolbar } from "@/components/routine/week-calendar";
import { WorkLanes } from "@/components/routine/work-lanes";
import { toMeta } from "@/lib/streams";

const REFRESH_MS = 60_000;

/** Overview, the home page: the day's clock, lists and votes, with Now / Next / Someday across every block at the end. */
export default function OverviewPage() {
  const blocks = useBlocks();
  const [schedule, setSchedule] = useState<VaultScheduleData | null>(null);
  const [today, setToday] = useState<VaultDayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
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
  const [calendarKey, setCalendarKey] = useState(0);
  /** Which of the two panes fills both columns; null shows them side by side. */
  const [expanded, setExpanded] = useState<"clock" | "calendar" | null>(null);
  const toggle = (pane: "clock" | "calendar") => setExpanded((e) => (e === pane ? null : pane));
  const now = useNow(30_000);
  const dayToday = schedule ? dateInTz(now, schedule.meta.tz) : null;
  const week = useWeek(canEdit ? dayToday : null, calendarKey);

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

  // Tasks and weekly objectives are private note text: only the vault owner's session can read them.
  const dayKey = schedule ? dateInTz(now, schedule.meta.tz) : null;
  // The calendar (today's events, Google status, the week grid) is slow, since it reads outside calendars; the rest is local and fast.
  // Edits to a pipeline, goal or task reload only the planner, so they never repeat the calendar fetch.
  const loadPlanner = useCallback(() => {
    if (!canEdit || !dayKey) return;
    vaultApi.pipelines().then(setPipelines).catch(() => setPipelines(null));
    vaultApi.notebooks().then(setNotebooks).catch(() => setNotebooks(null));
    vaultApi.goals().then(setGoals).catch(() => setGoals(null));
    vaultApi.quarter().then(setQuarter).catch(() => setQuarter(null));
    vaultApi.objectives().then(setObjectives).catch(() => setObjectives(null));
    vaultApi.habits().then(setHabits).catch(() => setHabits(null));
    vaultApi.today().then(setToday).catch(() => setToday(null));
  }, [canEdit, dayKey]);
  const loadToday = useCallback(() => {
    if (!canEdit || !dayKey) return;
    vaultApi.events(dayKey).then(setEvents).catch(() => setEvents(null));
  }, [canEdit, dayKey]);
  const loadCalendar = useCallback(() => {
    if (!canEdit || !dayKey) return;
    loadToday();
    setCalendarKey((k) => k + 1);
    vaultApi.googleStatus().then(setGoogle).catch(() => setGoogle(null));
  }, [canEdit, dayKey, loadToday]);
  const loadPrivate = useCallback(() => { loadPlanner(); loadCalendar(); }, [loadPlanner, loadCalendar]);

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
              <div className={`mb-5 grid gap-4 md:items-start ${expanded ? "" : "xl:grid-cols-[minmax(0,min(30rem,25.7%))_minmax(0,1fr)]"}`}>
                <div className={`mx-auto w-full xl:max-w-none ${expanded === "calendar" ? "hidden" : expanded === "clock" ? "" : "max-w-lg"}`}>
                  <div className="font-clock"><RoutineRing day={day} nowMin={nowMin} events={events?.events} expanded={expanded === "clock"} onToggleExpand={() => toggle("clock")} /></div>
                  <div className="font-clock"><NowCard day={day} nowMin={nowMin} /></div>
                  <div className="mt-4"><ThisWeek quarter={quarter} objectives={objectives} onChanged={loadPlanner} /></div>
                </div>
                <section aria-label="Calendar" className={`min-w-0 ${expanded === "clock" ? "hidden" : ""}`}>
                  <div className="mb-2 flex min-h-8 items-center border-b border-[var(--border)] pb-1.5">
                    <WeekToolbar week={week} status={google} expanded={expanded === "calendar"} onExpand={() => toggle("calendar")} onAdded={() => { week.reload(); loadToday(); loadPlanner(); }} />
                  </div>
                  <WeekCalendar week={week} streams={quarter?.streams.map(toMeta) ?? []} nowMin={nowMin} status={google} sleepFor={sleepFor} onChanged={loadPlanner} onEventsChanged={loadToday} />
                </section>
              </div>
              {habits && <div className="mb-5"><HabitsPanel day={dayKey} data={habits} today={today} onData={setHabits} onVoted={setToday} /></div>}
              <div className="mb-5"><VotesPanel day={dayKey} today={today} onSaved={setToday} current={block?.block} /></div>
              {pipelines && <WorkLanes data={pipelines} notebooks={notebooks} ot={slotId ?? undefined} onChanged={loadPlanner} />}
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
