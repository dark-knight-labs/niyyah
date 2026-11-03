"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { LANE_LABEL, TrayRow } from "@/lib/plan-bridge";
import { colorVar } from "@/lib/streams";
import { trayDrag, type PlanDrop } from "@/lib/tray-drag";
import type { Lane, PipelinesData } from "@/lib/vault-types";

const MICRO = "text-micro font-medium text-[var(--muted-foreground)]";
const LANES: Extract<Lane, "next" | "backlog">[] = ["next", "backlog"];

/**
 * The pipeline's Next and Someday items, grouped by stream, in the rail. Drag a row onto a day or time slot of the week or day
 * grid; or press Plan… (a day and an optional time), which is the way on a phone and in the other views.
 */
export function Tray({ pipelines, today, onPlan }: { pipelines: PipelinesData | null; today: string; onPlan: PlanDrop }) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [planning, setPlanning] = useState<string | null>(null);
  if (!pipelines) return null;
  const toggle = (key: string) => setClosed((c) => { const n = new Set(c); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const rowsOf = (lane: Lane): TrayRow[] => pipelines.streams.filter((s) => s.status !== "archived")
    .flatMap((s) => s.items.filter((i) => i.lane === lane && !i.done).map((item) => ({ stream: s.stream, item })));

  return (
    <section aria-label="Tray" data-tray="" className="mt-4 border border-[var(--border)] bg-[var(--surface)]">
      <h2 className="mono flex h-[30px] items-center border-b border-[var(--border)] px-3 text-[var(--foreground)]">Tray</h2>
      {LANES.map((lane) => {
        const rows = rowsOf(lane);
        const open = !closed.has(lane);
        return (
          <div key={lane} data-tray-lane={lane} className="border-b border-[var(--border)] last:border-b-0">
            <button type="button" aria-expanded={open} onClick={() => toggle(lane)} className="flex min-h-8 w-full items-center gap-1.5 px-3 text-left">
              {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
              <span className="text-micro font-bold uppercase tracking-[0.07em]">{LANE_LABEL[lane]}</span>
              <span className="ml-auto font-mono text-xs tabular-nums text-[var(--muted-foreground)]">{rows.length}</span>
            </button>
            {open && (
              <div className="pb-1.5">
                {rows.length === 0 && <p className="px-3 pb-1 text-xs text-[var(--muted-foreground)]">Nothing here.</p>}
                {pipelines.streams.filter((s) => rows.some((r) => r.stream === s.stream)).map((s) => {
                  const mine = rows.filter((r) => r.stream === s.stream);
                  const gkey = `${lane}:${s.stream}`;
                  const gopen = !closed.has(gkey);
                  return (
                    <div key={gkey} data-tray-stream={s.stream}>
                      <button type="button" aria-expanded={gopen} onClick={() => toggle(gkey)} className="flex min-h-7 w-full items-center gap-2 px-3 text-left">
                        <span className="h-2 w-2 shrink-0" style={{ background: colorVar(s.color) }} aria-hidden="true" />
                        <span className={`${MICRO} uppercase tracking-[0.07em]`}>{s.name}</span>
                        <span className="ml-auto font-mono text-xs tabular-nums text-[var(--muted-foreground)]">{mine.length}</span>
                      </button>
                      {gopen && mine.map((row) => {
                        const key = `${row.stream}:${row.item.hash}`;
                        return (
                          <div key={key}>
                            <div draggable data-tray-row={row.item.text} onDragStart={(e) => { trayDrag.set(row); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", row.item.text); }}
                              onDragEnd={() => trayDrag.set(null)} title="Drag onto a day or a time slot" className="flex min-h-8 cursor-grab items-center gap-2 py-0.5 pl-7 pr-3 text-small hover:bg-[var(--muted)]">
                              <span className="min-w-0 flex-1 break-words">{row.item.text}</span>
                              <button type="button" onClick={() => setPlanning(planning === key ? null : key)} aria-expanded={planning === key} aria-label={`Plan… ${row.item.text}`}
                                className="shrink-0 border border-[var(--border)] px-2 text-xs font-semibold text-[var(--muted-foreground)] hover:bg-[var(--surface)]">Plan…</button>
                            </div>
                            {planning === key && <PlanForm today={today} onSubmit={(day, start) => { setPlanning(null); onPlan(row, day, start, start === undefined ? undefined : Math.min(1440, start + 30)); }} />}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

/** Day and optional start time (30 minutes); no time = all day. */
function PlanForm({ today, onSubmit }: { today: string; onSubmit: (day: string, start?: number) => void }) {
  const [day, setDay] = useState(today);
  const [time, setTime] = useState("");
  const INPUT = "min-h-9 min-w-0 border border-[var(--border)] bg-[var(--background)] px-2 text-small";
  return (
    <form className="flex flex-wrap items-center gap-1.5 bg-[var(--muted)] py-1.5 pl-7 pr-3" aria-label="Plan on the calendar"
      onSubmit={(e) => { e.preventDefault(); if (!day) return; const m = /^(\d{2}):(\d{2})$/.exec(time); onSubmit(day, m ? Math.min(1410, +m[1] * 60 + +m[2]) : undefined); }}>
      <input type="date" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Day" className={INPUT} />
      <input type="time" value={time} step={900} onChange={(e) => setTime(e.target.value)} aria-label="Time (optional)" className={`${INPUT} w-28`} />
      <button type="submit" disabled={!day} className="min-h-9 bg-[var(--accent)] px-3 text-xs font-bold text-[var(--accent-fg)] disabled:opacity-50">Add to calendar</button>
    </form>
  );
}
