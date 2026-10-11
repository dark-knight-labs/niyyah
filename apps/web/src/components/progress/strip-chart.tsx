"use client";

import { useState } from "react";
import { Column, DayMap, blockAvg, colTotals, columns, fmtDate, logged } from "@/lib/progress";
import { resolveModeColor } from "@/lib/vault-constants";

export interface ChartBlock { key: string; label: string; color: string }

const MODE_ORDER = ["full", "yellow", "compressed", "minimal", "fasting", "ramadan", "off"];
const COL = 10; // viewBox units per column

/** One shared time axis: capacity against actual stars on top, a row per block below, then the day's mode. Scrub, click or use the arrow keys to pick a day. */
export function StripChart({ map, dates, blocks, selected, onSelect }: { map: DayMap; dates: string[]; blocks: ChartBlock[]; selected: string; onSelect: (d: string) => void }) {
  const cols = columns(dates);
  const n = cols.length;
  const W = n * COL;
  const [hover, setHover] = useState<number | null>(null);
  const weekly = dates.length > 90;
  const pinned = cols.findIndex((c) => c.dates.includes(selected));
  const maxPossible = Math.max(1, ...cols.map((c) => colTotals(map, c)?.possible ?? 0));
  const left = (k: number) => `calc(var(--lw) + (100% - var(--lw)) * ${(k + 0.5) / n})`;

  function indexAt(e: React.PointerEvent | React.MouseEvent): number {
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    return x < 0 || x > 1 ? -1 : Math.min(n - 1, Math.floor(x * n));
  }
  function step(by: number) {
    const i = dates.indexOf(selected);
    const next = dates[Math.max(0, Math.min(dates.length - 1, (i < 0 ? dates.length - 1 : i) + by))];
    onSelect(next);
  }
  const tipCol: Column | undefined = hover !== null ? cols[hover] : undefined;
  const tipTotals = tipCol ? colTotals(map, tipCol) : null;

  const label = "flex w-[var(--lw)] shrink-0 items-center gap-1.5 whitespace-nowrap font-mono text-micro font-medium text-[var(--muted-foreground)]";
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.min(n - 1, Math.round(f * (n - 1))));

  return (
    <div className="relative [--lw:4.5rem] sm:[--lw:5.25rem]" tabIndex={0} role="application" aria-label="Time scrubber. Use the left and right arrow keys to move through days."
      onKeyDown={(e) => { if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); } else if (e.key === "ArrowRight") { e.preventDefault(); step(1); } }}
      style={{ touchAction: "pan-y" }}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <h2 className="text-micro font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">Shared time axis</h2>
        <p className="text-xs text-[var(--muted-foreground)]">{weekly ? "each column = 1 week" : "each column = 1 day"} · scrub, then click or use ← → to pin</p>
      </div>

      <div className="relative">
        <div className="mb-1.5 flex h-24 items-center">
          <span className={`${label} self-start pt-0.5`}>capacity<br />vs actual</span>
          <svg viewBox={`0 0 ${W} 96`} preserveAspectRatio="none" className="h-full min-w-0 flex-1" aria-hidden="true">
            {[0, 50, 100].map((g) => <line key={g} x1={0} x2={W} y1={93 - g * 0.9} y2={93 - g * 0.9} stroke="var(--border)" strokeDasharray="1 3" vectorEffect="non-scaling-stroke" />)}
            {cols.map((c, i) => {
              const t = colTotals(map, c);
              if (!t) return null;
              const hc = (t.possible / maxPossible) * 90, ha = (t.total / maxPossible) * 90;
              return (
                <g key={c.end}>
                  <rect x={i * COL + 1.5} y={93 - hc} width={7} height={hc} fill="var(--muted)" />
                  <rect x={i * COL + 1.5} y={93 - ha} width={7} height={ha} fill="var(--accent)" fillOpacity={0.85} />
                </g>
              );
            })}
          </svg>
        </div>

        {blocks.map((b) => (
          <div key={b.key} className="flex h-5 items-center">
            <span className={label}><i className="h-[7px] w-[7px] rounded-none" style={{ background: b.color }} />{b.label}</span>
            <svg viewBox={`0 0 ${W} 20`} preserveAspectRatio="none" className="h-full min-w-0 flex-1" aria-hidden="true">
              {cols.map((c, i) => {
                const a = blockAvg(map, c, b.key);
                return a === null
                  ? <rect key={c.end} x={i * COL + 3} y={9} width={4} height={1.4} fill="var(--border)" />
                  : <rect key={c.end} x={i * COL + 0.8} y={2} width={8.4} height={16} rx={1.5} fill={b.color} fillOpacity={0.12 + (Math.min(a, 3) / 3) * 0.88} />;
              })}
            </svg>
          </div>
        ))}

        <div className="mt-1 flex h-3.5 items-center">
          <span className={label}>mode</span>
          <svg viewBox={`0 0 ${W} 14`} preserveAspectRatio="none" className="h-full min-w-0 flex-1" aria-hidden="true">
            {cols.map((c, i) => {
              const l = logged(map, c.dates);
              if (!l.length) return null;
              const mode = l[l.length - 1].mode;
              const idx = MODE_ORDER.indexOf(mode);
              return <rect key={c.end} x={i * COL + 1} y={2 + (idx < 0 ? 3 : idx) * 1.7} width={8} height={1.6} fill={resolveModeColor(mode)} />;
            })}
          </svg>
        </div>

        <div className="relative ml-[var(--lw)] mt-1 h-[18px]">
          {ticks.map((k, j) => (
            <span key={j} className="absolute top-0.5 whitespace-nowrap font-mono text-[10px] text-[var(--muted-foreground)]"
              style={{ left: `${((k + 0.5) / n) * 100}%`, transform: j === 0 ? "none" : j === ticks.length - 1 ? "translateX(-100%)" : "translateX(-50%)" }}>
              {fmtDate(cols[k].end).replace(/^\w+ /, "")}
            </span>
          ))}
        </div>

        {/* pointer layer over the data area only */}
        <div className="absolute bottom-[18px] left-[var(--lw)] right-0 top-0 cursor-crosshair"
          onPointerMove={(e) => { const k = indexAt(e); setHover(k < 0 ? null : k); }}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => { const k = indexAt(e); if (k >= 0) onSelect(cols[k].end); }} />
        {pinned >= 0 && <div className="pointer-events-none absolute bottom-[18px] top-0 border-l border-[var(--accent)]" style={{ left: left(pinned) }} aria-hidden="true" />}
        {hover !== null && <div className="pointer-events-none absolute bottom-[18px] top-0 border-l border-[var(--foreground)] opacity-60" style={{ left: left(hover) }} aria-hidden="true" />}
        {tipCol && hover !== null && (
          <div className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 font-mono text-micro font-medium shadow-[0_12px_30px_rgba(0,0,0,0.2)]" style={{ left: left(hover) }}>
            {tipCol.label}{tipTotals ? ` · ${Math.round(tipTotals.pct)}%` : " · not logged"}
          </div>
        )}
      </div>
    </div>
  );
}
