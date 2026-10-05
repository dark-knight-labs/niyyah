"use client";

import { BLOCK_COLORS, BLOCK_LABELS } from "@/lib/vault-constants";
import { PRAYERS, ResolvedDay, formatMinutes } from "@/lib/routine";

const W = 1200;
const H = 880;
const CX = W / 2;
const CY = H / 2;
const R_OUT = 290;
const THICK = 40;
const R_MID = R_OUT - THICK / 2;
const R_IN = R_OUT - THICK;
const MIN_LABEL_GAP = 66;

const TAU = Math.PI * 2;
const angle = (min: number) => (min / 1440) * TAU - Math.PI / 2;
const point = (r: number, min: number): [number, number] => [
  CX + r * Math.cos(angle(min)),
  CY + r * Math.sin(angle(min)),
];

function arcPath(startMin: number, endMin: number): string {
  const [x1, y1] = point(R_MID, startMin);
  const [x2, y2] = point(R_MID, endMin);
  const large = endMin - startMin > 720 ? 1 : 0;
  return `M ${x1} ${y1} A ${R_MID} ${R_MID} 0 ${large} 1 ${x2} ${y2}`;
}

/** Spread labels on one side so none are closer than MIN_LABEL_GAP vertically. */
function spreadLabels<T extends { y: number }>(items: T[]): T[] {
  const sorted = [...items].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i++) {
    sorted[i].y = Math.max(sorted[i].y, sorted[i - 1].y + MIN_LABEL_GAP);
  }
  const overflow = sorted.length ? sorted[sorted.length - 1].y - (H - 60) : 0;
  if (overflow > 0) sorted.forEach((s) => (s.y -= overflow));
  return sorted;
}

export interface RoutineRingProps {
  day: ResolvedDay;
  nowMin: number;
  dateLabel: string;
  mode: string | null;
  modeColor: string;
  city: string | null;
}

export function RoutineRing({ day, nowMin, dateLabel, mode, modeColor, city }: RoutineRingProps) {
  const current = day.blocks.find(
    (b) => (nowMin >= b.startMin && nowMin < b.endMin) || (nowMin + 1440 >= b.startMin && nowMin + 1440 < b.endMin),
  );

  const upcoming = PRAYERS.map((p) => ({ p, min: day.prayers[p] })).find((x) => x.min > nowMin);
  const next = upcoming ?? { p: "fajr" as const, min: day.prayers.fajr + 1440 };
  const untilNext = next.min - nowMin;

  const labels = day.blocks.map((b) => {
    const mid = (b.startMin + b.endMin) / 2;
    const [ax, ay] = point(R_OUT + 4, mid);
    const right = ax >= CX;
    return { b, ax, ay, right, y: ay };
  });
  const placed = [
    ...spreadLabels(labels.filter((l) => l.right)),
    ...spreadLabels(labels.filter((l) => !l.right)),
  ];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto mx-auto" style={{ maxHeight: "calc(100vh - 3rem)" }} role="img" aria-label="24-hour routine ring">
      {/* base ring */}
      <circle cx={CX} cy={CY} r={R_MID} fill="none" stroke="var(--muted)" strokeWidth={THICK} />

      {/* hour ticks */}
      {Array.from({ length: 24 }, (_, h) => {
        const [x1, y1] = point(R_IN - 4, h * 60);
        const [x2, y2] = point(R_IN - (h % 6 === 0 ? 14 : 8), h * 60);
        return <line key={h} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--muted-foreground)" strokeWidth={h % 6 === 0 ? 2 : 1} opacity={0.5} />;
      })}
      {/* block arcs */}
      {day.blocks.map((b) => (
        <path
          key={`${b.block}-${b.startMin}`}
          d={arcPath(b.startMin, b.endMin)}
          fill="none"
          stroke={BLOCK_COLORS[b.block]}
          strokeWidth={THICK}
          opacity={current === b ? 1 : 0.8}
        />
      ))}

      {/* labels + leader lines */}
      {placed.map(({ b, ax, ay, right, y }) => {
        const colX = right ? CX + R_OUT + 90 : CX - R_OUT - 90;
        const tx = right ? colX + 8 : colX - 8;
        const anchor = right ? "start" : "end";
        const color = BLOCK_COLORS[b.block];
        return (
          <g key={`l-${b.block}-${b.startMin}`}>
            <polyline points={`${ax},${ay} ${colX},${y} ${colX + (right ? 4 : -4)},${y}`} fill="none" stroke={color} strokeWidth={1.5} />
            <text x={tx} y={y - 14} textAnchor={anchor} fontSize={15} fontWeight={800} letterSpacing={1} fill={color}>
              {BLOCK_LABELS[b.block].toUpperCase()}
            </text>
            <text x={tx} y={y + 4} textAnchor={anchor} fontSize={13} fill="var(--muted-foreground)">
              {formatMinutes(b.startMin)} – {formatMinutes(b.endMin)}
            </text>
            <text x={tx} y={y + 22} textAnchor={anchor} fontSize={14} fill="var(--foreground)">
              {b.what}
            </text>
          </g>
        );
      })}

      {/* prayer pills */}
      {PRAYERS.map((p) => {
        const min = day.prayers[p];
        const [x, y] = point(R_MID, min);
        const deg = (min / 1440) * 360;
        const flip = deg > 90 && deg < 270 ? 180 : 0;
        const [tx, ty] = point(R_IN - 30, min);
        return (
          <g key={p}>
            <g transform={`translate(${x} ${y}) rotate(${deg + flip})`}>
              <rect x={-34} y={-11} width={68} height={22} rx={11} fill="#f59e0b" stroke="var(--background)" strokeWidth={2} />
              <text textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={800} fill="#fff" letterSpacing={0.5}>
                {p.toUpperCase()}
              </text>
            </g>
            <text x={tx} y={ty} textAnchor="middle" dominantBaseline="middle" fontSize={12} fontWeight={700} fill="#b45309">
              {formatMinutes(min)}
            </text>
          </g>
        );
      })}

      {/* now hand */}
      {(() => {
        const [x1, y1] = point(96, nowMin);
        const [x2, y2] = point(R_OUT + 10, nowMin);
        return (
          <g>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--foreground)" strokeWidth={2.5} strokeLinecap="round" />
            <circle cx={x2} cy={y2} r={6} fill="var(--foreground)" stroke="var(--background)" strokeWidth={2} />
          </g>
        );
      })()}

      {/* centre */}
      <text x={CX} y={CY - 62} textAnchor="middle" fontSize={13} letterSpacing={2} fill="var(--muted-foreground)">
        {(city ?? "").toUpperCase()}
      </text>
      <text x={CX} y={CY - 28} textAnchor="middle" fontSize={26} fontWeight={600} fontFamily="var(--font-serif)" fill="var(--foreground)">
        {dateLabel}
      </text>
      {mode && (
        <g transform={`translate(${CX} ${CY + 2})`}>
          <rect x={-46} y={-12} width={92} height={24} rx={12} fill={modeColor} opacity={0.18} />
          <text textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={800} letterSpacing={1} fill={modeColor}>
            {mode.toUpperCase()}
          </text>
        </g>
      )}
      <text x={CX} y={CY + 40} textAnchor="middle" fontSize={15} fontWeight={700} fill={current ? BLOCK_COLORS[current.block] : "var(--muted-foreground)"}>
        {current ? `Now: ${BLOCK_LABELS[current.block]}` : "Now: unscheduled"}
      </text>
      <text x={CX} y={CY + 62} textAnchor="middle" fontSize={13} fill="var(--muted-foreground)">
        {next.p.toUpperCase()} in {Math.floor(untilNext / 60)}h {String(untilNext % 60).padStart(2, "0")}m
      </text>
    </svg>
  );
}
