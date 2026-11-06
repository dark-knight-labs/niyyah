"use client";

import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useHeaderSlot } from "@/hooks/use-header-slot";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { usePref } from "@/hooks/use-pref";
import { useBlocks } from "@/lib/blocks";
import { blockColours, CalDay, dayBands, prayerMarks, resolveIso, RING_VARIANTS, RingVariant, SHADE_MODES, ShadeMode, tagCounts, VIEW_IDS, ViewId, viewName, VIEWS } from "@/lib/calendar";
import { itemRef } from "@/lib/items";
import { VaultScheduleData } from "@/lib/routine";
import { StreamMeta } from "@/lib/streams";
import type { GoogleStatusData, ItemData } from "@/lib/vault-types";
import { addDays, fmtDay } from "@/lib/week";
import { QuickAdd } from "@/components/routine/calendar-parts";
import { Week, WeekBand, WeekCalendar } from "@/components/routine/week-calendar";
import { CalendarBar, rangeLabel } from "@/components/calendar/calendar-toolbar";
import { ItemHandlers } from "@/components/calendar/item-bits";
import { ItemPanel } from "@/components/calendar/item-panel";
import { DayGrid } from "@/components/calendar/day-grid";
import { DayAgenda } from "@/components/calendar/day-agenda";
import { DayRibbon } from "@/components/calendar/day-ribbon";
import { DayRing } from "@/components/calendar/day-ring";
import { WeekAgenda } from "@/components/calendar/week-agenda";
import { WeekStrips } from "@/components/calendar/week-strips";
import { WeekBlocks } from "@/components/calendar/week-blocks";

const NO_BANDS: WeekBand[] = [];

/** Stored UI choices (localStorage), like the skin and the Progress range. */
const VIEW_KEY = "niy-calendar-view";
const RING_KEY = "niy-calendar-ring";
const SHADE_KEY = "niy-calendar-shade";

/**
 * The calendar on the home page: the one bar row, then the week's items (own items and calendar events, one read) in eight views
 * that V rotates through. `week` is the home page's one useWeek; edits tell the page through `onChanged` (planner) and
 * `onEventsChanged` (today's events). A picked item opens its details beside the view (a sheet on phones).
 * On wide screens the bar renders into the app header (one row less); crossing that width moves it, which remounts it (typed
 * quick-add text and an open menu are dropped).
 */
export function CalendarView({ week, schedule, today, nowMin, streams, google, sidebar, onSidebar, onChanged, onEventsChanged, barExtra }: {
  week: Week; schedule: VaultScheduleData; today: string; nowMin: number; streams: StreamMeta[]; google: GoogleStatusData | null;
  sidebar: boolean; onSidebar: () => void; onChanged: () => void; onEventsChanged: () => void;
  /** Shown in the bar after the range (the day's mode and stars while the sidebar is hidden). */
  barExtra?: ReactNode;
}) {
  const slot = useHeaderSlot();
  const blocks = useBlocks();
  const [stored, setStored] = usePref<ViewId>(VIEW_KEY, "week-grid", VIEW_IDS);
  // The week opens as Grid: a stored week style (this session's pick aside) is not reopened on load. Day styles are remembered.
  const [weekPicked, setWeekPicked] = useState(false);
  // On a phone with no stored choice the calendar opens on one day. Decided after mount (no hydration mismatch) and never stored: the first pick replaces it.
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    try { if (localStorage.getItem(VIEW_KEY) === null && window.matchMedia("(max-width: 767px)").matches) setPhone(true); } catch { /* no storage: keep the default */ }
  }, []);
  const storedScope = VIEWS.find((x) => x.id === stored)!.scope;
  const view: ViewId = phone ? "day-grid" : storedScope === "week" && !weekPicked ? "week-grid" : stored;
  const setView = (v: ViewId) => { setPhone(false); setWeekPicked(VIEWS.find((x) => x.id === v)!.scope === "week"); setStored(v); };
  const [variant, setVariant] = usePref<RingVariant>(RING_KEY, "A", RING_VARIANTS);
  const [shade, setShade] = usePref<ShadeMode>(SHADE_KEY, "shade", SHADE_MODES);
  const [tag, setTag] = useState<string | null>(null);
  const [focusDay, setFocusDay] = useState<string | null>(null);
  const scope = VIEWS.find((v) => v.id === view)!.scope;
  // The last day style: Day and a week header's "open this day" go back to it (Week always opens Grid).
  const last = useRef<{ day: ViewId }>({ day: "day-grid" });
  useEffect(() => { if (scope === "day") last.current.day = view; }, [scope, view]);
  const focus = (focusDay && week.days.includes(focusDay) ? focusDay : week.days.includes(today) ? today : week.days[0]) as string;

  const known = useMemo(() => new Set(blocks.list.map((b) => b.key)), [blocks.list]);
  const resolved = useMemo(() => Object.fromEntries(week.days.map((iso) => [iso, resolveIso(schedule, iso, known)])), [schedule, week.days, known]);
  const { byDay } = week.items;
  const days: CalDay[] = useMemo(() => week.days.map((iso) => ({
    iso, day: resolved[iso] ?? null, items: byDay[iso] ?? [], today: iso === today, past: iso < today, nowMin: iso === today ? nowMin : null,
  })), [week.days, resolved, byDay, today, nowMin]);
  const colourMap = useMemo(() => Object.fromEntries(days.map((d) => [d.iso, d.day ? blockColours(d.day.blocks, blocks.color, shade) : []])), [days, blocks.color, shade]);
  const colours = useCallback((iso: string) => colourMap[iso] ?? [], [colourMap]);
  const tags = useMemo(() => tagCounts(days.flatMap((d) => d.items)), [days]);
  // One read of every day's bands per week (the grid asks for them per hour and per render): they change with the schedule, the week and the block names.
  const bandMap = useMemo(() => Object.fromEntries(week.days.map((iso): [string, WeekBand[]] => [iso, dayBands(schedule, iso, known).map((b) => ({
    ...b, colour: blocks.color(b.block), sleep: b.block === "sleep" || blocks.label(b.block).toLowerCase() === "sleep", name: blocks.label(b.block),
  }))])), [schedule, week.days, known, blocks]);
  const bandsFor = useCallback((iso: string): WeekBand[] => bandMap[iso] ?? NO_BANDS, [bandMap]);
  const prayersFor = useCallback((iso: string) => (resolved[iso] ? prayerMarks(resolved[iso], null) : []), [resolved]);

  const goDay = useCallback((iso: string) => { setFocusDay(iso); week.show(iso); }, [week]);
  const rotate = (n: number) => { const i = VIEW_IDS.indexOf(view); setView(VIEW_IDS[(i + n + VIEW_IDS.length) % VIEW_IDS.length]); };
  const step = (n: number) => goDay(addDays(focus, scope === "day" ? n : 7 * n));
  const toToday = () => { setFocusDay(null); week.goToday(); };
  const openDay = (iso: string) => { goDay(iso); setView(last.current.day); };
  const focusAdd = () => document.getElementById("quick-add-title")?.focus();
  useHotkeys({
    "mod+b": onSidebar,
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
    onToggle: (i) => { const status = i.done ? "open" : "done"; void (i.kind === "task" ? items.patch(i, { status }) : items.annotate(i, { status })).then((ok) => ok && onChanged()); },
    dimmed: (i) => !!tag && !i.products.includes(tag),
  };

  if (!days.length) return null;
  const cd = days.find((d) => d.iso === focus) ?? days[0];
  const doneCount = days.reduce((n, d) => n + d.items.filter((i) => i.kind === "task" && i.done).length, 0);
  const range = scope === "day" ? fmtDay(focus, { weekday: "short", day: "numeric", month: "short" }) : rangeLabel(days[0].iso, days[6].iso);
  const rangeLong = scope === "day" ? fmtDay(focus, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : `${range} ${fmtDay(days[6].iso, { year: "numeric" })}`;
  const added = () => { week.reload(); onEventsChanged(); onChanged(); };

  const bar = (
      <CalendarBar
        placement={slot ? "header" : "page"}
        sidebar={sidebar} onSidebar={onSidebar}
        scope={scope} onScope={(s) => setView(s === "week" ? "week-grid" : last.current.day)}
        view={view} onView={setView}
        onStep={step} onToday={toToday} atToday={scope === "day" ? focus === today && week.isThisWeek : week.isThisWeek}
        range={range} rangeLong={rangeLong}
        tags={tags} tag={tag} onTag={setTag}
        showDone={week.showDone} onShowDone={week.setShowDone} doneCount={doneCount}
        variant={variant} onVariant={setVariant} showsRing={view === "day-ring"}
        shade={shade} onShade={setShade}
        errors={week.errors} google={google} extra={barExtra}
        quickAdd={<QuickAdd floating={!!slot} focus={focus} today={today} days={week.days} connected={!!google?.connected} streams={streams} onCreate={items.create} onAdded={added} />}
      />
  );

  return (
    <div className="w-full min-w-0">
      {slot ? createPortal(bar, slot) : bar}

      <div className={`grid items-start gap-4 ${week.selected ? "lg:grid-cols-[minmax(0,1fr)_22rem]" : ""}`}>
        <section aria-label={viewName(view)} data-cal-view={view} className="min-w-0">
          {view === "day-grid" && <DayGrid cd={cd} colours={colours(cd.iso)} h={h} />}
          {view === "day-agenda" && <DayAgenda cd={cd} colours={colours(cd.iso)} h={h} />}
          {view === "day-ribbon" && <DayRibbon cd={cd} colours={colours(cd.iso)} h={h} />}
          {view === "day-ring" && <DayRing cd={cd} variant={variant} colours={colours(cd.iso)} h={h} />}
          {view === "week-grid" && (
            <WeekCalendar week={week} streams={streams} nowMin={nowMin} status={google} bandsFor={bandsFor} prayersFor={prayersFor} card={false} dimmed={h.dimmed} layoutKey={slot ? "header" : "page"}
              onChanged={onChanged} onEventsChanged={onEventsChanged} onOpenDay={openDay} />
          )}
          {view === "week-agenda" && <WeekAgenda days={days} colours={colours} h={h} onOpenDay={openDay} />}
          {view === "week-strips" && <WeekStrips days={days} colours={colours} h={h} onOpenDay={openDay} />}
          {view === "week-blocks" && <WeekBlocks days={days} colours={colours} />}
        </section>
        <ItemPanel week={week} streams={streams} onChanged={onChanged} />
      </div>
    </div>
  );
}
