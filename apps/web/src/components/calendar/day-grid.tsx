"use client";

import { useEffect, useRef } from "react";
import { useBlocks } from "@/lib/blocks";
import { CalDay, itemState, lanes, pieces, prayerMarks, STATE_CLASS, timedItems, tint } from "@/lib/calendar";
import { itemRef, subtaskStat } from "@/lib/items";
import { formatMinutes } from "@/lib/routine";
import { trayDrag, useTrayDrag, type PlanDrop } from "@/lib/tray-drag";
import { AllDayStrip, Badge, ItemHandlers, itemAttrs, labelOf, StatusBox } from "@/components/calendar/item-bits";

/** Pixels per minute: the whole day is 1152px tall and scrolls inside its own box. */
const PX = 0.8;
const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * One day on a time axis: blocks as tinted bands (label on the left), prayers as dashed lines with a chip in the axis,
 * timed items as cards in the right-hand column (overlaps side by side), the All day strip above. Starts scrolled to now.
 * A tray row dropped on the strip or a time slot is planned there (15-minute snap, 30 minutes).
 */
export function DayGrid({ cd, colours, h, onPlan }: { cd: CalDay; colours: string[]; h: ItemHandlers; onPlan?: PlanDrop }) {
  const tray = useTrayDrag();
  const blocks = useBlocks();
  const box = useRef<HTMLDivElement>(null);
  const timed = timedItems(cd.items);
  const lane = lanes(timed).lane;
  const n = new Map(timed.map((i, k) => [itemRef(i), k + 1]));
  const prayers = cd.day ? prayerMarks(cd.day, cd.nowMin) : [];
  const height = 1440 * PX;
  const focus = cd.nowMin ?? timed[0]?.start_min ?? 8 * 60;

  useEffect(() => {
    if (box.current) box.current.scrollTop = Math.max(0, focus * PX - 160);
  }, [cd.iso, focus]);

  const veil = cd.past ? height : cd.nowMin !== null ? cd.nowMin * PX : 0;
  return (
    <div>
      <AllDayStrip cd={cd} h={h} onDropTray={onPlan && (() => { const row = trayDrag.get(); trayDrag.set(null); if (row) onPlan(row, cd.iso); })} />
      <div ref={box} className="max-h-[70vh] overflow-auto" role="group" aria-label="Day grid">
        <div className="relative min-w-[32rem]" style={{ height }} data-grid-day={cd.iso}
          onDragOver={(e) => { if (tray && onPlan) e.preventDefault(); }}
          onDrop={(e) => {
            const row = trayDrag.get();
            if (!row || !onPlan) return;
            e.preventDefault();
            trayDrag.set(null);
            const start = Math.min(1440 - 30, Math.max(0, Math.round((e.clientY - e.currentTarget.getBoundingClientRect().top) / PX / 15) * 15));
            onPlan(row, cd.iso, start, start + 30);
          }}>
          {Array.from({ length: 24 }, (_, hr) => {
            const near = prayers.some((p) => Math.abs(p.min - hr * 60) * PX < 22);
            return (
              <div key={hr} aria-hidden="true" className="pointer-events-none absolute inset-x-0 z-[3] border-t border-[color-mix(in_srgb,var(--foreground)_9%,transparent)]" style={{ top: hr * 60 * PX }}>
                {!near && hr > 0 && <span className="absolute left-0 -top-[7px] w-14 bg-[var(--surface)] pr-1.5 text-right font-mono text-[10px] text-[var(--muted-foreground)]">{pad2(hr)}:00</span>}
              </div>
            );
          })}
          {prayers.map((p) => (
            <div key={p.name} aria-hidden="true" className={`pointer-events-none absolute left-0 z-[7] w-14 border bg-[var(--surface)] py-px text-center leading-tight ${p.next ? "border-[var(--accent)]" : "border-[var(--foreground)]"}`} style={{ top: p.min * PX - 12 }}>
              <b className={`block text-[10px] font-bold ${p.next ? "text-[var(--accent)]" : ""}`}>{p.label}</b>
              <span className="block font-mono text-[9.5px] text-[var(--muted-foreground)]">{formatMinutes(p.min)}</span>
            </div>
          ))}
          <div className="absolute inset-y-0 left-16 right-0">
            {cd.day && pieces(cd.day.blocks).map(({ index, block, from, to }) => (
              <div key={`${index}-${from}`} className="absolute inset-x-0 z-[1] overflow-hidden border-t border-[var(--surface)] py-0.5 pl-3 pr-2 text-[11.5px] leading-tight"
                style={{ top: from * PX, height: (to - from) * PX, background: tint(colours[index], 20), boxShadow: `inset 4px 0 0 ${colours[index]}` }}
                title={`${blocks.label(block.block)} ${formatMinutes(block.startMin)}–${formatMinutes(block.endMin)}: ${block.what}`}>
                <div className="max-w-[36%] truncate"><b className="font-bold">{blocks.label(block.block)}</b><span className="ml-1 text-[var(--muted-foreground)]">{block.what}</span></div>
              </div>
            ))}
            {prayers.map((p) => (
              <div key={p.name} aria-hidden="true">
                <span className={`pointer-events-none absolute -left-1 z-[4] h-2 w-2 rotate-45 ${p.next ? "bg-[var(--accent)]" : "bg-[var(--foreground)]"}`} style={{ top: p.min * PX - 4 }} />
                <div className={`pointer-events-none absolute left-[38%] right-0 z-[4] border-t-[1.5px] border-dashed ${p.next ? "border-[var(--accent)]" : "border-[var(--foreground)]"}`} style={{ top: p.min * PX }} />
              </div>
            ))}
            {timed.map((i) => {
              const ref = itemRef(i);
              const { lane: l, cols } = lane.get(ref)!;
              const w = 38 / cols;
              const state = itemState(i, cd);
              const subs = subtaskStat(i.checklist);
              return (
                <button key={ref} type="button" {...itemAttrs(i, h)} onClick={() => h.onPick(i)} aria-pressed={h.picked === ref} aria-label={`Details: ${labelOf(i)}`}
                  className={`absolute z-[5] flex items-start gap-1.5 overflow-hidden border border-l-4 border-[var(--foreground)] bg-[var(--surface)] px-1.5 py-px text-left text-[11px] leading-4 ${i.kind === "task" ? "border-dashed" : ""} ${STATE_CLASS[state]} ${h.picked === ref ? "z-[6] outline outline-2 outline-[var(--accent)]" : ""}`}
                  style={{ top: (i.start_min as number) * PX + 1, height: Math.max(((i.end_min as number) - (i.start_min as number)) * PX - 2, 18), left: `${62 + l * w}%`, width: `calc(${w}% - 3px)`, borderLeftColor: h.colourOf(i) }}>
                  <Badge n={n.get(ref)!} live={state === "live"} />
                  {cols < 3 && (
                    <span className="min-w-0 flex-1 overflow-hidden">
                      {i.status !== "open" && <span className="mr-1 inline-block align-[-2px]"><StatusBox status={i.status} /></span>}
                      <b className="font-semibold" data-title="">{i.title}</b>
                      <span className="ml-1 font-mono text-[10px] text-[var(--muted-foreground)]">{formatMinutes(i.start_min as number)}</span>
                    </span>
                  )}
                  {cols < 3 && subs.total > 0 && <span className="shrink-0 font-mono text-[9px] font-bold text-[var(--muted-foreground)]">{subs.done}/{subs.total}</span>}
                </button>
              );
            })}
            {cd.nowMin !== null && (
              <div aria-hidden="true" className="pointer-events-none absolute -left-16 right-0 z-[8] border-t-2 border-[var(--accent)]" style={{ top: cd.nowMin * PX }}>
                <span className="absolute left-[60px] -top-[6px] h-2.5 w-2.5 rounded-full bg-[var(--accent)] shadow-[0_0_0_3px_var(--surface)]" />
              </div>
            )}
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-[2] bg-[color-mix(in_srgb,var(--surface)_45%,transparent)]" style={{ height: veil }} />
          </div>
        </div>
      </div>
    </div>
  );
}
