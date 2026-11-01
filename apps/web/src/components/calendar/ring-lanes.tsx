"use client";

import { useState } from "react";
import { useBlocks } from "@/lib/blocks";
import { CalDay, itemState, lanes, Lanes, RingVariant, Texture, timedItems } from "@/lib/calendar";
import { itemRef } from "@/lib/items";
import { duration, formatDuration, ringGeometry } from "@/lib/ring";
import { formatMinutes } from "@/lib/routine";
import type { ItemData } from "@/lib/vault-types";
import { RingGraphic } from "@/components/routine/ring-graphic";
import { ItemHandlers, itemAttrs, labelOf } from "@/components/calendar/item-bits";

/** Ring geometry shared by the day ring and the week's small multiples (viewBox units). */
export const RING = { cx: 340, cy: 300, r: 190, t: 34, view: "88 48 504 504" };

const OPACITY: Record<ReturnType<typeof itemState>, number> = { live: 1, done: 0.6, skipped: 0.25, past: 0.4, open: 0.92 };

/** Radius of lane `k` per variant, and how thick its arc is. */
function laneGeometry(variant: RingVariant, inner: number) {
  if (variant === "A") return { at: (k: number) => inner - 10 - 12 * k, width: 10 };
  if (variant === "B") return { at: (k: number) => inner - 7 - 14 * k, width: 3.5 };
  if (variant === "C") return { at: (k: number) => inner - 9 - 11 * k, width: 9 };
  return { at: () => inner - 24, width: 6 };
}

/** Where the hour numbers go: just inside the innermost lane, never into the clock. */
export function hourRadius(variant: RingVariant, l: Lanes, inner: number): number {
  const g = laneGeometry(variant, inner);
  if (variant === "base") return inner - 12;
  const last = g.at((variant === "C" ? l.calCount : l.count) - 1);
  return Math.max(84, last - g.width / 2 - 10);
}

function Patterns({ id }: { id: string }) {
  return (
    <defs>
      <pattern id={`${id}-hatch`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="4" height="4" fill="var(--surface)" /><rect width="2" height="4" fill="var(--foreground)" />
      </pattern>
      <pattern id={`${id}-dots`} width="4.5" height="4.5" patternUnits="userSpaceOnUse">
        <rect width="4.5" height="4.5" fill="var(--surface)" /><circle cx="2.25" cy="2.25" r="1.25" fill="var(--foreground)" />
      </pattern>
      <pattern id={`${id}-cross`} width="4" height="4" patternUnits="userSpaceOnUse">
        <rect width="4" height="4" fill="var(--surface)" /><path d="M0 .5H4M.5 0V4" stroke="var(--foreground)" strokeWidth="1" />
      </pattern>
    </defs>
  );
}

/**
 * The day's timed items on the ring's inner lanes, as the chosen variant draws them. Every item is a button (Enter or click
 * opens its card) and carries the same data attributes as in the other views.
 */
export function RingLanes({ cd, variant, h, mini, idPrefix }: { cd: CalDay; variant: RingVariant; h: ItemHandlers; mini?: boolean; idPrefix: string }) {
  const { cx, cy, r, t } = RING;
  const inner = r - t / 2;
  const timed = timedItems(cd.items);
  const l = lanes(timed);
  const lg = laneGeometry(variant, inner);
  const laneOf = (i: ItemData) => (variant === "C" ? l.calLane.get(itemRef(i)) ?? 0 : variant === "base" ? 0 : l.lane.get(itemRef(i))!.lane);
  const texture = (i: ItemData): Texture => l.calendars.find((c) => c.name === (i.kind === "task" ? "Yours" : i.calendar ?? "Calendar"))?.texture ?? "solid";
  const rings = variant === "base" ? 0 : variant === "C" ? l.calCount : l.count;

  return (
    <g>
      <Patterns id={idPrefix} />
      {variant === "base" && <circle cx={cx} cy={cy} r={inner - 34} fill="none" stroke="var(--border)" strokeDasharray="2 5" />}
      {Array.from({ length: rings }, (_, k) => (
        variant === "B"
          ? <circle key={k} cx={cx} cy={cy} r={lg.at(k)} fill="none" stroke="var(--border)" strokeDasharray="1 4" />
          : <circle key={k} cx={cx} cy={cy} r={lg.at(k)} fill="none" stroke="var(--muted)" strokeWidth={lg.width} opacity={0.8} />
      ))}
      {variant === "C" && !mini && l.calendars.map((c) => (
        <text key={c.name} x={cx - 6} y={cy - lg.at(c.first) + 3} textAnchor="end" fontSize={9} fontWeight={700} fontFamily="var(--font-mono)" letterSpacing=".08em" fill="var(--muted-foreground)" style={{ textTransform: "uppercase" }}>{c.name}</text>
      ))}
      {timed.map((i, n) => {
        const ref = itemRef(i);
        const radius = lg.at(laneOf(i));
        const g = ringGeometry(cx, cy, radius);
        const s = i.start_min as number;
        const e = i.end_min as number;
        const d = g.arc(s, e);
        const state = itemState(i, cd);
        const live = state === "live";
        const picked = h.picked === ref;
        const [px, py] = g.point(radius, s);
        const mid = ((s + e) / 2) % 1440;
        const fits = (2 * Math.PI * radius * (e - s)) / 1440 >= 11;
        const pid = `${idPrefix}-e${n}`;
        const open = () => h.onPick(i);
        return (
          <g key={ref} {...itemAttrs(i, h)} style={{ opacity: OPACITY[state] }}>
            {live && <path d={d} fill="none" stroke="var(--accent)" strokeWidth={lg.width + 5} className="motion-safe:animate-pulse" />}
            {picked && <path d={d} fill="none" stroke="var(--accent)" strokeWidth={lg.width + 6} opacity={0.6} />}
            {variant === "base" && <path d={d} fill="none" stroke={h.colourOf(i)} strokeWidth={6} strokeLinecap="round" />}
            {variant === "A" && (
              <>
                <path d={d} fill="none" stroke="var(--foreground)" strokeWidth={lg.width} />
                {[s, e].map((m) => { const [x1, y1] = g.point(radius - lg.width / 2 - 1.5, m); const [x2, y2] = g.point(radius + lg.width / 2 + 1.5, m); return <line key={m} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--foreground)" strokeWidth={2.2} />; })}
                {!mini && fits && (
                  <>
                    <path id={pid} d={mid > 360 && mid < 1080 ? g.arcBackwards(s, e) : d} fill="none" />
                    <text fontSize={9.5} fontWeight={700} fontFamily="var(--font-mono)" fill="var(--background)" style={{ dominantBaseline: "central" }} pointerEvents="none">
                      <textPath href={`#${pid}`} startOffset="50%" textAnchor="middle">{n + 1}</textPath>
                    </text>
                  </>
                )}
              </>
            )}
            {variant === "B" && (
              <>
                <path d={d} fill="none" stroke="var(--foreground)" strokeWidth={3.5} strokeLinecap="round" />
                {live && <circle cx={px} cy={py} r={11.5} fill="none" stroke="var(--accent)" strokeWidth={2} className="motion-safe:animate-pulse" />}
                <circle cx={px} cy={py} r={7.5} fill="var(--foreground)" stroke="var(--surface)" strokeWidth={2} />
                {!mini && <text x={px} y={py + 0.5} textAnchor="middle" fontSize={9} fontWeight={700} fontFamily="var(--font-mono)" fill="var(--background)" style={{ dominantBaseline: "central" }}>{n + 1}</text>}
              </>
            )}
            {variant === "C" && (
              <>
                <path d={d} fill="none" stroke="var(--foreground)" strokeWidth={lg.width + 1.4} />
                {texture(i) !== "solid" && <path d={d} fill="none" stroke={`url(#${idPrefix}-${texture(i)})`} strokeWidth={lg.width - 1.4} />}
              </>
            )}
            <path d={d} fill="none" stroke="transparent" strokeWidth={mini ? 18 : 16} pointerEvents="stroke" role="button" tabIndex={0} aria-label={`Details: ${n + 1}, ${labelOf(i)}`} aria-pressed={picked}
              style={{ cursor: "pointer" }} onClick={open} onKeyDown={(k) => { if (k.key === "Enter" || k.key === " ") { k.preventDefault(); open(); } }} />
          </g>
        );
      })}
    </g>
  );
}

/** The centre text of a ring that is not showing the live clock: the day's name and counts, or (variant C, today) what is on now or next. */
function centre(cd: CalDay, variant: RingVariant, mini: boolean, weekday: string, dayType: string): { big: string; lines: string[]; accent?: boolean } | undefined {
  const timed = timedItems(cd.items);
  const allDay = cd.items.length - timed.length;
  const now = cd.nowMin;
  if (mini) return { big: weekday, lines: [now !== null ? formatMinutes(now) : `${timed.length} timed`], accent: now !== null };
  if (now === null) return { big: weekday, lines: [`${timed.length} timed · ${allDay} all day`, `${dayType} schedule`] };
  if (variant !== "C") return undefined;
  const cut = (s: string) => (s.length > 22 ? `${s.slice(0, 21)}…` : s);
  const live = timed.filter((i) => (i.start_min as number) <= now && now < (i.end_min as number)).sort((a, b) => (a.end_min as number) - (b.end_min as number));
  const next = timed.find((i) => (i.start_min as number) > now);
  if (live.length) return { big: formatMinutes(now), lines: [`${cut(live[0].title)}${live.length > 1 ? ` (+${live.length - 1})` : ""}`, `now · ${formatDuration((live[0].end_min as number) - now)} left`] };
  if (next) return { big: formatMinutes(now), lines: [cut(next.title), `next ${formatMinutes(next.start_min as number)} · in ${formatDuration((next.start_min as number) - now)}`] };
  return { big: formatMinutes(now), lines: ["No more items"] };
}

/** The day's 24h ring (RingGraphic) with the item lanes of `variant` inside it. A hovered block shows a card. */
export function ItemRing({ cd, variant, colours, h, mini = false, weekday, label }: { cd: CalDay; variant: RingVariant; colours: string[]; h: ItemHandlers; mini?: boolean; weekday: string; label: string }) {
  const blocks = useBlocks();
  const [hover, setHover] = useState<number | null>(null);
  const [at, setAt] = useState({ x: 0, y: 0 });
  if (!cd.day) return <p className="py-8 text-center text-xs text-[var(--muted-foreground)]">The schedule could not be read for this day.</p>;
  const day = cd.day;
  const id = `ring-${variant}-${cd.iso}${mini ? "-m" : ""}`;
  const l = lanes(timedItems(cd.items));
  const block = hover === null ? null : day.blocks[hover];
  const text = centre(cd, variant, mini, weekday, day.dayType === "weekend" ? "Weekend" : "Weekday");
  return (
    <div className="relative">
      <svg viewBox={RING.view} className={`mx-auto block h-auto w-full select-none ${mini ? "" : "max-w-[36rem]"}`} role="group" aria-label={label}>
        <RingGraphic day={day} nowMin={cd.nowMin ?? 0} noNow={cd.nowMin === null} cx={RING.cx} cy={RING.cy} r={RING.r} t={RING.t} height={600}
          nameSize={13} clockSize={mini ? 92 : 52} labelSize={mini ? 16 : 13} hover={hover} onHover={(i, p) => { if (mini) return; setHover(i); if (p) setAt(p); }}
          prayers sideLabels={false} centre="block" idPrefix={id} mini={mini} hideInnerLane colorOf={(i) => colours[i]} centreText={text}
          hourRadius={hourRadius(variant, l, RING.r - RING.t / 2)}
          overlay={<RingLanes cd={cd} variant={variant} h={h} mini={mini} idPrefix={id} />} />
      </svg>
      {block && hover !== null && (
        <div role="tooltip" className="pointer-events-none fixed z-50 w-56 border border-[var(--border)] bg-[var(--background)] px-3.5 py-3 text-[0.8125rem] shadow-xl"
          style={{ left: Math.min(at.x + 14, (typeof window === "undefined" ? 9999 : window.innerWidth) - 240), top: at.y + 14 }}>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2" style={{ background: colours[hover] }} />
            <b className="flex-1 text-sm">{blocks.label(block.block)}</b>
            <span className="font-bold">{formatDuration(duration(block))}</span>
          </div>
          <p className="mt-1 tabular-nums text-[var(--muted-foreground)]">{formatMinutes(block.startMin)} – {formatMinutes(block.endMin)}</p>
          <p className="mt-2 border-t border-[var(--border)] pt-2">{block.what}</p>
        </div>
      )}
    </div>
  );
}
