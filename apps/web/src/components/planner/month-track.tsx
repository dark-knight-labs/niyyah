"use client";

import { Checklist } from "@/components/planner/checklist";
import { MONTH_LABEL } from "@/lib/streams";
import { ChecklistItemData, ChecklistLine, MonthKey } from "@/lib/vault-types";

interface Props {
  /** The quarter's three months, in order. */
  months: MonthKey[];
  checkpoints: { month: MonthKey; checklist: ChecklistItemData[] }[];
  current: MonthKey;
  color: string;
  busy: boolean;
  onToggle: (month: MonthKey, item: ChecklistItemData, done: boolean) => void | Promise<unknown>;
  onChange: (month: MonthKey, lines: ChecklistLine[]) => void | Promise<unknown>;
}

/** The quarter's months on a track: reached months filled, this month ringed, later ones hollow, each with its own checklist. */
export function MonthTrack({ months, checkpoints, current, color, busy, onToggle, onChange }: Props) {
  const here = Math.max(months.indexOf(current), 0);
  return (
    <ol className="grid gap-5 sm:grid-cols-3 sm:gap-4">
      {months.map((month, i) => {
        const state = i < here ? "past" : i === here ? "now" : "next";
        const items = checkpoints.find((c) => c.month === month)?.checklist ?? [];
        return (
          <li key={month} className="min-w-0">
            <div className="mb-2 flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
                {state === "now" && <circle cx="8" cy="8" r="7.5" fill={color} fillOpacity="0.2" />}
                <circle cx="8" cy="8" r="4.5" fill={state === "past" ? color : "var(--background)"} stroke={color} strokeWidth="2" strokeOpacity={state === "next" ? 0.4 : 1} />
              </svg>
              <span className="text-[0.6875rem] font-extrabold uppercase tracking-[0.12em]" style={{ color: state === "next" ? "var(--muted-foreground)" : color }}>
                {MONTH_LABEL[month]}{state === "now" ? " · now" : ""}
              </span>
              <span className="hidden h-px flex-1 sm:block" style={{ background: color, opacity: state === "next" ? 0.15 : 0.4 }} aria-hidden="true" />
            </div>
            <Checklist label={`${MONTH_LABEL[month]} checklist`} items={items} busy={busy} onToggle={(item, done) => onToggle(month, item, done)}
              onChange={(lines) => onChange(month, lines)} placeholder="Add" />
          </li>
        );
      })}
    </ol>
  );
}
