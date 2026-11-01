"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useNow } from "@/hooks/use-now";
import { usePref } from "@/hooks/use-pref";
import { ApiError } from "@/lib/api-client";
import { useBlocks } from "@/lib/blocks";
import {
  blockColours, CalDay, resolveIso, RING_VARIANTS, RingVariant, SHADE_MODES, ShadeMode, tagCounts, VIEW_IDS, ViewId, viewName, VIEWS,
} from "@/lib/calendar";
import { itemRef } from "@/lib/items";
import { dateInTz, hasLocation, nowMinutes, VaultScheduleData } from "@/lib/routine";
import { StreamMeta, toMeta } from "@/lib/streams";
import { vaultApi } from "@/lib/vault-api";
import type { GoogleStatusData, ItemData } from "@/lib/vault-types";
import { addDays, fmtDay } from "@/lib/week";
import { QuickAdd } from "@/components/routine/calendar-parts";
import { SleepSpan, useWeek, WeekCalendar } from "@/components/routine/week-calendar";
import { CHIP, DayPicker, RingPicker, ShadePicker, TagFilter, ViewSwitcher, WeekPager } from "@/components/calendar/calendar-toolbar";
import { ItemHandlers } from "@/components/calendar/item-bits";
import { ItemPanel } from "@/components/calendar/item-panel";
import { DayGrid } from "@/components/calendar/day-grid";
import { DayAgenda } from "@/components/calendar/day-agenda";
import { DayRibbon } from "@/components/calendar/day-ribbon";
import { DayRing } from "@/components/calendar/day-ring";
import { WeekAgenda } from "@/components/calendar/week-agenda";
import { WeekStrips } from "@/components/calendar/week-strips";
import { WeekRings } from "@/components/calendar/week-rings";
import { WeekBlocks } from "@/components/calendar/week-blocks";

/** Stored UI choices (localStorage), like the skin and the Progress range. */
const VIEW_KEY = "niy-calendar-view";
const RING_KEY = "niy-calendar-ring";
const SHADE_KEY = "niy-calendar-shade";

/**
 * Calendar: the week's items (own items and calendar events, one read) in nine views that V rotates through. Day views
 * have a day picker, week views a week pager; a picked item opens its details card beside the view (a sheet on phones).
 */
export default function CalendarPage() {
  const blocks = useBlocks();
  const [schedule, setSchedule] = useState<VaultScheduleData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState<boolean | null>(null);
  const [streams, setStreams] = useState<StreamMeta[]>([]);
  const [google, setGoogle] = useState<GoogleStatusData | null>(null);
  const [view, setView] = usePref<ViewId>(VIEW_KEY, "week-grid", VIEW_IDS);
  const [variant, setVariant] = usePref<RingVariant>(RING_KEY, "A", RING_VARIANTS);
  const [shade, setShade] = usePref<ShadeMode>(SHADE_KEY, "shade", SHADE_MODES);
  const [tag, setTag] = useState<string | null>(null);
  const [focusDay, setFocusDay] = useState<string | null>(null);
  const now = useNow(30_000);
  const tz = schedule?.meta.tz;
  const today = tz ? dateInTz(now, tz) : null;
  const nowMin = tz ? nowMinutes(now, tz) : 0;
  const week = useWeek(canEdit ? today : null, 0);
  const focus = focusDay && week.days.includes(focusDay) ? focusDay : today && week.days.includes(today) ? today : week.days[0] ?? null;
  const scope = VIEWS.find((v) => v.id === view)!.scope;

  useEffect(() => {
    vaultApi.schedule().then((s) => { setSchedule(s); setError(null); }).catch((err: unknown) => {
      setError(err instanceof Error && (err as ApiError).status === 404 ? "Calendar/Schedule.md is not in the synced vault yet." : "Could not load the schedule. The API may be unreachable.");
    });
    vaultApi.editAccess().then((a) => setCanEdit(a.allowed)).catch(() => setCanEdit(false));
  }, []);
  useEffect(() => {
    if (!canEdit) return;
    vaultApi.quarter().then((q) => setStreams(q.streams.map(toMeta))).catch(() => setStreams([]));
    vaultApi.googleStatus().then(setGoogle).catch(() => setGoogle(null));
  }, [canEdit]);

  const known = useMemo(() => new Set(blocks.list.map((b) => b.key)), [blocks.list]);
  const resolved = useMemo(() => {
    if (!schedule || !hasLocation(schedule.meta)) return {} as Record<string, ReturnType<typeof resolveIso>>;
    return Object.fromEntries(week.days.map((iso) => [iso, resolveIso(schedule, iso, known)]));
  }, [schedule, week.days, known]);
  const { byDay } = week.items;
  const days: CalDay[] = useMemo(() => week.days.map((iso) => ({
    iso, day: resolved[iso] ?? null, items: byDay[iso] ?? [], today: iso === today, past: !!today && iso < today, nowMin: iso === today ? nowMin : null,
  })), [week.days, resolved, byDay, today, nowMin]);
  const colourMap = useMemo(() => Object.fromEntries(days.map((d) => [d.iso, d.day ? blockColours(d.day.blocks, blocks.color, shade) : []])), [days, blocks.color, shade]);
  const colours = useCallback((iso: string) => colourMap[iso] ?? [], [colourMap]);
  const tags = useMemo(() => tagCounts(days.flatMap((d) => d.items)), [days]);
  const sleepFor = useCallback((iso: string): SleepSpan[] => (resolved[iso]?.blocks ?? [])
    .filter((b) => b.block === "sleep" || blocks.label(b.block).toLowerCase() === "sleep")
    .flatMap((b) => (b.endMin > 1440 ? [{ from: b.startMin, to: 1440 }, { from: 0, to: b.endMin - 1440 }] : [{ from: b.startMin, to: b.endMin }])), [resolved, blocks]);

  const goDay = useCallback((iso: string) => { setFocusDay(iso); week.show(iso); }, [week]);
  const rotate = (n: number) => { const i = VIEW_IDS.indexOf(view); setView(VIEW_IDS[(i + n + VIEW_IDS.length) % VIEW_IDS.length]); };
  const step = (n: number) => { if (focus) goDay(addDays(focus, scope === "day" ? n : 7 * n)); };
  const toToday = () => { setFocusDay(null); week.goToday(); };
  const focusAdd = () => document.getElementById("quick-add-title")?.focus();
  useHotkeys({
    v: () => rotate(1),
    "shift+v": () => rotate(-1),
    "[": () => step(-1),
    "]": () => step(1),
    t: toToday,
    d: () => week.setShowDone(!week.showDone),
    n: focusAdd,
    "/": focusAdd,
    Escape: () => week.setPicked(null),
  });

  const colourOf = useCallback((i: ItemData) => (i.kind === "task" ? streams.find((s) => s.id === i.stream)?.color ?? "var(--accent)" : i.color ?? "var(--muted-foreground)"), [streams]);
  const { items, picked, setPicked } = week;
  const h: ItemHandlers = {
    picked, colourOf,
    onPick: (i) => { const ref = itemRef(i); setPicked(picked === ref ? null : ref); },
    onToggle: (i) => { const status = i.done ? "open" : "done"; void (i.kind === "task" ? items.patch(i, { status }) : items.annotate(i, { status })); },
    dimmed: (i) => !!tag && !i.products.includes(tag),
  };

  if (error) return <p role="alert" className="border border-[var(--destructive)] bg-[var(--surface)] px-4 py-2 text-xs text-[var(--destructive)]">{error}</p>;
  if (!schedule || canEdit === null) return <div className="flex h-64 items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" /></div>;
  if (!hasLocation(schedule.meta)) {
    return (
      <div className="mx-auto max-w-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center">
        <h2 className="font-serif text-xl">Set your location</h2>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">Prayer times anchor the calendar. Add your city and calculation method in Settings.</p>
        <Link href="/settings" className="mt-4 inline-block bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-fg)]">Open Settings</Link>
      </div>
    );
  }
  if (!canEdit) return <p className="text-sm text-[var(--muted-foreground)]">The calendar shows the vault owner&apos;s items. Sign in with the owner&apos;s account to see it.</p>;
  if (!today || !focus || !days.length) return null;

  const cd = days.find((d) => d.iso === focus) ?? days[0];
  const showsRing = view === "day-ring" || view === "week-rings";
  const doneCount = days.reduce((n, d) => n + d.items.filter((i) => i.kind === "task" && i.done).length, 0);
  const heading = scope === "day" ? fmtDay(focus, { weekday: "long", day: "numeric", month: "long" }) : `${fmtDay(days[0].iso, { day: "numeric", month: "short" })} – ${fmtDay(days[6].iso, { day: "numeric", month: "short", year: "numeric" })}`;

  return (
    <div className="w-full min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-[var(--border)] pb-2">
        <div className="min-w-0">
          <p className="mono text-[var(--muted-foreground)]">Calendar · {viewName(view)}</p>
          <h1 className="font-serif text-2xl font-medium leading-tight">{heading}</h1>
        </div>
        {week.errors.length > 0 && <p className="text-xs text-[var(--destructive)]" title={week.errors.join("\n")}>{week.errors[0]}</p>}
      </div>

      <div className="mt-3"><QuickAdd day={focus} connected={!!google?.connected} streams={streams} onCreate={items.create} onAdded={week.reload} /></div>

      <div className="mt-3 grid gap-2">
        <ViewSwitcher view={view} onView={setView} onRotate={() => rotate(1)} />
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {scope === "day"
            ? <DayPicker days={week.days} focus={focus} today={today} onDay={goDay} />
            : <WeekPager days={week.days} thisWeek={week.isThisWeek} onStep={step} onToday={toToday} />}
          {view === "week-grid" && (
            <button type="button" onClick={() => week.setShowDone(!week.showDone)} aria-pressed={week.showDone} aria-keyshortcuts="d" title={`${week.showDone ? "Hide" : "Show"} done tasks (d)`} className={`${CHIP} gap-1.5`}>
              Done <span className="font-mono tabular-nums">{doneCount}</span>
            </button>
          )}
          {showsRing && <RingPicker variant={variant} onVariant={setVariant} />}
          {view !== "week-grid" && <ShadePicker shade={shade} onShade={setShade} />}
        </div>
        <TagFilter tags={tags} tag={tag} onTag={setTag} />
      </div>

      <div className={`mt-3 grid items-start gap-4 ${week.selected ? "lg:grid-cols-[minmax(0,1fr)_24rem]" : ""}`}>
        <section aria-label={viewName(view)} data-cal-view={view} className="min-w-0">
          {view === "day-grid" && <DayGrid cd={cd} colours={colours(cd.iso)} h={h} />}
          {view === "day-agenda" && <DayAgenda cd={cd} colours={colours(cd.iso)} h={h} />}
          {view === "day-ribbon" && <DayRibbon cd={cd} colours={colours(cd.iso)} h={h} />}
          {view === "day-ring" && <DayRing cd={cd} variant={variant} colours={colours(cd.iso)} h={h} />}
          {view === "week-grid" && (
            <WeekCalendar week={week} streams={streams} nowMin={nowMin} status={google} sleepFor={sleepFor} card={false} dimmed={h.dimmed}
              onChanged={() => {}} onEventsChanged={() => {}} />
          )}
          {view === "week-agenda" && <WeekAgenda days={days} colours={colours} h={h} />}
          {view === "week-strips" && <WeekStrips days={days} colours={colours} h={h} />}
          {view === "week-rings" && <WeekRings days={days} variant={variant} colours={colours} h={h} onOpenDay={(iso) => { goDay(iso); setView("day-ring"); }} />}
          {view === "week-blocks" && <WeekBlocks days={days} colours={colours} />}
        </section>
        <ItemPanel week={week} streams={streams} />
      </div>
    </div>
  );
}
