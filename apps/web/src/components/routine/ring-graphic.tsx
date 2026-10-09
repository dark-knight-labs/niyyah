"use client";

import { useBlocks } from "@/lib/blocks";
import { PRAYERS, ResolvedDay, formatMinutes } from "@/lib/routine";
import { VaultEvent } from "@/lib/vault-types";
import {
  currentBlock, duration, formatDuration, isPast, nameFits, nextPrayer, onBottomHalf, ringGeometry,
} from "@/lib/ring";

const LABEL_GAP = 92;

export interface RingGraphicProps {
  day: ResolvedDay;
  nowMin: number;
  /** Ring centre, radius of the band's middle and band thickness, in viewBox units. */
  cx: number;
  cy: number;
  r: number;
  t: number;
  /** Viewbox height, used to keep the side labels on screen. */
  height: number;
  nameSize: number;
  clockSize: number;
  /** Index of the highlighted block; the others fade back. */
  hover: number | null;
  onHover: (index: number | null, at?: { x: number; y: number }) => void;
  prayers: boolean;
  /** Full-screen mode: every block labelled beside the ring, one detail per line. */
  sideLabels: boolean;
  idPrefix: string;
  /** Timed calendar events, drawn on the inner lane (owner only). */
  events?: VaultEvent[];
  /** Hovering an event arc on the inner lane; index into the timed events. */
  hoverEvent?: number | null;
  onHoverEvent?: (index: number | null, at?: { x: number; y: number }) => void;
  /** What sits under the time: the next prayer (default) or the current block and how long is left in it. */
  centre?: "prayer" | "block";
  /** Font size of the hour numbers and prayer labels, in viewBox units (default 11). */
  labelSize?: number;
}

/** The 24h ring: slices, names on the slices, now marker, clock. Meant to sit inside an <svg>. */
export function RingGraphic(p: RingGraphicProps) {
  const blocks = useBlocks();
  const { day, nowMin, cx, cy, r, t, hover } = p;
  const g = ringGeometry(cx, cy, r);
  const current = currentBlock(day, nowMin);
  const nextP = nextPrayer(day, nowMin);
  const elapsed = current ? (((nowMin - current.startMin) % 1440) + 1440) % 1440 : 0;
  // Hover keeps the ring's size: the hovered slice glows and brightens while the others ease back.
  const slice = (i: number): React.CSSProperties => ({
    filter: hover === i ? `drop-shadow(0 0 7px color-mix(in srgb, ${blocks.color(day.blocks[i].block)} 67%, transparent))` : "none",
    transition: "opacity .45s ease, filter .45s ease",
    pointerEvents: "none",
  });
  const opacityOf = (i: number) => {
    const b = day.blocks[i];
    if (hover !== null) return hover === i ? 1 : 0.3;
    return b === current ? 1 : isPast(b, nowMin) ? 0.4 : 0.75;
  };

  const [nx1, ny1] = g.point(r - t / 2 - 8, nowMin);
  const [nx2, ny2] = g.point(r + t / 2 + 8, nowMin);

  return (
    <>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--muted)" strokeWidth={t} />

      {day.blocks.map((b, i) => (
        <path key={`s-${b.block}-${b.startMin}`} d={g.arc(b.startMin, b.endMin)} fill="none" stroke={blocks.color(b.block)}
          strokeWidth={b === current ? t + 6 : t} style={{ ...slice(i), opacity: b === current && hover === null ? 0.3 : opacityOf(i) }} />
      ))}
      {/* the part of the current slice already passed is solid; the rest stays faded */}
      {current && hover === null && elapsed > 0 && (
        <path d={g.arc(current.startMin, current.startMin + elapsed)} fill="none" stroke={blocks.color(current.block)} strokeWidth={t + 6} style={{ pointerEvents: "none" }} />
      )}

      {day.blocks.map((b, i) => {
        if (!nameFits(b, r, p.nameSize * 0.57, blocks.ring(b.block))) return null;
        const id = `${p.idPrefix}-n${i}`;
        return (
          <g key={`n-${b.block}-${b.startMin}`} style={{ transition: "opacity .45s ease", pointerEvents: "none", opacity: hover !== null && hover !== i ? 0.45 : 1 }}>
            <path id={id} d={onBottomHalf(b) ? g.arcBackwards(b.startMin, b.endMin) : g.arc(b.startMin, b.endMin)} fill="none" />
            <text fontSize={p.nameSize} fontWeight={800} letterSpacing=".05em" fill="#fff" style={{ dominantBaseline: "central" }}>
              <textPath href={`#${id}`} startOffset="50%" textAnchor="middle">{blocks.ring(b.block)}</textPath>
            </text>
          </g>
        );
      })}

      {[0, 6, 12, 18].map((h) => {
        const [x, y] = g.point(r - t / 2 - 12 - (p.sideLabels ? 4 : 0), h * 60);
        return <text key={h} x={x} y={y + 4} textAnchor="middle" fontSize={p.sideLabels ? 12 : (p.labelSize ?? 11) - 1} fill="var(--muted-foreground)">{String(h).padStart(2, "0")}</text>;
      })}
      {/* reserved inner lane for calendar events */}
      <circle cx={cx} cy={cy} r={r - t / 2 - 34} fill="none" stroke="var(--border)" strokeDasharray="2 5" />
      {timedEvents(p.events).map((e, i) => {
        const lane = ringGeometry(cx, cy, r - t / 2 - 24);
        const on = p.hoverEvent === i;
        return (
          <path key={`e-${i}`} d={lane.arc(e.start_min as number, e.end_min as number)} fill="none" stroke={e.color ?? "var(--muted-foreground)"} strokeLinecap="round"
            style={{ strokeWidth: on ? 10 : 6, opacity: p.hoverEvent != null && !on ? 0.4 : 0.95, transition: "stroke-width .3s ease, opacity .3s ease", pointerEvents: "none" }} />
        );
      })}

      {p.prayers && PRAYERS.map((name) => {
        const min = day.prayers[name];
        const [x, y] = g.point(r + t / 2 + 9, min);
        const [lx, ly] = g.point(r + t / 2 + 20, min);
        const deg = (min / 1440) * 360;
        const anchor = deg > 20 && deg < 160 ? "start" : deg > 200 && deg < 340 ? "end" : "middle";
        const dy = deg <= 20 || deg >= 340 ? -2 : deg >= 160 && deg <= 200 ? 10 : 4;
        return (
          <g key={name} pointerEvents="none">
            <circle cx={x} cy={y} r={3.5} fill="var(--foreground)" />
            <text x={lx} y={ly + dy} textAnchor={anchor} fontSize={p.labelSize ?? 11} fontWeight={700} fill="var(--foreground)" style={{ textTransform: "capitalize" }}>
              {name}<tspan fontWeight={500} fill="var(--muted-foreground)"> {formatMinutes(min)}</tspan>
            </text>
          </g>
        );
      })}

      {p.sideLabels && <SideLabels {...p} g={g} />}

      {/* centre clock */}
      <text x={cx} y={cy + p.clockSize * 0.18} textAnchor="middle" fontSize={p.clockSize} fontFamily="var(--font-serif)" fill="var(--foreground)">{formatMinutes(nowMin)}</text>
      {p.centre === "block" && current ? (
        <>
          <text x={cx} y={cy + p.clockSize * 0.18 + p.clockSize * 0.42} textAnchor="middle" fontSize={p.clockSize * 0.3} fontWeight={800} fill="var(--foreground)">
            {blocks.label(current.block)}
          </text>
          <text x={cx} y={cy + p.clockSize * 0.18 + p.clockSize * 0.78} textAnchor="middle" fontSize={p.clockSize * 0.25} fill="var(--muted-foreground)">
            {formatDuration(duration(current) - elapsed)} left
          </text>
        </>
      ) : (
        <text x={cx} y={cy + p.clockSize * 0.18 + p.clockSize * 0.42} textAnchor="middle" fontSize={p.clockSize * 0.27} letterSpacing=".08em" fill="var(--muted-foreground)" style={{ textTransform: "uppercase" }}>
          {nextP.name} in {formatDuration(nextP.in)}
        </text>
      )}

      {/* fixed hit areas: the slices move when hovered, so hover must not depend on them */}
      {day.blocks.map((b, i) => (
        <path key={`h-${b.block}-${b.startMin}`} d={g.arc(b.startMin, b.endMin)} fill="none" stroke="transparent" strokeWidth={t + 12}
          pointerEvents="stroke" tabIndex={0} role="img" aria-label={`${blocks.label(b.block)}, ${formatMinutes(b.startMin)} to ${formatMinutes(b.endMin)}, ${formatDuration(duration(b))}, ${b.what}`}
          style={{ cursor: "pointer", outline: "none" }}
          onPointerMove={(e) => p.onHover(i, { x: e.clientX, y: e.clientY })}
          onPointerLeave={() => p.onHover(null)}
          onFocus={(e) => { const rect = e.currentTarget.getBoundingClientRect(); p.onHover(i, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }); }}
          onBlur={() => p.onHover(null)}
          onClick={(e) => p.onHover(i, { x: e.clientX, y: e.clientY })} />
      ))}

      {/* hit areas for the calendar events on the inner lane */}
      {p.onHoverEvent && timedEvents(p.events).map((e, i) => (
        <path key={`eh-${i}`} d={ringGeometry(cx, cy, r - t / 2 - 24).arc(e.start_min as number, e.end_min as number)} fill="none" stroke="transparent" strokeWidth={18}
          pointerEvents="stroke" tabIndex={0} role="img" aria-label={`${e.title}, ${formatMinutes(e.start_min as number)} to ${formatMinutes(e.end_min as number)}`}
          style={{ cursor: "pointer", outline: "none" }}
          onPointerMove={(ev) => p.onHoverEvent?.(i, { x: ev.clientX, y: ev.clientY })}
          onPointerLeave={() => p.onHoverEvent?.(null)}
          onFocus={(ev) => { const rect = ev.currentTarget.getBoundingClientRect(); p.onHoverEvent?.(i, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }); }}
          onBlur={() => p.onHoverEvent?.(null)}
          onClick={(ev) => p.onHoverEvent?.(i, { x: ev.clientX, y: ev.clientY })} />
      ))}

      {/* now marker */}
      <g pointerEvents="none">
        <line x1={nx1} y1={ny1} x2={nx2} y2={ny2} stroke="var(--background)" strokeWidth={6} strokeLinecap="round" />
        <line x1={nx1} y1={ny1} x2={nx2} y2={ny2} stroke="var(--foreground)" strokeWidth={2.5} strokeLinecap="round" />
        <circle cx={nx2} cy={ny2} r={9} fill="var(--foreground)" opacity={0.15}>
          <animate attributeName="r" values="6;12;6" dur="2.4s" repeatCount="indefinite" />
        </circle>
        <circle cx={nx2} cy={ny2} r={5.5} fill="var(--foreground)" stroke="var(--background)" strokeWidth={2.5} />
      </g>
    </>
  );
}

/** Events that have a start and end on this day (all-day ones have no place on the ring). */
export const timedEvents = (events?: VaultEvent[]) =>
  (events ?? []).filter((e) => e.start_min !== null && e.end_min !== null && e.end_min > e.start_min);

function SideLabels(p: RingGraphicProps & { g: ReturnType<typeof ringGeometry> }) {
  const blocks = useBlocks();
  const { day, cx, r, t, g } = p;
  const entries = day.blocks.map((b, i) => {
    const mid = ((b.startMin + b.endMin) / 2) % 1440;
    const [ax, ay] = g.point(r + t / 2 + 3, mid);
    return { b, i, ax, ay, y: ay, right: mid < 720 };
  });
  const placed = [true, false].flatMap((right) => {
    const side = entries.filter((e) => e.right === right).sort((a, b) => a.y - b.y);
    for (let k = 1; k < side.length; k++) side[k].y = Math.max(side[k].y, side[k - 1].y + LABEL_GAP);
    const over = side.length ? side[side.length - 1].y - (p.height - 90) : 0;
    if (over > 0) side.forEach((s) => (s.y -= over));
    return side;
  });
  return (
    <g pointerEvents="none">
      {placed.map(({ b, i, ax, ay, y, right }) => {
        const colX = right ? cx + r + t / 2 + 86 : cx - r - t / 2 - 86;
        const anchor = right ? "start" : "end";
        const color = blocks.color(b.block);
        const opacity = p.hover !== null && p.hover !== i ? 0.35 : 1;
        return (
          <g key={`l-${b.block}-${b.startMin}`} style={{ transition: "opacity .45s ease", opacity }}>
            <polyline points={`${ax},${ay} ${colX + (right ? -28 : 28)},${y - 5} ${colX + (right ? -20 : 20)},${y - 5}`} fill="none" stroke={color} strokeWidth={1.5} opacity={0.7} />
            <text x={colX} y={y} textAnchor={anchor} fontSize={20} fontWeight={800} fill="var(--foreground)">{blocks.label(b.block)}</text>
            <text textAnchor={anchor} fontSize={15} fill="var(--muted-foreground)">
              <tspan x={colX} y={y + 22}>{formatMinutes(b.startMin)} – {formatMinutes(b.endMin)}</tspan>
              <tspan x={colX} y={y + 41}>{formatDuration(duration(b))}</tspan>
              <tspan x={colX} y={y + 60} fill="var(--foreground)">{b.what}</tspan>
            </text>
          </g>
        );
      })}
    </g>
  );
}
