"use client";

import { Row, Tab, isOpenBlocker, tabOf, tagTally, waitingOn } from "@/lib/plan-model";
import { MONTH_LABEL, StreamMeta } from "@/lib/streams";
import { NotebooksData, QuarterData } from "@/lib/vault-types";

const COLUMNS: { id: Exclude<Tab, "notes">; label: string }[] = [
  { id: "now", label: "Now" },
  { id: "next", label: "Next" },
  { id: "someday", label: "Someday" },
  { id: "done", label: "Done" },
];
const SHOWN = 5;

interface Props {
  streams: StreamMeta[];
  quarter: QuarterData;
  notebooks: NotebooksData | null;
  rows: Row[];
  picked: string | null;
  selected: string | null;
  /** Open one item in the work list below. */
  onOpen: (row: Row, tab: Tab) => void;
  onPickStream: (id: string | null) => void;
  onTag: (stream: string, tag: string) => void;
  week: string;
}

/** Every block against every horizon on one sheet: its goal and months, then what sits in Now, Next, Someday and Done. */
export function PlanMap({ streams, quarter, notebooks, rows, picked, selected, onOpen, onPickStream, onTag, week }: Props) {
  const hiIdx = Math.max(quarter.months.indexOf(quarter.current_month), 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[62rem] table-fixed border-collapse text-small">
        <colgroup><col className="w-[15%]" /><col className="w-[23%]" /><col className="w-[19%]" /><col className="w-[16%]" /><col className="w-[14%]" /><col className="w-[13%]" /></colgroup>
        <thead>
          <tr className="border-b border-[var(--border)]">
            <th className="mono px-3 py-2.5 text-left font-medium text-[var(--muted-foreground)]">Block</th>
            <th className="mono border-l border-[var(--border)] px-3 py-2.5 text-left font-medium text-[var(--muted-foreground)]">Goal · months</th>
            {COLUMNS.map((c) => <th key={c.id} className="mono border-l border-[var(--border)] px-3 py-2.5 text-left font-medium text-[var(--muted-foreground)]">{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {streams.map((s) => {
            const goal = quarter.streams.find((g) => g.stream === s.id);
            const mine = rows.filter((r) => r.stream === s.id);
            const entries = notebooks?.streams.find((n) => n.stream === s.id)?.entries ?? [];
            const blockers = entries.filter(isOpenBlocker).length;
            const gd = goal?.goal_checklist.filter((l) => l.done).length ?? 0;
            const tags = tagTally(mine).slice(0, 6);
            return (
              <tr key={s.id} className="border-b border-[var(--border)] last:border-b-0 align-top">
                <td className="px-3 py-3">
                  <button type="button" onClick={() => onPickStream(picked === s.id ? null : s.id)} aria-pressed={picked === s.id}
                    className="flex items-center gap-2 text-left font-semibold hover:text-[var(--accent)]">
                    <span className="h-2 w-2 shrink-0" style={{ background: s.color }} aria-hidden="true" />{s.label}
                  </button>
                  <p className="mt-0.5 text-[var(--muted-foreground)]">{s.slot || "No slot set"}</p>
                  <p className="mono mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[var(--muted-foreground)]">
                    <span className={s.status === "active" || s.status === "committed" ? "text-[var(--accent)]" : ""}>{s.status}</span>
                    {blockers > 0 && <span className="text-[var(--destructive)]">{blockers} blocked</span>}
                  </p>
                </td>
                <td className="border-l border-[var(--border)] px-3 py-3">
                  <p className="mono text-[var(--muted-foreground)]">Goal <span className="tabular-nums text-[var(--foreground)]">{gd}/{goal?.goal_checklist.length ?? 0}</span></p>
                  {goal && goal.goal_checklist.length > 0 && (
                    <p className="mt-1 break-words leading-snug">{goal.goal_checklist.filter((l) => !l.done).slice(0, 2).map((l) => l.text).join(" · ") || "All lines ticked."}</p>
                  )}
                  <div className="mt-2.5 grid grid-cols-3 gap-1" role="list" aria-label="Months">
                    {quarter.months.map((m, i) => {
                      const list = goal?.checkpoints.find((c) => c.month === m)?.checklist ?? [];
                      const done = list.filter((l) => l.done).length;
                      const state = i < hiIdx ? "past" : i === hiIdx ? "now" : "next";
                      return (
                        <div key={m} role="listitem" title={`${MONTH_LABEL[m]}: ${done} of ${list.length}`}>
                          <div className="h-1.5 bg-[var(--border)]">
                            <div className="h-full" style={{ width: list.length ? `${(100 * done) / list.length}%` : state === "now" ? "100%" : "0%", background: s.color, opacity: list.length ? 1 : 0.25 }} />
                          </div>
                          <p className={`mono mt-1 tabular-nums ${state === "now" ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]"}`}>{MONTH_LABEL[m]} {list.length ? `${done}/${list.length}` : ""}</p>
                        </div>
                      );
                    })}
                  </div>
                  {tags.length > 0 && (
                    <p className="mt-2 flex flex-wrap gap-x-2 gap-y-0.5">
                      {tags.map(([t]) => <button key={t} type="button" onClick={() => onTag(s.id, t)} className="mono text-[var(--muted-foreground)] hover:text-[var(--accent)]">#{t}</button>)}
                    </p>
                  )}
                </td>
                {COLUMNS.map((c) => {
                  const list = mine.filter((r) => r.type === "item" && tabOf(r) === c.id);
                  return (
                    <td key={c.id} className="border-l border-[var(--border)] px-3 py-3">
                      {list.length === 0 && <span className="text-[var(--faint,var(--muted-foreground))] opacity-60">·</span>}
                      <ul className="grid gap-0.5">
                        {list.slice(0, SHOWN).map((r) => {
                          if (r.type !== "item") return null;
                          const blocked = waitingOn(r.item, entries).some((w) => w.found);
                          return (
                            <li key={r.key}>
                              <button type="button" onClick={() => onOpen(r, c.id)}
                                className={`flex w-full items-start gap-1.5 py-0.5 text-left leading-snug hover:text-[var(--accent)] ${c.id === "done" ? "text-[var(--muted-foreground)] line-through" : ""} ${selected === r.key ? "text-[var(--accent)]" : ""}`}>
                                {blocked && <span className="mt-[0.4rem] h-1.5 w-1.5 shrink-0 bg-[var(--destructive)]" role="img" aria-label="Blocked" />}
                                {r.item.focus === week && <span className="shrink-0 text-[var(--warn)]" aria-label="Small domino">★</span>}
                                <span className="min-w-0 break-words">{r.item.text}</span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                      {list.length > SHOWN && <p className="mono mt-1 text-[var(--muted-foreground)]">+{list.length - SHOWN} more</p>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
