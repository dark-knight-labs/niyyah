"use client";

import { ChevronLeft, ChevronRight, RotateCw } from "lucide-react";
import { RING_INFO, RING_VARIANTS, RingVariant, SHADE_LABEL, SHADE_MODES, ShadeMode, ViewId, viewName, VIEWS } from "@/lib/calendar";
import { addDays, fmtDay } from "@/lib/week";
import { MICRO } from "@/components/calendar/item-bits";

export const CHIP = "inline-flex min-h-8 items-center whitespace-nowrap border border-[var(--border)] px-2.5 text-xs font-semibold text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] aria-pressed:border-[var(--foreground)] aria-pressed:bg-[var(--foreground)] aria-pressed:text-[var(--background)] disabled:opacity-40";
const SMALL = `${CHIP} min-h-7 px-2 text-[11px]`;

/** The nine views in two groups, and Rotate (V / Shift+V). */
export function ViewSwitcher({ view, onView, onRotate }: { view: ViewId; onView: (v: ViewId) => void; onRotate: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2" role="toolbar" aria-label="Calendar view">
      {(["day", "week"] as const).map((scope) => (
        <div key={scope} className="flex flex-wrap items-center gap-1" role="group" aria-label={scope === "day" ? "Day views" : "Week views"}>
          <span className={`${MICRO} mr-1`}>{scope === "day" ? "Day" : "Week"}</span>
          {VIEWS.filter((v) => v.scope === scope).map((v) => (
            <button key={v.id} type="button" aria-pressed={view === v.id} aria-label={viewName(v.id)} data-view-button={v.id} onClick={() => onView(v.id)} className={CHIP}>{v.label}</button>
          ))}
        </div>
      ))}
      <button type="button" onClick={onRotate} aria-keyshortcuts="v Shift+V" title="Next view (V), previous (Shift+V)" className={`${CHIP} gap-1.5`}><RotateCw size={13} aria-hidden="true" />Rotate <kbd className="font-mono text-micro">V</kbd></button>
    </div>
  );
}

/** Previous / next day, the week's seven days as chips, and back to today. */
export function DayPicker({ days, focus, today, onDay }: { days: string[]; focus: string; today: string; onDay: (iso: string) => void }) {
  const step = (n: number) => onDay(addDays(focus, n));
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Day">
      <button type="button" onClick={() => step(-1)} aria-label="Previous day" aria-keyshortcuts="[" className={`${CHIP} px-1.5`}><ChevronLeft size={15} aria-hidden="true" /></button>
      {days.map((d) => (
        <button key={d} type="button" aria-pressed={d === focus} aria-current={d === today ? "date" : undefined} onClick={() => onDay(d)}
          aria-label={`${fmtDay(d, { weekday: "long", day: "numeric", month: "long" })}${d === today ? ", today" : ""}`} className={`${SMALL} font-mono tabular-nums`}>
          {fmtDay(d, { weekday: "short" })} {fmtDay(d, { day: "numeric" })}{d === today ? " ·" : ""}
        </button>
      ))}
      <button type="button" onClick={() => step(1)} aria-label="Next day" aria-keyshortcuts="]" className={`${CHIP} px-1.5`}><ChevronRight size={15} aria-hidden="true" /></button>
      <button type="button" onClick={() => onDay(today)} disabled={focus === today} aria-keyshortcuts="t" className={SMALL}>Today</button>
    </div>
  );
}

/** "18–24 Oct", or "28 Oct – 3 Nov" across two months. */
export function rangeLabel(first: string, last: string): string {
  const month = (d: string) => fmtDay(d, { month: "short" });
  const day = (d: string) => fmtDay(d, { day: "numeric" });
  return month(first) === month(last) ? `${day(first)}–${day(last)} ${month(last)}` : `${day(first)} ${month(first)} – ${day(last)} ${month(last)}`;
}

/** Previous / this / next week. */
export function WeekPager({ days, thisWeek, onStep, onToday }: { days: string[]; thisWeek: boolean; onStep: (n: number) => void; onToday: () => void }) {
  if (!days.length) return null;
  const label = rangeLabel(days[0], days[days.length - 1]);
  return (
    <span className="inline-flex shrink-0" role="group" aria-label="Week">
      <button type="button" onClick={() => onStep(-1)} aria-label="Previous week" aria-keyshortcuts="[" className={`${CHIP} px-1.5`}><ChevronLeft size={15} aria-hidden="true" /></button>
      <button type="button" onClick={onToday} disabled={thisWeek} aria-label={`${label}${thisWeek ? ", this week" : ", back to this week"}`} title={thisWeek ? "This week" : "Back to this week (t)"}
        className={`${CHIP} border-x-0 font-mono tabular-nums ${thisWeek ? "!text-[var(--foreground)] !opacity-100" : ""}`}>{label}</button>
      <button type="button" onClick={() => onStep(1)} aria-label="Next week" aria-keyshortcuts="]" className={`${CHIP} px-1.5`}><ChevronRight size={15} aria-hidden="true" /></button>
    </span>
  );
}

/** Ring meeting-lane variant. */
export function RingPicker({ variant, onVariant }: { variant: RingVariant; onVariant: (v: RingVariant) => void }) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Ring lanes">
      <span className={`${MICRO} mr-1`}>Ring</span>
      {RING_VARIANTS.map((v) => (
        <button key={v} type="button" aria-pressed={variant === v} onClick={() => onVariant(v)} title={`${RING_INFO[v][0]}: ${RING_INFO[v][1]}`} aria-label={`Ring lanes: ${RING_INFO[v][0]}`} className={SMALL}>{v === "base" ? "Today" : v}</button>
      ))}
    </div>
  );
}

/** Block colour mode. */
export function ShadePicker({ shade, onShade }: { shade: ShadeMode; onShade: (m: ShadeMode) => void }) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Block colours">
      <span className={`${MICRO} mr-1`}>Block colours</span>
      {SHADE_MODES.map((m) => <button key={m} type="button" aria-pressed={shade === m} onClick={() => onShade(m)} className={SMALL}>{SHADE_LABEL[m]}</button>)}
    </div>
  );
}

/** Tag filter: All, then each tag with its count. Items without the picked tag fade back in every view. */
export function TagFilter({ tags, tag, onTag }: { tags: [string, number][]; tag: string | null; onTag: (t: string | null) => void }) {
  const list = tag && !tags.some(([t]) => t === tag) ? [...tags, [tag, 0] as [string, number]] : tags;
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter by tag">
      <span className={`${MICRO} mr-1`}>Filter</span>
      <button type="button" aria-pressed={!tag} onClick={() => onTag(null)} className={SMALL}>All</button>
      {list.map(([t, n]) => (
        <button key={t} type="button" aria-pressed={tag === t} data-tag-filter={t} onClick={() => onTag(tag === t ? null : t)} aria-label={`#${t}, ${n} item${n === 1 ? "" : "s"}`} className={`${SMALL} font-mono`}>#{t} <span className="ml-1 opacity-70">{n}</span></button>
      ))}
      {!list.length && <span className="text-xs text-[var(--muted-foreground)]">No tags this week.</span>}
    </div>
  );
}
