"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CHIP } from "@/components/calendar/calendar-toolbar";
import { NowCard } from "@/components/routine/now-card";
import { RoutineRing } from "@/components/routine/routine-ring";
import { timedEvents } from "@/components/routine/ring-graphic";
import { resolveIso } from "@/lib/calendar";
import { VaultScheduleData, ResolvedDay } from "@/lib/routine";
import { vaultApi } from "@/lib/vault-api";
import type { VaultEvent } from "@/lib/vault-types";
import { addDays, fmtDay } from "@/lib/week";

/**
 * The clock with ‹ › to look at the day before or after: that date's template (weekday or weekend), its prayer times and,
 * for the owner, its calendar events. A preview only: it has no now marker and does not move the calendar. Today is the
 * resting place (`today` and `todayDay` come from the page, which keeps them fresh).
 */
export function DayPreview({ schedule, known, today, todayDay, nowMin, todayEvents, canEdit }: {
  schedule: VaultScheduleData; known: ReadonlySet<string>; today: string; todayDay: ResolvedDay; nowMin: number;
  /** Today's timed events (owner only). */
  todayEvents?: VaultEvent[]; canEdit: boolean;
}) {
  const [date, setDate] = useState<string | null>(null);
  const [fetched, setFetched] = useState<{ date: string; events: VaultEvent[] } | null>(null);
  // A date that stops being a preview (the day rolled over onto it) is today again.
  const shown = date && date !== today ? date : null;

  useEffect(() => {
    if (!shown || !canEdit) return;
    let live = true;
    vaultApi.events(shown).then((r) => { if (live) setFetched({ date: shown, events: r.events }); }).catch(() => { if (live) setFetched({ date: shown, events: [] }); });
    return () => { live = false; };
  }, [shown, canEdit]);

  const day = useMemo(() => (shown ? resolveIso(schedule, shown, known) : todayDay), [shown, schedule, known, todayDay]);
  const events = shown ? (fetched?.date === shown ? fetched.events : undefined) : todayEvents;
  const iso = shown ?? today;
  const label = fmtDay(iso, { weekday: "short", day: "numeric", month: "short" });
  const step = (n: number) => { const next = addDays(iso, n); setDate(next === today ? null : next); };

  return (
    <div data-ring-preview="" data-date={iso} data-label={label} data-day-type={day?.dayType} data-fajr={day?.prayers.fajr} data-isha={day?.prayers.isha}
      data-events={timedEvents(events).length}>
      <div className="mx-auto mb-1 flex w-full max-w-[30rem] items-center justify-between gap-2">
        <button type="button" onClick={() => step(-1)} aria-label="Previous day schedule" className={`${CHIP} px-1.5`}><ChevronLeft size={15} aria-hidden="true" /></button>
        <span className="flex min-w-0 items-center gap-2">
          <span className="mono truncate text-[var(--foreground)]" aria-live="polite">{label}</span>
          {shown && <button type="button" data-ring-today="" onClick={() => setDate(null)} className={CHIP}>Today</button>}
        </span>
        <button type="button" onClick={() => step(1)} aria-label="Next day schedule" className={`${CHIP} px-1.5`}><ChevronRight size={15} aria-hidden="true" /></button>
      </div>
      {day ? (
        <>
          <div className="font-clock">
            <RoutineRing day={day} nowMin={nowMin} events={events}
              preview={shown ? { big: fmtDay(iso, { weekday: "short" }), lines: [fmtDay(iso, { day: "numeric", month: "short" }), day.dayType] } : undefined} />
          </div>
          <div className="font-clock"><NowCard day={day} nowMin={nowMin} preview={shown ? label : undefined} /></div>
        </>
      ) : <p role="status" className="py-10 text-center text-sm text-[var(--muted-foreground)]">The schedule could not be read for {label}.</p>}
    </div>
  );
}
